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

	rows, err := s.db.QueryContext(ctx, query, s.connectionID, pq.Array(pnStrs))
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
