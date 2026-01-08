package store

import (
	"context"
	"database/sql"
	"time"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

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
