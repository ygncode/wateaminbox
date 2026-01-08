package store

import (
	"context"
	crand "crypto/rand"
	"database/sql"
	"encoding/binary"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
	waLog "go.mau.fi/whatsmeow/util/log"

	_ "github.com/lib/pq" // PostgreSQL driver
)

// PGConfig holds PostgreSQL store configuration.
type PGConfig struct {
	DatabaseURL  string
	ConnectionID string // UUID for isolating session data
	Logger       waLog.Logger
}

// PGContainer is a PostgreSQL-backed device container for whatsmeow.
// It implements the store.DeviceContainer interface and filters all data by connection_id.
type PGContainer struct {
	db           *sql.DB
	connectionID string
	log          waLog.Logger
	mu           sync.RWMutex
}

// NewPGContainer creates a new PostgreSQL store container.
func NewPGContainer(ctx context.Context, cfg PGConfig) (*PGContainer, error) {
	if cfg.ConnectionID == "" {
		return nil, fmt.Errorf("connection_id is required")
	}

	// Validate connection_id is a valid UUID
	if _, err := uuid.Parse(cfg.ConnectionID); err != nil {
		return nil, fmt.Errorf("invalid connection_id UUID: %w", err)
	}

	// Add search_path to the database URL so all pooled connections use it
	dbURL := cfg.DatabaseURL
	if !strings.Contains(dbURL, "search_path") {
		separator := "?"
		if strings.Contains(dbURL, "?") {
			separator = "&"
		}
		dbURL = dbURL + separator + "search_path=whatsapp_sessions"
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Test connection
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	log := cfg.Logger
	if log == nil {
		log = waLog.Noop
	}

	container := &PGContainer{
		db:           db,
		connectionID: cfg.ConnectionID,
		log:          log,
	}

	return container, nil
}

// Close closes the database connection.
func (c *PGContainer) Close() error {
	return c.db.Close()
}

// NewDevice creates a new device with initialized stores and crypto keys.
func (c *PGContainer) NewDevice() *store.Device {
	// Generate new identity and noise keys for the device
	noiseKey := keys.NewKeyPair()
	identityKey := keys.NewKeyPair()

	// Create signed pre-key with proper signature using identity key
	signedPreKey := identityKey.CreateSignedPreKey(1)

	// Generate random registration ID (14 bits as per Signal spec)
	var regIDBytes [4]byte
	crand.Read(regIDBytes[:])
	registrationID := binary.BigEndian.Uint32(regIDBytes[:]) & 0x3FFF // 14 bits

	// Generate random ADV secret key
	advSecretKey := make([]byte, 32)
	crand.Read(advSecretKey)

	device := &store.Device{
		Log:       c.log.Sub("Device"),
		Container: c,
		// Initialize crypto keys for new device
		NoiseKey:       noiseKey,
		IdentityKey:    identityKey,
		SignedPreKey:   signedPreKey,
		RegistrationID: registrationID,
		AdvSecretKey:   advSecretKey,
	}

	// Initialize the store interfaces
	sqlStore := &PGSQLStore{
		PGContainer: c,
		JID:         "",
	}

	device.Identities = sqlStore
	device.Sessions = sqlStore
	device.PreKeys = sqlStore
	device.SenderKeys = sqlStore
	device.AppStateKeys = sqlStore
	device.AppState = sqlStore
	device.Contacts = sqlStore
	device.ChatSettings = sqlStore
	device.LIDs = sqlStore
	device.MsgSecrets = sqlStore
	device.PrivacyTokens = sqlStore

	return device
}

// GetFirstDevice retrieves the first device for this connection or creates one.
func (c *PGContainer) GetFirstDevice(ctx context.Context) (*store.Device, error) {
	devices, err := c.GetAllDevices(ctx)
	if err != nil {
		return nil, err
	}

	if len(devices) == 0 {
		return c.NewDevice(), nil
	}

	return devices[0], nil
}

// GetDevice retrieves a device by JID.
func (c *PGContainer) GetDevice(ctx context.Context, jid types.JID) (*store.Device, error) {
	device := c.NewDevice()

	row := c.db.QueryRowContext(ctx, `
		SELECT jid, registration_id, noise_key, identity_key,
			   signed_pre_key, signed_pre_key_id, signed_pre_key_sig,
			   adv_key, adv_details, adv_account_sig, adv_device_sig,
			   platform, business_name, push_name, facebook_uuid
		FROM whatsmeow_device
		WHERE connection_id = $1 AND jid = $2
	`, c.connectionID, jid.String())

	var jidStr string
	var registrationID uint32
	var noiseKey, identityKey, signedPreKey, signedPreKeySig []byte
	var signedPreKeyID int32
	var advKey, advDetails, advAccountSig, advDeviceSig []byte
	var platform, businessName, pushName string
	var facebookUUID *string

	err := row.Scan(
		&jidStr, &registrationID, &noiseKey, &identityKey,
		&signedPreKey, &signedPreKeyID, &signedPreKeySig,
		&advKey, &advDetails, &advAccountSig, &advDeviceSig,
		&platform, &businessName, &pushName, &facebookUUID,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to scan device: %w", err)
	}

	return c.scanDevice(device, jidStr, registrationID, noiseKey, identityKey,
		signedPreKey, signedPreKeyID, signedPreKeySig,
		advKey, advDetails, advAccountSig, advDeviceSig,
		platform, businessName, pushName, facebookUUID)
}

// GetAllDevices retrieves all devices for this connection.
func (c *PGContainer) GetAllDevices(ctx context.Context) ([]*store.Device, error) {
	rows, err := c.db.QueryContext(ctx, `
		SELECT jid, registration_id, noise_key, identity_key,
			   signed_pre_key, signed_pre_key_id, signed_pre_key_sig,
			   adv_key, adv_details, adv_account_sig, adv_device_sig,
			   platform, business_name, push_name, facebook_uuid
		FROM whatsmeow_device
		WHERE connection_id = $1
	`, c.connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to query devices: %w", err)
	}
	defer rows.Close()

	var devices []*store.Device

	for rows.Next() {
		device := c.NewDevice()

		var jidStr string
		var registrationID uint32
		var noiseKey, identityKey, signedPreKey, signedPreKeySig []byte
		var signedPreKeyID int32
		var advKey, advDetails, advAccountSig, advDeviceSig []byte
		var platform, businessName, pushName string
		var facebookUUID *string

		err := rows.Scan(
			&jidStr, &registrationID, &noiseKey, &identityKey,
			&signedPreKey, &signedPreKeyID, &signedPreKeySig,
			&advKey, &advDetails, &advAccountSig, &advDeviceSig,
			&platform, &businessName, &pushName, &facebookUUID,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan device row: %w", err)
		}

		device, err = c.scanDevice(device, jidStr, registrationID, noiseKey, identityKey,
			signedPreKey, signedPreKeyID, signedPreKeySig,
			advKey, advDetails, advAccountSig, advDeviceSig,
			platform, businessName, pushName, facebookUUID)
		if err != nil {
			return nil, err
		}

		devices = append(devices, device)
	}

	return devices, rows.Err()
}

// scanDevice populates a device from scanned row data.
func (c *PGContainer) scanDevice(device *store.Device, jidStr string, registrationID uint32,
	noiseKey, identityKey, signedPreKey []byte, signedPreKeyID int32, signedPreKeySig []byte,
	advKey, advDetails, advAccountSig, advDeviceSig []byte,
	platform, businessName, pushName string, facebookUUID *string) (*store.Device, error) {

	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return nil, fmt.Errorf("failed to parse JID %s: %w", jidStr, err)
	}
	device.ID = &jid
	device.RegistrationID = registrationID
	device.Platform = platform
	device.BusinessName = businessName
	device.PushName = pushName

	// Set noise key - use NewKeyPairFromPrivateKey to properly derive public key
	if len(noiseKey) == 32 {
		var privKey [32]byte
		copy(privKey[:], noiseKey)
		device.NoiseKey = keys.NewKeyPairFromPrivateKey(privKey)
	}

	// Set identity key - use NewKeyPairFromPrivateKey to properly derive public key
	if len(identityKey) == 32 {
		var privKey [32]byte
		copy(privKey[:], identityKey)
		device.IdentityKey = keys.NewKeyPairFromPrivateKey(privKey)
	}

	// Set signed pre-key
	if len(signedPreKey) == 32 && len(signedPreKeySig) == 64 {
		var privKey [32]byte
		copy(privKey[:], signedPreKey)
		keyPair := keys.NewKeyPairFromPrivateKey(privKey)
		device.SignedPreKey = &keys.PreKey{
			KeyPair:   *keyPair,
			KeyID:     uint32(signedPreKeyID),
			Signature: new([64]byte),
		}
		copy(device.SignedPreKey.Signature[:], signedPreKeySig)
	}

	// Set ADV secret key
	if len(advKey) > 0 {
		device.AdvSecretKey = advKey
	}

	// Parse Facebook UUID
	if facebookUUID != nil && *facebookUUID != "" {
		if u, err := uuid.Parse(*facebookUUID); err == nil {
			device.FacebookUUID = u
		}
	}

	// Set up stores with the JID
	sqlStore := &PGSQLStore{
		PGContainer: c,
		JID:         jidStr,
	}

	device.Identities = sqlStore
	device.Sessions = sqlStore
	device.PreKeys = sqlStore
	device.SenderKeys = sqlStore
	device.AppStateKeys = sqlStore
	device.AppState = sqlStore
	device.Contacts = sqlStore
	device.ChatSettings = sqlStore
	device.LIDs = sqlStore
	device.MsgSecrets = sqlStore
	device.PrivacyTokens = sqlStore

	device.Initialized = true

	return device, nil
}

// PutDevice saves a device to the database.
func (c *PGContainer) PutDevice(ctx context.Context, device *store.Device) error {
	if device.ID == nil {
		return fmt.Errorf("device JID must be set before saving")
	}

	jid := device.ID.String()

	var noiseKey, identityKey, signedPreKey, signedPreKeySig []byte
	var signedPreKeyID int32
	var advKey, advDetails, advAccountSig, advDeviceSig []byte

	if device.NoiseKey != nil {
		noiseKey = device.NoiseKey.Priv[:]
	}
	if device.IdentityKey != nil {
		identityKey = device.IdentityKey.Priv[:]
	}
	if device.SignedPreKey != nil {
		signedPreKey = device.SignedPreKey.Priv[:]
		signedPreKeyID = int32(device.SignedPreKey.KeyID)
		signedPreKeySig = device.SignedPreKey.Signature[:]
	}
	if device.AdvSecretKey != nil {
		advKey = device.AdvSecretKey
	}
	if device.Account != nil {
		advDetails = device.Account.Details
		advAccountSig = device.Account.AccountSignature
		advDeviceSig = device.Account.DeviceSignature
	}

	var facebookUUID *string
	if device.FacebookUUID != uuid.Nil {
		s := device.FacebookUUID.String()
		facebookUUID = &s
	}

	_, err := c.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_device (
			connection_id, jid, registration_id, noise_key, identity_key,
			signed_pre_key, signed_pre_key_id, signed_pre_key_sig,
			adv_key, adv_details, adv_account_sig, adv_device_sig,
			platform, business_name, push_name, facebook_uuid
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		ON CONFLICT (connection_id, jid) DO UPDATE SET
			registration_id = EXCLUDED.registration_id,
			noise_key = EXCLUDED.noise_key,
			identity_key = EXCLUDED.identity_key,
			signed_pre_key = EXCLUDED.signed_pre_key,
			signed_pre_key_id = EXCLUDED.signed_pre_key_id,
			signed_pre_key_sig = EXCLUDED.signed_pre_key_sig,
			adv_key = EXCLUDED.adv_key,
			adv_details = EXCLUDED.adv_details,
			adv_account_sig = EXCLUDED.adv_account_sig,
			adv_device_sig = EXCLUDED.adv_device_sig,
			platform = EXCLUDED.platform,
			business_name = EXCLUDED.business_name,
			push_name = EXCLUDED.push_name,
			facebook_uuid = EXCLUDED.facebook_uuid
	`, c.connectionID, jid, device.RegistrationID, noiseKey, identityKey,
		signedPreKey, signedPreKeyID, signedPreKeySig,
		advKey, advDetails, advAccountSig, advDeviceSig,
		device.Platform, device.BusinessName, device.PushName, facebookUUID,
	)

	if err != nil {
		return fmt.Errorf("failed to save device: %w", err)
	}

	// Update the stores with the JID
	sqlStore := &PGSQLStore{
		PGContainer: c,
		JID:         jid,
	}

	device.Identities = sqlStore
	device.Sessions = sqlStore
	device.PreKeys = sqlStore
	device.SenderKeys = sqlStore
	device.AppStateKeys = sqlStore
	device.AppState = sqlStore
	device.Contacts = sqlStore
	device.ChatSettings = sqlStore
	device.LIDs = sqlStore
	device.MsgSecrets = sqlStore
	device.PrivacyTokens = sqlStore
	device.Container = c

	return nil
}

// DeleteDevice removes a device and all its associated data.
func (c *PGContainer) DeleteDevice(ctx context.Context, device *store.Device) error {
	if device.ID == nil {
		return fmt.Errorf("device JID must be set before deleting")
	}

	jid := device.ID.String()

	// Delete in order to avoid foreign key issues (if any)
	tables := []string{
		"whatsmeow_chat_settings",
		"whatsmeow_contacts",
		"whatsmeow_app_state_mutation_macs",
		"whatsmeow_app_state_version",
		"whatsmeow_app_state_sync_keys",
		"whatsmeow_sender_keys",
		"whatsmeow_pre_keys",
		"whatsmeow_sessions",
		"whatsmeow_identity_keys",
		"whatsmeow_device",
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	for _, table := range tables {
		var query string
		if table == "whatsmeow_device" || table == "whatsmeow_pre_keys" {
			query = fmt.Sprintf("DELETE FROM %s WHERE connection_id = $1 AND jid = $2", table)
		} else {
			query = fmt.Sprintf("DELETE FROM %s WHERE connection_id = $1 AND our_jid = $2", table)
		}
		if _, err := tx.ExecContext(ctx, query, c.connectionID, jid); err != nil {
			return fmt.Errorf("failed to delete from %s: %w", table, err)
		}
	}

	return tx.Commit()
}

// PGSQLStore implements all the whatsmeow store interfaces.
type PGSQLStore struct {
	*PGContainer
	JID string
}
