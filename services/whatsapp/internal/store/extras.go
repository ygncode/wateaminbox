package store

import (
	"context"
	"database/sql"
	"time"

	"github.com/lib/pq"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

// ============================================
// LIDStore interface implementation
// ============================================

func normalizedMappingJID(jid types.JID) string {
	return jid.ToNonAD().String()
}

func mappedDeviceJID(stored string, source types.JID) (types.JID, error) {
	mapped, err := types.ParseJID(stored)
	if err != nil {
		return types.EmptyJID, err
	}
	mapped.Device = source.Device
	return mapped, nil
}

// PutManyLIDMappings stores identity-level mappings. Device numbers are applied
// when a mapping is read, matching whatsmeow's built-in SQL store behavior.
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

	for _, mapping := range mappings {
		_, err = stmt.ExecContext(
			ctx,
			s.connectionID,
			normalizedMappingJID(mapping.LID),
			normalizedMappingJID(mapping.PN),
		)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

// PutLIDMapping stores a single identity-level LID to phone-number mapping.
func (s *PGSQLStore) PutLIDMapping(ctx context.Context, lid, jid types.JID) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_lid_mappings (connection_id, lid, jid)
		VALUES ($1, $2, $3)
		ON CONFLICT (connection_id, lid) DO UPDATE SET jid = EXCLUDED.jid
	`, s.connectionID, normalizedMappingJID(lid), normalizedMappingJID(jid))
	return err
}

// GetPNForLID retrieves the phone number JID for a LID and preserves the
// requested device number.
func (s *PGSQLStore) GetPNForLID(ctx context.Context, lid types.JID) (types.JID, error) {
	var jidStr string
	err := s.db.QueryRowContext(ctx, `
		SELECT jid FROM whatsmeow_lid_mappings
		WHERE connection_id = $1 AND lid = $2
	`, s.connectionID, normalizedMappingJID(lid)).Scan(&jidStr)

	if err == sql.ErrNoRows {
		return types.EmptyJID, nil
	}
	if err != nil {
		return types.EmptyJID, err
	}

	return mappedDeviceJID(jidStr, lid)
}

// GetLIDForPN retrieves the LID for a phone number JID and preserves the
// requested device number.
func (s *PGSQLStore) GetLIDForPN(ctx context.Context, pn types.JID) (types.JID, error) {
	var lidStr string
	err := s.db.QueryRowContext(ctx, `
		SELECT lid FROM whatsmeow_lid_mappings
		WHERE connection_id = $1 AND jid = $2
	`, s.connectionID, normalizedMappingJID(pn)).Scan(&lidStr)

	if err == sql.ErrNoRows {
		return types.EmptyJID, nil
	}
	if err != nil {
		return types.EmptyJID, err
	}

	return mappedDeviceJID(lidStr, pn)
}

// GetManyLIDsForPNs retrieves LIDs for multiple phone-number devices.
func (s *PGSQLStore) GetManyLIDsForPNs(ctx context.Context, pns []types.JID) (map[types.JID]types.JID, error) {
	result := make(map[types.JID]types.JID)
	if len(pns) == 0 {
		return result, nil
	}

	devicesByPN := make(map[string][]types.JID)
	pnStrs := make([]string, 0, len(pns))
	for _, pn := range pns {
		normalized := normalizedMappingJID(pn)
		if _, exists := devicesByPN[normalized]; !exists {
			pnStrs = append(pnStrs, normalized)
		}
		devicesByPN[normalized] = append(devicesByPN[normalized], pn)
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT lid, jid FROM whatsmeow_lid_mappings
		WHERE connection_id = $1 AND jid = ANY($2)
	`, s.connectionID, pq.Array(pnStrs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var lidStr, jidStr string
		if err := rows.Scan(&lidStr, &jidStr); err != nil {
			return nil, err
		}
		for _, pn := range devicesByPN[jidStr] {
			lid, parseErr := mappedDeviceJID(lidStr, pn)
			if parseErr == nil {
				result[pn] = lid
			}
		}
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

// DeleteExpiredPrivacyTokens removes expired tokens for the current device.
func (s *PGSQLStore) DeleteExpiredPrivacyTokens(ctx context.Context, cutoff time.Time) (int64, error) {
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_privacy_tokens
		WHERE connection_id = $1 AND our_jid = $2 AND timestamp < $3
	`, s.connectionID, s.JID, cutoff.Unix())
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
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

// ============================================
// NCTSaltStore interface implementation
// ============================================

func (s *PGSQLStore) PutNCTSalt(ctx context.Context, salt []byte) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_nct_salt (connection_id, our_jid, salt)
		VALUES ($1, $2, $3)
		ON CONFLICT (connection_id, our_jid) DO UPDATE SET salt = EXCLUDED.salt
	`, s.connectionID, s.JID, salt)
	return err
}

func (s *PGSQLStore) GetNCTSalt(ctx context.Context) ([]byte, error) {
	var salt []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT salt FROM whatsmeow_nct_salt
		WHERE connection_id = $1 AND our_jid = $2
	`, s.connectionID, s.JID).Scan(&salt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return salt, err
}

func (s *PGSQLStore) DeleteNCTSalt(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_nct_salt
		WHERE connection_id = $1 AND our_jid = $2
	`, s.connectionID, s.JID)
	return err
}

// ============================================
// EventBuffer interface implementation
// ============================================

func (s *PGSQLStore) GetBufferedEvent(ctx context.Context, ciphertextHash [32]byte) (*store.BufferedEvent, error) {
	var plaintext []byte
	var serverTimestamp, insertTimestamp int64
	err := s.db.QueryRowContext(ctx, `
		SELECT plaintext, server_timestamp, insert_timestamp
		FROM whatsmeow_event_buffer
		WHERE connection_id = $1 AND our_jid = $2 AND ciphertext_hash = $3
	`, s.connectionID, s.JID, ciphertextHash[:]).Scan(&plaintext, &serverTimestamp, &insertTimestamp)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &store.BufferedEvent{
		Plaintext:  plaintext,
		ServerTime: time.Unix(serverTimestamp, 0),
		InsertTime: time.UnixMilli(insertTimestamp),
	}, nil
}

func (s *PGSQLStore) PutBufferedEvent(ctx context.Context, ciphertextHash [32]byte, plaintext []byte, serverTimestamp time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_event_buffer (
			connection_id, our_jid, ciphertext_hash, plaintext,
			server_timestamp, insert_timestamp
		) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (connection_id, our_jid, ciphertext_hash) DO UPDATE SET
			plaintext = EXCLUDED.plaintext,
			server_timestamp = EXCLUDED.server_timestamp
	`, s.connectionID, s.JID, ciphertextHash[:], plaintext, serverTimestamp.Unix(), time.Now().UnixMilli())
	return err
}

// database/sql cannot attach a transaction to context like whatsmeow's dbutil
// wrapper does. The individual store writes remain atomic, and this hook keeps
// the decryption flow compatible with the EventBuffer interface.
func (s *PGSQLStore) DoDecryptionTxn(ctx context.Context, fn func(context.Context) error) error {
	return fn(ctx)
}

func (s *PGSQLStore) ClearBufferedEventPlaintext(ctx context.Context, ciphertextHash [32]byte) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE whatsmeow_event_buffer SET plaintext = NULL
		WHERE connection_id = $1 AND our_jid = $2 AND ciphertext_hash = $3
	`, s.connectionID, s.JID, ciphertextHash[:])
	return err
}

func (s *PGSQLStore) DeleteOldBufferedHashes(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_event_buffer
		WHERE connection_id = $1 AND our_jid = $2 AND insert_timestamp < $3
	`, s.connectionID, s.JID, time.Now().Add(-14*24*time.Hour).UnixMilli())
	return err
}

func (s *PGSQLStore) GetOutgoingEvent(ctx context.Context, chatJID, altChatJID types.JID, id types.MessageID) (string, []byte, error) {
	var format string
	var plaintext []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT format, plaintext FROM whatsmeow_retry_buffer
		WHERE connection_id = $1 AND our_jid = $2
			AND (chat_jid = $3 OR chat_jid = $4) AND message_id = $5
	`, s.connectionID, s.JID, chatJID.String(), altChatJID.String(), string(id)).Scan(&format, &plaintext)
	if err == sql.ErrNoRows {
		return "", nil, nil
	}
	return format, plaintext, err
}

func (s *PGSQLStore) AddOutgoingEvent(ctx context.Context, chatJID types.JID, id types.MessageID, format string, plaintext []byte) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO whatsmeow_retry_buffer (
			connection_id, our_jid, chat_jid, message_id, format, plaintext, timestamp
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (connection_id, our_jid, chat_jid, message_id) DO UPDATE SET
			format = EXCLUDED.format,
			plaintext = EXCLUDED.plaintext,
			timestamp = EXCLUDED.timestamp
	`, s.connectionID, s.JID, chatJID.String(), string(id), format, plaintext, time.Now().UnixMilli())
	return err
}

func (s *PGSQLStore) DeleteOldOutgoingEvents(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM whatsmeow_retry_buffer
		WHERE connection_id = $1 AND our_jid = $2 AND timestamp < $3
	`, s.connectionID, s.JID, time.Now().Add(-7*24*time.Hour).UnixMilli())
	return err
}
