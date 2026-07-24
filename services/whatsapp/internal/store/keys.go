package store

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/util/keys"
)

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
	var corruptedKeyIDs []uint32
	emptyKey := [32]byte{}

	for rows.Next() {
		var keyID uint32
		var keyData []byte
		if err := rows.Scan(&keyID, &keyData); err != nil {
			return nil, err
		}

		// Properly initialize PreKey with KeyPair from stored private key
		var privKey [32]byte
		if len(keyData) >= 32 {
			copy(privKey[:], keyData[:32])
		}
		keyPair := keys.NewKeyPairFromPrivateKey(privKey)

		// Validate the PreKey has valid public key (detects corrupted keys)
		if keyPair.Pub == nil || *keyPair.Pub == emptyKey {
			log.Printf("Detected corrupted PreKey %d with empty public key in GetOrGenPreKeys", keyID)
			corruptedKeyIDs = append(corruptedKeyIDs, keyID)
			continue // Skip corrupted keys
		}

		preKey := &keys.PreKey{
			KeyPair: *keyPair,
			KeyID:   keyID,
		}
		preKeys = append(preKeys, preKey)
	}

	// Clean up corrupted keys in background
	for _, keyID := range corruptedKeyIDs {
		_, _ = s.db.ExecContext(ctx, `
			DELETE FROM whatsmeow_pre_keys
			WHERE connection_id = $1 AND jid = $2 AND key_id = $3
		`, s.connectionID, s.JID, keyID)
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

	// Properly initialize PreKey with KeyPair from stored private key
	var privKey [32]byte
	if len(keyData) >= 32 {
		copy(privKey[:], keyData[:32])
	}
	keyPair := keys.NewKeyPairFromPrivateKey(privKey)

	// Validate the PreKey has valid public key (detects corrupted keys from before the fix)
	emptyKey := [32]byte{}
	if keyPair.Pub == nil || *keyPair.Pub == emptyKey {
		log.Printf("Detected corrupted PreKey %d with empty public key, removing it", id)
		// Remove the corrupted key so whatsmeow will generate a new one
		_, _ = s.db.ExecContext(ctx, `
			DELETE FROM whatsmeow_pre_keys
			WHERE connection_id = $1 AND jid = $2 AND key_id = $3
		`, s.connectionID, s.JID, id)
		return nil, nil
	}

	preKey := &keys.PreKey{
		KeyPair: *keyPair,
		KeyID:   id,
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

// GetAllAppStateSyncKeys returns every sync key for the current device.
func (s *PGSQLStore) GetAllAppStateSyncKeys(ctx context.Context) ([]*store.AppStateSyncKey, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT key_data, timestamp, fingerprint FROM whatsmeow_app_state_sync_keys
		WHERE connection_id = $1 AND jid = $2
		ORDER BY timestamp DESC
	`, s.connectionID, s.JID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	keys := make([]*store.AppStateSyncKey, 0)
	for rows.Next() {
		key := &store.AppStateSyncKey{}
		if err := rows.Scan(&key.Data, &key.Timestamp, &key.Fingerprint); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
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
