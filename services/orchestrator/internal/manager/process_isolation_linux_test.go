//go:build linux

package manager

import (
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWorkerProcessAttributesKillOnParentDeathAndDropCredentials(t *testing.T) {
	attr, err := newWorkerSysProcAttr(100000, 100000)
	require.NoError(t, err)
	require.True(t, attr.Setpgid)
	require.Equal(t, syscall.SIGKILL, attr.Pdeathsig)
	require.NotNil(t, attr.Credential)
	require.Equal(t, uint32(100000), attr.Credential.Uid)
	require.Equal(t, uint32(100000), attr.Credential.Gid)
	require.False(t, attr.Credential.NoSetGroups)
	require.Empty(t, attr.Credential.Groups)
}

func TestDistinctWorkerUIDsCannotReadSiblingReadinessAuthority(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("credential isolation requires root")
	}

	sibling := exec.Command("/bin/sh", "-c", "exec sleep 30")
	sibling.Env = []string{"PATH=/usr/bin:/bin", "WORKER_READINESS_TOKEN=sibling-secret"}
	var err error
	sibling.SysProcAttr, err = newWorkerSysProcAttr(100001, 100001)
	require.NoError(t, err)
	require.NoError(t, sibling.Start())
	t.Cleanup(func() {
		_ = syscall.Kill(-sibling.Process.Pid, syscall.SIGKILL)
		_, _ = sibling.Process.Wait()
	})

	reader := exec.Command("/bin/sh", "-c", "cat /proc/$TARGET/environ >/dev/null")
	reader.Env = []string{"PATH=/usr/bin:/bin", "TARGET=" + strconv.Itoa(sibling.Process.Pid)}
	reader.SysProcAttr, err = newWorkerSysProcAttr(100000, 100000)
	require.NoError(t, err)
	err = reader.Run()
	assert.Error(t, err, "a distinct worker UID read its sibling's launch token")

	matches, matchErr := workerProcessCredentialsMatch(sibling.Process.Pid, 100001, 100001)
	require.NoError(t, matchErr)
	assert.True(t, matches)
	wrong, wrongErr := workerProcessCredentialsMatch(sibling.Process.Pid, 100000, 100000)
	require.NoError(t, wrongErr)
	assert.False(t, wrong)

	// Keep the liveness assertion bounded so a bad process setup cannot hang CI.
	require.Eventually(t, func() bool {
		return sibling.Process.Signal(syscall.Signal(0)) == nil
	}, time.Second, 10*time.Millisecond)
}
