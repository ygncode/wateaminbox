package store

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// redactDatabaseError returns err with the database URL removed from its text.
//
// lib/pq parses the connection string when the pool is opened and wraps
// failures in *url.Error, whose message quotes the whole URL, credentials
// included. A worker that is handed a malformed URL would otherwise print the
// database password in its crash log. The *url.Error is rebuilt from its
// operation and cause only, and any remaining raw occurrence of the URL (with
// or without the search_path suffix added by NewPGContainer) is replaced.
func redactDatabaseError(err error, urls ...string) error {
	if err == nil {
		return nil
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		err = fmt.Errorf("%s database URL: %w", urlErr.Op, urlErr.Err)
	}
	msg := err.Error()
	for _, u := range urls {
		if u == "" {
			continue
		}
		msg = strings.ReplaceAll(msg, u, "<database url redacted>")
		if q := fmt.Sprintf("%q", u); q != `""` {
			msg = strings.ReplaceAll(msg, q, "<database url redacted>")
		}
	}
	return errors.New(msg)
}
