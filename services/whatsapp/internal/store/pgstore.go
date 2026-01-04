package store

import (
	"context"
	crand "crypto/rand"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
	waLog "go.mau.fi/whatsmeow/util/log"
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

	// Set noise key
	if len(noiseKey) == 32 {
		device.NoiseKey = &keys.KeyPair{}
		copy(device.NoiseKey.Priv[:], noiseKey)
	}

	// Set identity key
	if len(identityKey) == 32 {
		device.IdentityKey = &keys.KeyPair{}
		copy(device.IdentityKey.Priv[:], identityKey)
	}

	// Set signed pre-key
	if len(signedPreKey) == 32 && len(signedPreKeySig) == 64 {
		device.SignedPreKey = &keys.PreKey{
			KeyID:     uint32(signedPreKeyID),
			Signature: new([64]byte),
		}
		copy(device.SignedPreKey.Priv[:], signedPreKey)
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

// ===============================
// IdentityStore Implementation
// ===============================

// PutIdentity stores an identity key.
func (s *PGSQLStore) PutIdentity(ctx context.Context, address string, key [32]byte) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_identity_keys (connection_id, our_jid, their_id, identity)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, our_jid, their_id) DO UPDATE SET identity = EXCLUDED.identity
	`, s.connectionID, s.JID, address, key[:])
	return err
}

// IsTrustedIdentity checks if an identity key is trusted.
func (s *PGSQLStore) IsTrustedIdentity(ctx context.Context, address string, key [32]byte) (bool, error) {
	var storedKey []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT identity FROM whatsmeow_identity_keys
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = $3
	`, s.connectionID, s.JID, address).Scan(&storedKey)

	if err == sql.ErrNoRows {
		// No identity stored, trust this one
		return true, nil
	}
	if err != nil {
		return false, err
	}

	// Compare stored key with provided key
	if len(storedKey) != 32 {
		return true, nil
	}

	var stored [32]byte
	copy(stored[:], storedKey)
	return stored == key, nil
}

// DeleteIdentity removes an identity.
func (s *PGSQLStore) DeleteIdentity(ctx context.Context, address string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_identity_keys
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = $3
	`, s.connectionID, s.JID, address)
	return err
}

// DeleteAllIdentities removes all identities for a phone.
func (s *PGSQLStore) DeleteAllIdentities(ctx context.Context, phone string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_identity_keys
		WHERE connection_id = $1 AND our_jid = $2 AND their_id LIKE $3
	`, s.connectionID, s.JID, phone+":%")
	return err
}

// ===============================
// SessionStore Implementation
// ===============================

// GetSession retrieves a session.
func (s *PGSQLStore) GetSession(ctx context.Context, address string) ([]byte, error) {
	var session []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT session FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = $3
	`, s.connectionID, s.JID, address).Scan(&session)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	return session, err
}

// GetManySessions retrieves multiple sessions.
func (s *PGSQLStore) GetManySessions(ctx context.Context, addresses []string) (map[string][]byte, error) {
	result := make(map[string][]byte)
	if len(addresses) == 0 {
		return result, nil
	}

	// Build query with placeholders
	query := `SELECT their_id, session FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = ANY($3)`

	rows, err := s.db.QueryContext(ctx, query, s.connectionID, s.JID, addresses)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var theirID string
		var session []byte
		if err := rows.Scan(&theirID, &session); err != nil {
			return nil, err
		}
		result[theirID] = session
	}

	return result, rows.Err()
}

// HasSession checks if a session exists.
func (s *PGSQLStore) HasSession(ctx context.Context, address string) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = $3)
	`, s.connectionID, s.JID, address).Scan(&exists)
	return exists, err
}

// PutSession stores a session.
func (s *PGSQLStore) PutSession(ctx context.Context, address string, session []byte) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_sessions (connection_id, our_jid, their_id, session)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, our_jid, their_id) DO UPDATE SET session = EXCLUDED.session
	`, s.connectionID, s.JID, address, session)
	return err
}

// PutManySessions stores multiple sessions.
func (s *PGSQLStore) PutManySessions(ctx context.Context, sessions map[string][]byte) error {
	if len(sessions) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO whatsmeow_sessions (connection_id, our_jid, their_id, session)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, our_jid, their_id) DO UPDATE SET session = EXCLUDED.session
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for address, session := range sessions {
		if _, err := stmt.ExecContext(ctx, s.connectionID, s.JID, address, session); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// DeleteSession removes a session.
func (s *PGSQLStore) DeleteSession(ctx context.Context, address string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $2 AND their_id = $3
	`, s.connectionID, s.JID, address)
	return err
}

// DeleteAllSessions removes all sessions for a phone.
func (s *PGSQLStore) DeleteAllSessions(ctx context.Context, phone string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $2 AND their_id LIKE $3
	`, s.connectionID, s.JID, phone+":%")
	return err
}

// MigratePNToLID migrates sessions from phone number to LID.
func (s *PGSQLStore) MigratePNToLID(ctx context.Context, pn, lid types.JID) error {
	pnUser := pn.User
	lidUser := lid.User

	// Migrate sessions
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_sessions (connection_id, our_jid, their_id, session)
		SELECT connection_id, our_jid, REPLACE(their_id, $2, $3), session
		FROM whatsmeow_sessions
		WHERE connection_id = $1 AND our_jid = $4 AND their_id LIKE $2 || ':%'
		ON CONFLICT (connection_id, our_jid, their_id) DO UPDATE SET session = EXCLUDED.session
	`, s.connectionID, pnUser, lidUser, s.JID)

	return err
}

// ===============================
// PreKeyStore Implementation
// ===============================

// GetOrGenPreKeys gets or generates pre-keys.
func (s *PGSQLStore) GetOrGenPreKeys(ctx context.Context, count uint32) ([]*keys.PreKey, error) {
	// First, try to get existing unuploaded pre-keys
	rows, err := s.db.QueryContext(ctx, `
		SELECT key_id, key FROM whatsmeow_pre_keys
		WHERE connection_id = $1 AND jid = $2 AND uploaded = false
		ORDER BY key_id LIMIT $3
	`, s.connectionID, s.JID, count)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var preKeys []*keys.PreKey
	for rows.Next() {
		var keyID uint32
		var keyData []byte
		if err := rows.Scan(&keyID, &keyData); err != nil {
			return nil, err
		}

		preKey := &keys.PreKey{KeyID: keyID}
		if len(keyData) >= 32 {
			copy(preKey.Priv[:], keyData[:32])
		}
		preKeys = append(preKeys, preKey)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	// If we have enough, return them
	if uint32(len(preKeys)) >= count {
		return preKeys[:count], nil
	}

	// Generate more pre-keys
	var maxID uint32
	err = s.db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(key_id), 0) FROM whatsmeow_pre_keys
		WHERE connection_id = $1 AND jid = $2
	`, s.connectionID, s.JID).Scan(&maxID)
	if err != nil {
		return nil, err
	}

	needed := count - uint32(len(preKeys))
	for i := uint32(0); i < needed; i++ {
		keyID := maxID + i + 1
		preKey := keys.NewPreKey(keyID)

		_, err := s.db.ExecContext(ctx, `
			INSERT INTO whatsmeow_pre_keys (connection_id, jid, key_id, key, uploaded)
			VALUES ($1, $2, $3, $4, false)
		`, s.connectionID, s.JID, keyID, preKey.Priv[:])
		if err != nil {
			return nil, err
		}

		preKeys = append(preKeys, preKey)
	}

	return preKeys, nil
}

// GenOnePreKey generates a single pre-key.
func (s *PGSQLStore) GenOnePreKey(ctx context.Context) (*keys.PreKey, error) {
	preKeys, err := s.GetOrGenPreKeys(ctx, 1)
	if err != nil {
		return nil, err
	}
	if len(preKeys) == 0 {
		return nil, fmt.Errorf("failed to generate pre-key")
	}
	return preKeys[0], nil
}

// GetPreKey retrieves a pre-key by ID.
func (s *PGSQLStore) GetPreKey(ctx context.Context, id uint32) (*keys.PreKey, error) {
	var keyData []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT key FROM whatsmeow_pre_keys
		WHERE connection_id = $1 AND jid = $2 AND key_id = $3
	`, s.connectionID, s.JID, id).Scan(&keyData)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	preKey := &keys.PreKey{KeyID: id}
	if len(keyData) >= 32 {
		copy(preKey.Priv[:], keyData[:32])
	}
	return preKey, nil
}

// RemovePreKey removes a pre-key.
func (s *PGSQLStore) RemovePreKey(ctx context.Context, id uint32) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_pre_keys
		WHERE connection_id = $1 AND jid = $2 AND key_id = $3
	`, s.connectionID, s.JID, id)
	return err
}

// MarkPreKeysAsUploaded marks pre-keys as uploaded.
func (s *PGSQLStore) MarkPreKeysAsUploaded(ctx context.Context, upToID uint32) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE whatsmeow_pre_keys SET uploaded = true
		WHERE connection_id = $1 AND jid = $2 AND key_id <= $3
	`, s.connectionID, s.JID, upToID)
	return err
}

// UploadedPreKeyCount returns the count of uploaded pre-keys.
func (s *PGSQLStore) UploadedPreKeyCount(ctx context.Context) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM whatsmeow_pre_keys
		WHERE connection_id = $1 AND jid = $2 AND uploaded = true
	`, s.connectionID, s.JID).Scan(&count)
	return count, err
}

// ===============================
// SenderKeyStore Implementation
// ===============================

// GetSenderKey retrieves a sender key.
func (s *PGSQLStore) GetSenderKey(ctx context.Context, group, user string) ([]byte, error) {
	var senderKey []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT sender_key FROM whatsmeow_sender_keys
		WHERE connection_id = $1 AND our_jid = $2 AND chat_id = $3 AND sender_id = $4
	`, s.connectionID, s.JID, group, user).Scan(&senderKey)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	return senderKey, err
}

// PutSenderKey stores a sender key.
func (s *PGSQLStore) PutSenderKey(ctx context.Context, group, user string, session []byte) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_sender_keys (connection_id, our_jid, chat_id, sender_id, sender_key)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (connection_id, our_jid, chat_id, sender_id) DO UPDATE SET sender_key = EXCLUDED.sender_key
	`, s.connectionID, s.JID, group, user, session)
	return err
}

// ===============================
// AppStateSyncKeyStore Implementation
// ===============================

// PutAppStateSyncKey stores an app state sync key.
func (s *PGSQLStore) PutAppStateSyncKey(ctx context.Context, id []byte, key store.AppStateSyncKey) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_app_state_sync_keys (connection_id, jid, key_id, key_data, timestamp, fingerprint)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (connection_id, jid, key_id) DO UPDATE SET
			key_data = EXCLUDED.key_data,
			timestamp = EXCLUDED.timestamp,
			fingerprint = EXCLUDED.fingerprint
		WHERE EXCLUDED.timestamp > whatsmeow_app_state_sync_keys.timestamp
	`, s.connectionID, s.JID, id, key.Data, key.Timestamp, key.Fingerprint)
	return err
}

// GetAppStateSyncKey retrieves an app state sync key.
func (s *PGSQLStore) GetAppStateSyncKey(ctx context.Context, id []byte) (*store.AppStateSyncKey, error) {
	var keyData, fingerprint []byte
	var timestamp int64

	err := s.db.QueryRowContext(ctx, `
		SELECT key_data, timestamp, fingerprint FROM whatsmeow_app_state_sync_keys
		WHERE connection_id = $1 AND jid = $2 AND key_id = $3
	`, s.connectionID, s.JID, id).Scan(&keyData, &timestamp, &fingerprint)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &store.AppStateSyncKey{
		Data:        keyData,
		Fingerprint: fingerprint,
		Timestamp:   timestamp,
	}, nil
}

// GetLatestAppStateSyncKeyID retrieves the latest app state sync key ID.
func (s *PGSQLStore) GetLatestAppStateSyncKeyID(ctx context.Context) ([]byte, error) {
	var keyID []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT key_id FROM whatsmeow_app_state_sync_keys
		WHERE connection_id = $1 AND jid = $2
		ORDER BY timestamp DESC LIMIT 1
	`, s.connectionID, s.JID).Scan(&keyID)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	return keyID, err
}

// ===============================
// AppStateStore Implementation
// ===============================

// PutAppStateVersion stores the app state version.
func (s *PGSQLStore) PutAppStateVersion(ctx context.Context, name string, version uint64, hash [128]byte) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_app_state_version (connection_id, jid, name, version, hash)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (connection_id, jid, name) DO UPDATE SET
			version = EXCLUDED.version,
			hash = EXCLUDED.hash
	`, s.connectionID, s.JID, name, version, hash[:])
	return err
}

// GetAppStateVersion retrieves the app state version.
func (s *PGSQLStore) GetAppStateVersion(ctx context.Context, name string) (uint64, [128]byte, error) {
	var version uint64
	var hashBytes []byte
	var hash [128]byte

	err := s.db.QueryRowContext(ctx, `
		SELECT version, hash FROM whatsmeow_app_state_version
		WHERE connection_id = $1 AND jid = $2 AND name = $3
	`, s.connectionID, s.JID, name).Scan(&version, &hashBytes)

	if err == sql.ErrNoRows {
		return 0, hash, nil
	}
	if err != nil {
		return 0, hash, err
	}

	if len(hashBytes) == 128 {
		copy(hash[:], hashBytes)
	}
	return version, hash, nil
}

// DeleteAppStateVersion deletes the app state version.
func (s *PGSQLStore) DeleteAppStateVersion(ctx context.Context, name string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_app_state_version
		WHERE connection_id = $1 AND jid = $2 AND name = $3
	`, s.connectionID, s.JID, name)
	return err
}

// PutAppStateMutationMACs stores mutation MACs.
func (s *PGSQLStore) PutAppStateMutationMACs(ctx context.Context, name string, version uint64, mutations []store.AppStateMutationMAC) error {
	if len(mutations) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO whatsmeow_app_state_mutation_macs (connection_id, jid, name, version, index_mac, value_mac)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (connection_id, jid, name, version, index_mac) DO UPDATE SET value_mac = EXCLUDED.value_mac
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, mutation := range mutations {
		if _, err := stmt.ExecContext(ctx, s.connectionID, s.JID, name, version, mutation.IndexMAC, mutation.ValueMAC); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// DeleteAppStateMutationMACs deletes mutation MACs.
func (s *PGSQLStore) DeleteAppStateMutationMACs(ctx context.Context, name string, indexMACs [][]byte) error {
	if len(indexMACs) == 0 {
		return nil
	}

	// Convert to hex strings for the query
	hexMACs := make([]string, len(indexMACs))
	for i, mac := range indexMACs {
		hexMACs[i] = hex.EncodeToString(mac)
	}

	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_app_state_mutation_macs
		WHERE connection_id = $1 AND jid = $2 AND name = $3 AND encode(index_mac, 'hex') = ANY($4)
	`, s.connectionID, s.JID, name, hexMACs)
	return err
}

// GetAppStateMutationMAC retrieves a mutation MAC.
func (s *PGSQLStore) GetAppStateMutationMAC(ctx context.Context, name string, indexMAC []byte) ([]byte, error) {
	var valueMAC []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT value_mac FROM whatsmeow_app_state_mutation_macs
		WHERE connection_id = $1 AND jid = $2 AND name = $3 AND index_mac = $4
		ORDER BY version DESC LIMIT 1
	`, s.connectionID, s.JID, name, indexMAC).Scan(&valueMAC)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	return valueMAC, err
}

// ===============================
// ContactStore Implementation
// ===============================

// PutPushName stores a push name for a contact.
func (s *PGSQLStore) PutPushName(ctx context.Context, user types.JID, pushName string) (bool, string, error) {
	var oldPushName *string
	err := s.db.QueryRowContext(ctx, `
		SELECT push_name FROM whatsmeow_contacts
		WHERE connection_id = $1 AND our_jid = $2 AND their_jid = $3
	`, s.connectionID, s.JID, user.String()).Scan(&oldPushName)

	if err != nil && err != sql.ErrNoRows {
		return false, "", err
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_contacts (connection_id, our_jid, their_jid, push_name)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, our_jid, their_jid) DO UPDATE SET push_name = EXCLUDED.push_name
	`, s.connectionID, s.JID, user.String(), pushName)

	if err != nil {
		return false, "", err
	}

	changed := oldPushName == nil || *oldPushName != pushName
	if oldPushName == nil {
		return changed, "", nil
	}
	return changed, *oldPushName, nil
}

// PutBusinessName stores a business name for a contact.
func (s *PGSQLStore) PutBusinessName(ctx context.Context, user types.JID, businessName string) (bool, string, error) {
	var oldBusinessName *string
	err := s.db.QueryRowContext(ctx, `
		SELECT business_name FROM whatsmeow_contacts
		WHERE connection_id = $1 AND our_jid = $2 AND their_jid = $3
	`, s.connectionID, s.JID, user.String()).Scan(&oldBusinessName)

	if err != nil && err != sql.ErrNoRows {
		return false, "", err
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_contacts (connection_id, our_jid, their_jid, business_name)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, our_jid, their_jid) DO UPDATE SET business_name = EXCLUDED.business_name
	`, s.connectionID, s.JID, user.String(), businessName)

	if err != nil {
		return false, "", err
	}

	changed := oldBusinessName == nil || *oldBusinessName != businessName
	if oldBusinessName == nil {
		return changed, "", nil
	}
	return changed, *oldBusinessName, nil
}

// PutContactName stores contact name.
func (s *PGSQLStore) PutContactName(ctx context.Context, user types.JID, fullName, firstName string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_contacts (connection_id, our_jid, their_jid, first_name, full_name)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (connection_id, our_jid, their_jid) DO UPDATE SET
			first_name = EXCLUDED.first_name,
			full_name = EXCLUDED.full_name
	`, s.connectionID, s.JID, user.String(), firstName, fullName)
	return err
}

// PutAllContactNames stores multiple contact names.
func (s *PGSQLStore) PutAllContactNames(ctx context.Context, contacts []store.ContactEntry) error {
	if len(contacts) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO whatsmeow_contacts (connection_id, our_jid, their_jid, first_name, full_name)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (connection_id, our_jid, their_jid) DO UPDATE SET
			first_name = EXCLUDED.first_name,
			full_name = EXCLUDED.full_name
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, contact := range contacts {
		if _, err := stmt.ExecContext(ctx, s.connectionID, s.JID, contact.JID.String(), contact.FirstName, contact.FullName); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// PutManyRedactedPhones stores redacted phone entries (stub implementation).
func (s *PGSQLStore) PutManyRedactedPhones(ctx context.Context, entries []store.RedactedPhoneEntry) error {
	// The contacts table doesn't have a redacted_phone column in our schema
	// This is a no-op for now
	return nil
}

// GetContact retrieves contact info.
func (s *PGSQLStore) GetContact(ctx context.Context, user types.JID) (types.ContactInfo, error) {
	var info types.ContactInfo
	var firstName, fullName, pushName, businessName *string

	err := s.db.QueryRowContext(ctx, `
		SELECT first_name, full_name, push_name, business_name
		FROM whatsmeow_contacts
		WHERE connection_id = $1 AND our_jid = $2 AND their_jid = $3
	`, s.connectionID, s.JID, user.String()).Scan(&firstName, &fullName, &pushName, &businessName)

	if err == sql.ErrNoRows {
		return info, nil
	}
	if err != nil {
		return info, err
	}

	if firstName != nil {
		info.FirstName = *firstName
	}
	if fullName != nil {
		info.FullName = *fullName
	}
	if pushName != nil {
		info.PushName = *pushName
	}
	if businessName != nil {
		info.BusinessName = *businessName
	}

	return info, nil
}

// GetAllContacts retrieves all contacts.
func (s *PGSQLStore) GetAllContacts(ctx context.Context) (map[types.JID]types.ContactInfo, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT their_jid, first_name, full_name, push_name, business_name
		FROM whatsmeow_contacts
		WHERE connection_id = $1 AND our_jid = $2
	`, s.connectionID, s.JID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	contacts := make(map[types.JID]types.ContactInfo)

	for rows.Next() {
		var jidStr string
		var firstName, fullName, pushName, businessName *string

		if err := rows.Scan(&jidStr, &firstName, &fullName, &pushName, &businessName); err != nil {
			return nil, err
		}

		jid, err := types.ParseJID(jidStr)
		if err != nil {
			continue
		}

		var info types.ContactInfo
		if firstName != nil {
			info.FirstName = *firstName
		}
		if fullName != nil {
			info.FullName = *fullName
		}
		if pushName != nil {
			info.PushName = *pushName
		}
		if businessName != nil {
			info.BusinessName = *businessName
		}

		contacts[jid] = info
	}

	return contacts, rows.Err()
}

// ===============================
// ChatSettingsStore Implementation
// ===============================

// PutMutedUntil sets the muted until time for a chat.
func (s *PGSQLStore) PutMutedUntil(ctx context.Context, chat types.JID, mutedUntil time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_chat_settings (connection_id, our_jid, chat_jid, muted_until)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, our_jid, chat_jid) DO UPDATE SET muted_until = EXCLUDED.muted_until
	`, s.connectionID, s.JID, chat.String(), mutedUntil.Unix())
	return err
}

// PutPinned sets the pinned status for a chat.
func (s *PGSQLStore) PutPinned(ctx context.Context, chat types.JID, pinned bool) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_chat_settings (connection_id, our_jid, chat_jid, pinned)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, our_jid, chat_jid) DO UPDATE SET pinned = EXCLUDED.pinned
	`, s.connectionID, s.JID, chat.String(), pinned)
	return err
}

// PutArchived sets the archived status for a chat.
func (s *PGSQLStore) PutArchived(ctx context.Context, chat types.JID, archived bool) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_chat_settings (connection_id, our_jid, chat_jid, archived)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (connection_id, our_jid, chat_jid) DO UPDATE SET archived = EXCLUDED.archived
	`, s.connectionID, s.JID, chat.String(), archived)
	return err
}

// GetChatSettings retrieves chat settings.
func (s *PGSQLStore) GetChatSettings(ctx context.Context, chat types.JID) (types.LocalChatSettings, error) {
	var settings types.LocalChatSettings

	err := s.db.QueryRowContext(ctx, `
		SELECT muted_until, pinned, archived
		FROM whatsmeow_chat_settings
		WHERE connection_id = $1 AND our_jid = $2 AND chat_jid = $3
	`, s.connectionID, s.JID, chat.String()).Scan(&settings.MutedUntil, &settings.Pinned, &settings.Archived)

	if err == sql.ErrNoRows {
		return settings, nil
	}
	return settings, err
}

// ============================================
// LIDStore interface implementation
// ============================================

// PutManyLIDMappings stores multiple LID to JID mappings.
func (s *PGSQLStore) PutManyLIDMappings(ctx context.Context, mappings []store.LIDMapping) error {
	if len(mappings) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO whatsmeow_lid_mappings (connection_id, lid, jid)
		VALUES ($1, $2, $3)
		ON CONFLICT (connection_id, lid) DO UPDATE SET jid = EXCLUDED.jid
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, m := range mappings {
		_, err = stmt.ExecContext(ctx, s.connectionID, m.LID.String(), m.PN.String())
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

// PutLIDMapping stores a single LID to JID mapping.
func (s *PGSQLStore) PutLIDMapping(ctx context.Context, lid, jid types.JID) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_lid_mappings (connection_id, lid, jid)
		VALUES ($1, $2, $3)
		ON CONFLICT (connection_id, lid) DO UPDATE SET jid = EXCLUDED.jid
	`, s.connectionID, lid.String(), jid.String())
	return err
}

// GetPNForLID retrieves the phone number JID for a LID.
func (s *PGSQLStore) GetPNForLID(ctx context.Context, lid types.JID) (types.JID, error) {
	var jidStr string
	err := s.db.QueryRowContext(ctx, `
		SELECT jid FROM whatsmeow_lid_mappings
		WHERE connection_id = $1 AND lid = $2
	`, s.connectionID, lid.String()).Scan(&jidStr)

	if err == sql.ErrNoRows {
		return types.EmptyJID, nil
	}
	if err != nil {
		return types.EmptyJID, err
	}

	return types.ParseJID(jidStr)
}

// GetLIDForPN retrieves the LID for a phone number JID.
func (s *PGSQLStore) GetLIDForPN(ctx context.Context, pn types.JID) (types.JID, error) {
	var lidStr string
	err := s.db.QueryRowContext(ctx, `
		SELECT lid FROM whatsmeow_lid_mappings
		WHERE connection_id = $1 AND jid = $2
	`, s.connectionID, pn.String()).Scan(&lidStr)

	if err == sql.ErrNoRows {
		return types.EmptyJID, nil
	}
	if err != nil {
		return types.EmptyJID, err
	}

	return types.ParseJID(lidStr)
}

// GetManyLIDsForPNs retrieves LIDs for multiple phone number JIDs.
func (s *PGSQLStore) GetManyLIDsForPNs(ctx context.Context, pns []types.JID) (map[types.JID]types.JID, error) {
	result := make(map[types.JID]types.JID)
	if len(pns) == 0 {
		return result, nil
	}

	// Build query with placeholders
	query := `SELECT lid, jid FROM whatsmeow_lid_mappings WHERE connection_id = $1 AND jid = ANY($2)`

	pnStrs := make([]string, len(pns))
	for i, pn := range pns {
		pnStrs[i] = pn.String()
	}

	rows, err := s.db.QueryContext(ctx, query, s.connectionID, pnStrs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var lidStr, jidStr string
		if err := rows.Scan(&lidStr, &jidStr); err != nil {
			return nil, err
		}

		lid, err := types.ParseJID(lidStr)
		if err != nil {
			continue
		}
		jid, err := types.ParseJID(jidStr)
		if err != nil {
			continue
		}

		result[jid] = lid
	}

	return result, rows.Err()
}

// ============================================
// MsgSecretStore interface implementation
// ============================================

// PutMessageSecrets stores multiple message secrets.
func (s *PGSQLStore) PutMessageSecrets(ctx context.Context, inserts []store.MessageSecretInsert) error {
	if len(inserts) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO whatsmeow_message_secrets (connection_id, our_jid, chat_jid, sender_jid, message_id, secret)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (connection_id, our_jid, chat_jid, sender_jid, message_id) DO UPDATE SET secret = EXCLUDED.secret
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, insert := range inserts {
		_, err = stmt.ExecContext(ctx, s.connectionID, s.JID, insert.Chat.String(), insert.Sender.String(), string(insert.ID), insert.Secret)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

// PutMessageSecret stores a single message secret.
func (s *PGSQLStore) PutMessageSecret(ctx context.Context, chat, sender types.JID, id types.MessageID, secret []byte) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_message_secrets (connection_id, our_jid, chat_jid, sender_jid, message_id, secret)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (connection_id, our_jid, chat_jid, sender_jid, message_id) DO UPDATE SET secret = EXCLUDED.secret
	`, s.connectionID, s.JID, chat.String(), sender.String(), string(id), secret)
	return err
}

// GetMessageSecret retrieves a message secret.
func (s *PGSQLStore) GetMessageSecret(ctx context.Context, chat, sender types.JID, id types.MessageID) ([]byte, types.JID, error) {
	var secret []byte
	var senderStr string

	err := s.db.QueryRowContext(ctx, `
		SELECT secret, sender_jid FROM whatsmeow_message_secrets
		WHERE connection_id = $1 AND our_jid = $2 AND chat_jid = $3 AND sender_jid = $4 AND message_id = $5
	`, s.connectionID, s.JID, chat.String(), sender.String(), string(id)).Scan(&secret, &senderStr)

	if err == sql.ErrNoRows {
		return nil, types.EmptyJID, nil
	}
	if err != nil {
		return nil, types.EmptyJID, err
	}

	senderJID, err := types.ParseJID(senderStr)
	if err != nil {
		return secret, types.EmptyJID, nil
	}

	return secret, senderJID, nil
}

// ============================================
// PrivacyTokenStore interface implementation
// ============================================

// PutPrivacyTokens stores multiple privacy tokens.
func (s *PGSQLStore) PutPrivacyTokens(ctx context.Context, tokens ...store.PrivacyToken) error {
	if len(tokens) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO whatsmeow_privacy_tokens (connection_id, our_jid, user_jid, token, timestamp)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (connection_id, our_jid, user_jid) DO UPDATE SET token = EXCLUDED.token, timestamp = EXCLUDED.timestamp
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, token := range tokens {
		_, err = stmt.ExecContext(ctx, s.connectionID, s.JID, token.User.String(), token.Token, token.Timestamp.Unix())
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetPrivacyToken retrieves a privacy token for a user.
func (s *PGSQLStore) GetPrivacyToken(ctx context.Context, user types.JID) (*store.PrivacyToken, error) {
	var token []byte
	var timestamp int64

	err := s.db.QueryRowContext(ctx, `
		SELECT token, timestamp FROM whatsmeow_privacy_tokens
		WHERE connection_id = $1 AND our_jid = $2 AND user_jid = $3
	`, s.connectionID, s.JID, user.String()).Scan(&token, &timestamp)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &store.PrivacyToken{
		User:      user,
		Token:     token,
		Timestamp: time.Unix(timestamp, 0),
	}, nil
}

