package client

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLogoutThenPurgePreservesCredentialsWhenRemoteLogoutFails(t *testing.T) {
	logoutErr := errors.New("network unavailable")
	purgeCalled := false

	err := logoutThenPurge(
		true,
		func() error { return logoutErr },
		func() error {
			purgeCalled = true
			return nil
		},
	)

	require.ErrorIs(t, err, logoutErr)
	assert.ErrorContains(t, err, "credentials preserved for retry")
	assert.False(t, purgeCalled, "credentials must remain available for a remote logout retry")
}

func TestLogoutThenPurgePurgesOnlyAfterSuccessfulLogout(t *testing.T) {
	steps := make([]string, 0, 2)
	err := logoutThenPurge(
		true,
		func() error {
			steps = append(steps, "logout")
			return nil
		},
		func() error {
			steps = append(steps, "purge")
			return nil
		},
	)

	require.NoError(t, err)
	assert.Equal(t, []string{"logout", "purge"}, steps)
}

func TestLogoutThenPurgeClearsLocalStateWithoutRemoteSession(t *testing.T) {
	logoutCalled := false
	purgeCalled := false
	err := logoutThenPurge(
		false,
		func() error {
			logoutCalled = true
			return nil
		},
		func() error {
			purgeCalled = true
			return nil
		},
	)

	require.NoError(t, err)
	assert.False(t, logoutCalled)
	assert.True(t, purgeCalled)
}
