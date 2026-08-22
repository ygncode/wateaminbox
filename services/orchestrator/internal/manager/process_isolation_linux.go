//go:build linux

package manager

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
)

const (
	minimumWorkerIdentity = 100000
	maximumWorkerIdentity = 2147483646
)

func validateRootManagerApproval(approved bool) error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("durable worker credential isolation requires a Linux root manager")
	}
	if !approved {
		return fmt.Errorf("Linux root manager requires explicit ORCHESTRATOR_ROOT_MANAGER_APPROVED=true")
	}
	return nil
}

func validateWorkerIdentity(uid, gid int) error {
	if uid < minimumWorkerIdentity || uid > maximumWorkerIdentity || gid != uid {
		return fmt.Errorf("worker uid/gid must be equal and within %d..%d, got %d/%d", minimumWorkerIdentity, maximumWorkerIdentity, uid, gid)
	}
	return nil
}

func newWorkerSysProcAttr(uid, gid int) (*syscall.SysProcAttr, error) {
	attr := &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
	// Persistence-free local tests/development retain the invoking identity. All
	// durable production launches have a database-assigned non-zero identity.
	if uid == 0 && gid == 0 {
		return attr, nil
	}
	if err := validateWorkerIdentity(uid, gid); err != nil {
		return nil, err
	}
	attr.Credential = &syscall.Credential{
		Uid:    uint32(uid),
		Gid:    uint32(gid),
		Groups: nil, // NoSetGroups=false makes the root parent clear all groups.
	}
	return attr, nil
}

func legacyWorkerProcessCredentialsMatch(pid int) (bool, error) {
	return processCredentialsMatch(pid, 10001, 10001)
}

func workerProcessCredentialsMatch(pid, expectedUID, expectedGID int) (bool, error) {
	if expectedUID == 0 && expectedGID == 0 {
		return true, nil
	}
	if err := validateWorkerIdentity(expectedUID, expectedGID); err != nil {
		return false, err
	}
	return processCredentialsMatch(pid, expectedUID, expectedGID)
}

func processCredentialsMatch(pid, expectedUID, expectedGID int) (bool, error) {
	file, err := os.Open(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return false, err
	}
	defer file.Close()
	uid, gid := -1, -1
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		switch fields[0] {
		case "Uid:":
			uid, err = strconv.Atoi(fields[1])
		case "Gid:":
			gid, err = strconv.Atoi(fields[1])
		}
		if err != nil {
			return false, err
		}
	}
	if err := scanner.Err(); err != nil {
		return false, err
	}
	return uid == expectedUID && gid == expectedGID, nil
}
