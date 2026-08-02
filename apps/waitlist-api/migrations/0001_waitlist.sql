-- WATeamInbox Cloud waitlist. All times are Unix milliseconds (INTEGER).
-- STRICT tables make accidental type coercion fail early in D1/SQLite.

CREATE TABLE IF NOT EXISTS waitlist_subscribers (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  last_confirmation_requested_at INTEGER,
  last_confirmation_sent_at INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS idx_waitlist_subscribers_status_created
  ON waitlist_subscribers(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waitlist_subscribers_confirmed_at
  ON waitlist_subscribers(confirmed_at DESC);

CREATE TABLE IF NOT EXISTS waitlist_confirmation_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL REFERENCES waitlist_subscribers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_marker TEXT,
  email_sent_at INTEGER,
  email_message_id TEXT,
  email_error_code TEXT,
  CHECK (
    (used_at IS NULL AND used_marker IS NULL) OR
    (used_at IS NOT NULL AND used_marker IS NOT NULL)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_waitlist_confirmation_tokens_subscriber
  ON waitlist_confirmation_tokens(subscriber_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_waitlist_confirmation_tokens_expiry
  ON waitlist_confirmation_tokens(expires_at);

-- A key is one short-lived, replayable result for one normalized signup request.
-- It stores no raw email address or raw token.
CREATE TABLE IF NOT EXISTS waitlist_idempotency_keys (
  key_hash TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  response_code INTEGER,
  response_body TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK (
    (response_code IS NULL AND response_body IS NULL AND completed_at IS NULL) OR
    (response_code IS NOT NULL AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_waitlist_idempotency_expiry
  ON waitlist_idempotency_keys(expires_at);

-- Fixed-window counters are pseudonymous HMAC-derived bucket keys, never IPs.
CREATE TABLE IF NOT EXISTS waitlist_rate_limit_buckets (
  bucket TEXT PRIMARY KEY NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_waitlist_rate_limit_updated_at
  ON waitlist_rate_limit_buckets(updated_at);

-- The Worker has one password-backed administrator. Session tokens are stored
-- as HMAC hashes, so a D1 export cannot be used as a browser session.
CREATE TABLE IF NOT EXISTS waitlist_admin_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_waitlist_admin_sessions_expiry
  ON waitlist_admin_sessions(expires_at);

-- Refresh SQLite planner statistics after creating the query indexes above.
PRAGMA optimize;
