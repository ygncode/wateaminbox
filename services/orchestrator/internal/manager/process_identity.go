package manager

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func workerExecutablePath(m *Manager, connectionID string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if worker, ok := m.workers[connectionID]; ok && worker.BinaryPath != "" {
		return worker.BinaryPath
	}
	return m.config.WhatsAppBinaryPath
}

func (m *Manager) isExpectedWorkerProcess(pid int, companyID, connectionID string) (bool, error) {
	m.mu.RLock()
	worker := m.workers[connectionID]
	m.mu.RUnlock()
	if worker == nil {
		return false, nil
	}
	return m.isExpectedWorkerProcessAtPath(pid, companyID, connectionID, workerExecutablePath(m, connectionID), worker.WorkerUID, worker.WorkerGID)
}

func (m *Manager) isExpectedWorkerProcessAtPath(pid int, companyID, connectionID, expectedPath string, expectedUID, expectedGID int) (bool, error) {
	return m.isExpectedWorkerProcessAtPathWithCredentials(pid, companyID, connectionID, expectedPath, func(pid int) (bool, error) {
		return workerProcessCredentialsMatch(pid, expectedUID, expectedGID)
	})
}

func (m *Manager) isExpectedLegacyWorkerProcessAtPath(pid int, companyID, connectionID, expectedPath string) (bool, error) {
	return m.isExpectedWorkerProcessAtPathWithCredentials(pid, companyID, connectionID, expectedPath, legacyWorkerProcessCredentialsMatch)
}

func (m *Manager) isExpectedWorkerProcessAtPathWithCredentials(
	pid int, companyID, connectionID, expectedPath string,
	credentialsMatch func(int) (bool, error),
) (bool, error) {
	if pid <= 0 {
		return false, nil
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return false, nil
	}
	if err := process.Signal(syscall.Signal(0)); err != nil {
		if errors.Is(err, os.ErrProcessDone) || errors.Is(err, syscall.ESRCH) {
			return false, nil
		}
		return false, fmt.Errorf("check PID %d liveness: %w", pid, err)
	}

	// An exited-but-unreaped process still answers signal 0 above, yet its
	// executable and environment are already gone. Stop here rather than
	// comparing whatever ps prints for a corpse ("[worker] <defunct>"), which
	// never matches the expected path and is indistinguishable from a genuinely
	// reused PID.
	if processIsZombie(pid) {
		return false, nil
	}

	procExecutable := fmt.Sprintf("/proc/%d/exe", pid)
	executable, executableErr := os.Readlink(procExecutable)
	if executableErr != nil {
		output, err := exec.Command("ps", "-p", fmt.Sprint(pid), "-o", "command=").Output()
		if err != nil {
			return false, err
		}
		fields := strings.Fields(string(output))
		if len(fields) == 0 {
			return false, nil
		}
		executable = fields[0]
	}

	expected, expectedErr := filepath.EvalSymlinks(expectedPath)
	if expectedErr != nil {
		expected = expectedPath
	}
	actual, actualErr := filepath.EvalSymlinks(executable)
	if actualErr != nil {
		actual = executable
	}
	if actual != expected {
		return false, nil
	}
	credentialsOK, err := credentialsMatch(pid)
	if err != nil {
		return false, fmt.Errorf("verify PID %d credentials: %w", pid, err)
	}
	if !credentialsOK {
		return false, nil
	}

	// The executable alone is insufficient: every connection runs the same
	// worker binary, so a stale PID can be reused by another tenant's worker.
	// Match the immutable tenant/connection identity from the child environment
	// before sending any signal to an adopted process.
	environment, err := os.ReadFile(fmt.Sprintf("/proc/%d/environ", pid))
	if err != nil {
		environment, err = exec.Command("ps", "eww", "-p", fmt.Sprint(pid), "-o", "command=").Output()
		if err != nil {
			return false, err
		}
	}
	normalized := strings.ReplaceAll(string(environment), "\x00", " ")
	fields := strings.Fields(normalized)
	companyToken := "COMPANY_ID=" + companyID
	connectionToken := "CONNECTION_ID=" + connectionID
	companyMatches := false
	connectionMatches := false
	for _, field := range fields {
		companyMatches = companyMatches || field == companyToken
		connectionMatches = connectionMatches || field == connectionToken
	}
	return companyMatches && connectionMatches, nil
}

// waitForWorkerExit waits for a spawned worker's done channel (closed when
// cmd.Wait reaps the process) or falls back to signal-0 polling for recovered
// workers that have no exec.Cmd.
func (m *Manager) waitForWorkerExit(ctx context.Context, worker *WorkerProcess, pid int, timeout time.Duration) error {
	if worker.done != nil {
		timer := time.NewTimer(timeout)
		defer timer.Stop()
		select {
		case <-worker.done:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
			return fmt.Errorf("timed out waiting for PID %d", pid)
		}
	}
	return waitForProcessExit(ctx, pid, timeout)
}

func waitForProcessExit(ctx context.Context, pid int, timeout time.Duration) error {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()

	for {
		process, err := os.FindProcess(pid)
		if err != nil {
			return nil
		}
		err = process.Signal(syscall.Signal(0))
		if errors.Is(err, os.ErrProcessDone) || errors.Is(err, syscall.ESRCH) {
			return nil
		}
		// A zombie has exited; only the reap is outstanding. Signal-0 keeps
		// succeeding until its parent collects it, so waiting for ESRCH here
		// would burn the whole grace period and then escalate to SIGKILL
		// against a process that is already gone.
		if processIsZombie(pid) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return fmt.Errorf("timed out waiting for PID %d", pid)
		case <-ticker.C:
		}
	}
}

func processIsAlive(pid int) (bool, error) {
	if pid <= 0 {
		return false, nil
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return false, nil
	}
	if err = process.Signal(syscall.Signal(0)); err == nil {
		return !processIsZombie(pid), nil
	}
	if errors.Is(err, os.ErrProcessDone) || errors.Is(err, syscall.ESRCH) {
		return false, nil
	}
	return false, err
}
