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
	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
	waLog "go.mau.fi/whatsmeow/util/log"

	_ "github.com/lib/pq" // PostgreSQL driver
	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
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

// GetProcessedCommand returns a durable command result for safe redelivery.
func (c *PGContainer) GetProcessedCommand(ctx context.Context, commandID string) ([]byte, bool, error) {
	var result []byte
	err := c.db.QueryRowContext(ctx, `
		SELECT result FROM processed_commands
		WHERE connection_id = $1 AND command_id = $2
	`, c.connectionID, commandID).Scan(&result)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("get processed command: %w", err)
	}
	return result, true, nil
}

// SaveProcessedCommand persists the external side-effect result before ACK.
func (c *PGContainer) SaveProcessedCommand(ctx context.Context, commandID, commandType string, result []byte) error {
	_, err := c.db.ExecContext(ctx, `
		INSERT INTO processed_commands (connection_id, command_id, command_type, result)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, command_id) DO NOTHING
	`, c.connectionID, commandID, commandType, result)
	if err != nil {
		return fmt.Errorf("save processed command: %w", err)
	}
	return nil
}

func (c *PGContainer) MarkCommandEventPublished(ctx context.Context, commandID string) error {
	_, err := c.db.ExecContext(ctx, `
		UPDATE processed_commands SET event_published = true
		WHERE connection_id = $1 AND command_id = $2
	`, c.connectionID, commandID)
	return err
}

func (c *PGContainer) SavePendingEvent(
	ctx context.Context,
	event natsClient.PendingEvent,
) error {
	_, err := c.db.ExecContext(ctx, `
		INSERT INTO worker_event_outbox (
			connection_id, event_id, subject, payload
		) VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, event_id) DO NOTHING
	`, c.connectionID, event.ID, event.Subject, event.Payload)
	if err != nil {
		return fmt.Errorf("save pending worker event: %w", err)
	}
	return nil
}

func (c *PGContainer) ListPendingEvents(
	ctx context.Context,
	limit int,
) ([]natsClient.PendingEvent, error) {
	rows, err := c.db.QueryContext(ctx, `
		SELECT event_id::text, subject, payload
		FROM worker_event_outbox
		WHERE connection_id = $1
		ORDER BY created_at ASC, event_id ASC
		LIMIT $2
	`, c.connectionID, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending worker events: %w", err)
	}
	defer rows.Close()

	events := make([]natsClient.PendingEvent, 0)
	for rows.Next() {
		var event natsClient.PendingEvent
		if err = rows.Scan(&event.ID, &event.Subject, &event.Payload); err != nil {
			return nil, fmt.Errorf("scan pending worker event: %w", err)
		}
		events = append(events, event)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending worker events: %w", err)
	}
	return events, nil
}

func (c *PGContainer) MarkEventPublished(
	ctx context.Context,
	eventID string,
) error {
	_, err := c.db.ExecContext(ctx, `
		DELETE FROM worker_event_outbox
		WHERE connection_id = $1 AND event_id = $2
	`, c.connectionID, eventID)
	if err != nil {
		return fmt.Errorf("delete published worker event: %w", err)
	}
	return nil
}

func (c *PGContainer) RecordEventPublishFailure(
	ctx context.Context,
	eventID string,
	errorMessage string,
) error {
	_, err := c.db.ExecContext(ctx, `
		UPDATE worker_event_outbox
		SET attempts = attempts + 1, last_error = $3
		WHERE connection_id = $1 AND event_id = $2
	`, c.connectionID, eventID, errorMessage)
	if err != nil {
		return fmt.Errorf("record worker event publish failure: %w", err)
	}
	return nil
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
	device.NCTSalt = sqlStore
	device.EventBuffer = sqlStore

	return device
}

// hasCompleteDeviceIdentity verifies the cryptographic identity that must be
// included when establishing new Signal sessions. These values cannot be
// reconstructed from a linked device after they have been lost.
func hasCompleteDeviceIdentity(device *store.Device) bool {
	return device != nil &&
		device.ID != nil &&
		device.NoiseKey != nil &&
		device.IdentityKey != nil &&
		device.SignedPreKey != nil &&
		device.SignedPreKey.Signature != nil &&
		len(device.AdvSecretKey) == 32 &&
		device.Account != nil &&
		len(device.Account.Details) > 0 &&
		len(device.Account.AccountSignature) == 64 &&
		len(device.Account.AccountSignatureKey) == 32 &&
		len(device.Account.DeviceSignature) == 64
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

	device := devices[0]
	if !hasCompleteDeviceIdentity(device) {
		c.log.Warnf("Stored device identity is incomplete; removing the unsafe session and requiring QR re-pairing")
		if err = c.DeleteDevice(ctx, device); err != nil {
			return nil, fmt.Errorf("failed to remove incomplete device identity: %w", err)
		}
		return c.NewDevice(), nil
	}

	return device, nil
}

// GetDevice retrieves a device by JID.
func (c *PGContainer) GetDevice(ctx context.Context, jid types.JID) (*store.Device, error) {
	device := c.NewDevice()

	row := c.db.QueryRowContext(ctx, `
		SELECT jid, lid, registration_id, noise_key, identity_key,
			   signed_pre_key, signed_pre_key_id, signed_pre_key_sig,
			   adv_key, adv_details, adv_account_sig, adv_account_sig_key,
			   adv_device_sig, platform, business_name, push_name,
			   facebook_uuid, lid_migration_ts
		FROM whatsmeow_device
		WHERE connection_id = $1 AND jid = $2
	`, c.connectionID, jid.String())

	var jidStr string
	var lid sql.NullString
	var registrationID uint32
	var noiseKey, identityKey, signedPreKey, signedPreKeySig []byte
	var signedPreKeyID int32
	var advKey, advDetails, advAccountSig, advAccountSigKey, advDeviceSig []byte
	var platform, businessName, pushName string
	var facebookUUID *string
	var lidMigrationTimestamp int64

	err := row.Scan(
		&jidStr, &lid, &registrationID, &noiseKey, &identityKey,
		&signedPreKey, &signedPreKeyID, &signedPreKeySig,
		&advKey, &advDetails, &advAccountSig, &advAccountSigKey,
		&advDeviceSig, &platform, &businessName, &pushName, &facebookUUID,
		&lidMigrationTimestamp,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to scan device: %w", err)
	}

	return c.scanDevice(device, jidStr, lid, registrationID, noiseKey, identityKey,
		signedPreKey, signedPreKeyID, signedPreKeySig,
		advKey, advDetails, advAccountSig, advAccountSigKey, advDeviceSig,
		platform, businessName, pushName, facebookUUID, lidMigrationTimestamp)
}

// GetAllDevices retrieves all devices for this connection.
func (c *PGContainer) GetAllDevices(ctx context.Context) ([]*store.Device, error) {
	rows, err := c.db.QueryContext(ctx, `
		SELECT jid, lid, registration_id, noise_key, identity_key,
			   signed_pre_key, signed_pre_key_id, signed_pre_key_sig,
			   adv_key, adv_details, adv_account_sig, adv_account_sig_key,
			   adv_device_sig, platform, business_name, push_name,
			   facebook_uuid, lid_migration_ts
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
		var lid sql.NullString
		var registrationID uint32
		var noiseKey, identityKey, signedPreKey, signedPreKeySig []byte
		var signedPreKeyID int32
		var advKey, advDetails, advAccountSig, advAccountSigKey, advDeviceSig []byte
		var platform, businessName, pushName string
		var facebookUUID *string
		var lidMigrationTimestamp int64

		err := rows.Scan(
			&jidStr, &lid, &registrationID, &noiseKey, &identityKey,
			&signedPreKey, &signedPreKeyID, &signedPreKeySig,
			&advKey, &advDetails, &advAccountSig, &advAccountSigKey,
			&advDeviceSig, &platform, &businessName, &pushName, &facebookUUID,
			&lidMigrationTimestamp,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan device row: %w", err)
		}

		device, err = c.scanDevice(device, jidStr, lid, registrationID, noiseKey, identityKey,
			signedPreKey, signedPreKeyID, signedPreKeySig,
			advKey, advDetails, advAccountSig, advAccountSigKey, advDeviceSig,
			platform, businessName, pushName, facebookUUID, lidMigrationTimestamp)
		if err != nil {
			return nil, err
		}

		devices = append(devices, device)
	}

	return devices, rows.Err()
}

// scanDevice populates a device from scanned row data.
func (c *PGContainer) scanDevice(device *store.Device, jidStr string, lid sql.NullString, registrationID uint32,
	noiseKey, identityKey, signedPreKey []byte, signedPreKeyID int32, signedPreKeySig []byte,
	advKey, advDetails, advAccountSig, advAccountSigKey, advDeviceSig []byte,
	platform, businessName, pushName string, facebookUUID *string, lidMigrationTimestamp int64) (*store.Device, error) {

	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return nil, fmt.Errorf("failed to parse JID %s: %w", jidStr, err)
	}
	device.ID = &jid
	if lid.Valid && lid.String != "" {
		parsedLID, parseErr := types.ParseJID(lid.String)
		if parseErr != nil {
			return nil, fmt.Errorf("failed to parse LID %s: %w", lid.String, parseErr)
		}
		device.LID = parsedLID
	}
	device.RegistrationID = registrationID
	device.Platform = platform
	device.BusinessName = businessName
	device.PushName = pushName
	device.LIDMigrationTimestamp = lidMigrationTimestamp

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

	// Restore the complete device identity. Whatsmeow includes this when a new
	// Signal session is established, so dropping any field can produce messages
	// that other WhatsApp devices cannot decrypt.
	if len(advKey) > 0 {
		device.AdvSecretKey = advKey
	}
	device.Account = &waAdv.ADVSignedDeviceIdentity{
		Details:             advDetails,
		AccountSignature:    advAccountSig,
		AccountSignatureKey: advAccountSigKey,
		DeviceSignature:     advDeviceSig,
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
	device.NCTSalt = sqlStore
	device.EventBuffer = sqlStore

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
	var advKey, advDetails, advAccountSig, advAccountSigKey, advDeviceSig []byte
	var lid *string

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
		advAccountSigKey = device.Account.AccountSignatureKey
		advDeviceSig = device.Account.DeviceSignature
	}
	if !device.LID.IsEmpty() {
		value := device.LID.String()
		lid = &value
	}

	var facebookUUID *string
	if device.FacebookUUID != uuid.Nil {
		s := device.FacebookUUID.String()
		facebookUUID = &s
	}

	_, err := c.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_device (
			connection_id, jid, lid, registration_id, noise_key, identity_key,
			signed_pre_key, signed_pre_key_id, signed_pre_key_sig,
			adv_key, adv_details, adv_account_sig, adv_account_sig_key,
			adv_device_sig, platform, business_name, push_name, facebook_uuid,
			lid_migration_ts
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
			$11, $12, $13, $14, $15, $16, $17, $18, $19
		)
		ON CONFLICT (connection_id, jid) DO UPDATE SET
			lid = EXCLUDED.lid,
			platform = EXCLUDED.platform,
			business_name = EXCLUDED.business_name,
			push_name = EXCLUDED.push_name,
			facebook_uuid = EXCLUDED.facebook_uuid,
			lid_migration_ts = EXCLUDED.lid_migration_ts
	`, c.connectionID, jid, lid, device.RegistrationID, noiseKey, identityKey,
		signedPreKey, signedPreKeyID, signedPreKeySig,
		advKey, advDetails, advAccountSig, advAccountSigKey, advDeviceSig,
		device.Platform, device.BusinessName, device.PushName, facebookUUID,
		device.LIDMigrationTimestamp,
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
	device.NCTSalt = sqlStore
	device.EventBuffer = sqlStore
	device.Container = c

	return nil
}

// DeleteDevice removes a device and all its associated data.
func (c *PGContainer) DeleteDevice(ctx context.Context, device *store.Device) error {
	if device.ID == nil {
		return fmt.Errorf("device JID must be set before deleting")
	}

	jid := device.ID.String()

	// Delete in order to avoid foreign key issues (if any). Store tables do
	// not use one consistent device-JID column name, so keep the column next
	// to the table instead of assuming every table uses our_jid.
	tables := []struct {
		name      string
		jidColumn string
	}{
		{"whatsmeow_chat_settings", "our_jid"},
		{"whatsmeow_contacts", "our_jid"},
		{"whatsmeow_message_secrets", "our_jid"},
		{"whatsmeow_privacy_tokens", "our_jid"},
		{"whatsmeow_nct_salt", "our_jid"},
		{"whatsmeow_event_buffer", "our_jid"},
		{"whatsmeow_retry_buffer", "our_jid"},
		{"whatsmeow_app_state_mutation_macs", "jid"},
		{"whatsmeow_app_state_version", "jid"},
		{"whatsmeow_app_state_sync_keys", "jid"},
		{"whatsmeow_sender_keys", "our_jid"},
		{"whatsmeow_pre_keys", "jid"},
		{"whatsmeow_sessions", "our_jid"},
		{"whatsmeow_identity_keys", "our_jid"},
		{"whatsmeow_device", "jid"},
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	for _, table := range tables {
		query := fmt.Sprintf(
			"DELETE FROM %s WHERE connection_id = $1 AND %s = $2",
			table.name,
			table.jidColumn,
		)
		if _, err := tx.ExecContext(ctx, query, c.connectionID, jid); err != nil {
			return fmt.Errorf("failed to delete from %s: %w", table.name, err)
		}
	}

	return tx.Commit()
}

// PGSQLStore implements all the whatsmeow store interfaces.
type PGSQLStore struct {
	*PGContainer
	JID string
}

var _ store.NCTSaltStore = (*PGSQLStore)(nil)
var _ store.EventBuffer = (*PGSQLStore)(nil)
