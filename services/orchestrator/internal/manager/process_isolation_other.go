//go:build !linux

package manager

import (
	"fmt"
	"syscall"
)

const (
	minimumWorkerIdentity = 100000
	maximumWorkerIdentity = 2147483646
)

func validateRootManagerApproval(bool) error {
	return fmt.Errorf("durable worker credential isolation is supported only on Linux")
}

func validateWorkerIdentity(uid, gid int) error {
	if uid < minimumWorkerIdentity || uid > maximumWorkerIdentity || gid != uid {
		return fmt.Errorf("worker uid/gid must be equal and within %d..%d, got %d/%d", minimumWorkerIdentity, maximumWorkerIdentity, uid, gid)
	}
	return nil
}

func newWorkerSysProcAttr(uid, gid int) (*syscall.SysProcAttr, error) {
	if uid != 0 || gid != 0 {
		return nil, fmt.Errorf("durable worker credential isolation is supported only on Linux")
	}
	return &syscall.SysProcAttr{Setpgid: true}, nil
}

func workerProcessCredentialsMatch(_ int, expectedUID, expectedGID int) (bool, error) {
	if expectedUID != 0 || expectedGID != 0 {
		return false, fmt.Errorf("durable worker credential validation is supported only on Linux")
	}
	return true, nil
}
