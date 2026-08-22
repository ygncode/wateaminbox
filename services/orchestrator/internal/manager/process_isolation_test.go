package manager

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDurableWorkerIdentityIsBoundedAndEqual(t *testing.T) {
	require.NoError(t, validateWorkerIdentity(minimumWorkerIdentity, minimumWorkerIdentity))
	require.NoError(t, validateWorkerIdentity(maximumWorkerIdentity, maximumWorkerIdentity))
	require.Error(t, validateWorkerIdentity(minimumWorkerIdentity-1, minimumWorkerIdentity-1))
	require.Error(t, validateWorkerIdentity(minimumWorkerIdentity, minimumWorkerIdentity+1))
	require.Error(t, validateWorkerIdentity(maximumWorkerIdentity+1, maximumWorkerIdentity+1))
}
