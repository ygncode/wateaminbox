package manager

import (
	"os"
	"os/exec"
	"syscall"
	"time"

	"github.com/nats-io/nats.go"
)

// ProcessExecutor provides an interface for process execution operations.
// This allows mocking exec.Cmd operations in tests.
type ProcessExecutor interface {
	// Start starts the command but does not wait for it to complete.
	Start(cmd *exec.Cmd) error
	// Wait waits for the command to exit and returns its ProcessState.
	Wait(cmd *exec.Cmd) error
	// Signal sends a signal to a process by PID.
	Signal(pid int, sig syscall.Signal) error
	// Kill forcefully terminates a process by PID.
	Kill(pid int) error
	// FindProcess finds a process by PID.
	FindProcess(pid int) (*os.Process, error)
	// GetProcessGroup returns the process group ID for a PID.
	GetProcessGroup(pid int) (int, error)
	// KillProcessGroup sends a signal to a process group.
	KillProcessGroup(pgid int, sig syscall.Signal) error
}

// NATSClient provides an interface for NATS operations used by the orchestrator.
// This allows mocking NATS interactions in tests.
type NATSClient interface {
	// SubscribeToCommands creates a pull subscription for processing commands.
	SubscribeToCommands(handler func(msg *nats.Msg)) (*nats.Subscription, error)
	// PublishEvent publishes an event to the events stream.
	PublishEvent(subject string, data []byte) error
	// PublishCommand publishes a command to the commands stream.
	PublishCommand(data []byte) error
	// CreateStreams creates the required JetStream streams.
	CreateStreams() error
	// Close closes the NATS connection.
	Close()
}

// Subscription provides an interface for NATS subscription operations.
// This allows mocking subscription behavior in tests.
type Subscription interface {
	// Fetch fetches messages from the subscription with a timeout.
	Fetch(batch int, opts ...nats.PullOpt) ([]*nats.Msg, error)
	// Drain unsubscribes and drains the subscription.
	Drain() error
}

// Message provides an interface for NATS message operations.
// This allows mocking message acknowledgment in tests.
type Message interface {
	// Ack acknowledges the message.
	Ack(opts ...nats.AckOpt) error
	// Nak negatively acknowledges the message.
	Nak(opts ...nats.AckOpt) error
	// Data returns the message data.
	Data() []byte
}

// Clock provides an interface for time operations.
// This allows controlling time in tests.
type Clock interface {
	// Now returns the current time.
	Now() time.Time
	// Since returns the duration since the given time.
	Since(t time.Time) time.Duration
	// NewTicker creates a new ticker.
	NewTicker(d time.Duration) Ticker
	// After waits for the duration and returns the current time.
	After(d time.Duration) <-chan time.Time
}

// Ticker provides an interface for time.Ticker operations.
type Ticker interface {
	// C returns the ticker channel.
	C() <-chan time.Time
	// Stop stops the ticker.
	Stop()
}

// DefaultProcessExecutor provides the real implementation of ProcessExecutor.
type DefaultProcessExecutor struct{}

// Start starts the command.
func (d *DefaultProcessExecutor) Start(cmd *exec.Cmd) error {
	return cmd.Start()
}

// Wait waits for the command to complete.
func (d *DefaultProcessExecutor) Wait(cmd *exec.Cmd) error {
	return cmd.Wait()
}

// Signal sends a signal to a process.
func (d *DefaultProcessExecutor) Signal(pid int, sig syscall.Signal) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Signal(sig)
}

// Kill forcefully terminates a process.
func (d *DefaultProcessExecutor) Kill(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Kill()
}

// FindProcess finds a process by PID.
func (d *DefaultProcessExecutor) FindProcess(pid int) (*os.Process, error) {
	return os.FindProcess(pid)
}

// GetProcessGroup returns the process group ID for a PID.
func (d *DefaultProcessExecutor) GetProcessGroup(pid int) (int, error) {
	return syscall.Getpgid(pid)
}

// KillProcessGroup sends a signal to a process group.
func (d *DefaultProcessExecutor) KillProcessGroup(pgid int, sig syscall.Signal) error {
	return syscall.Kill(-pgid, sig)
}

// DefaultClock provides the real implementation of Clock.
type DefaultClock struct{}

// Now returns the current time.
func (d *DefaultClock) Now() time.Time {
	return time.Now()
}

// Since returns the duration since the given time.
func (d *DefaultClock) Since(t time.Time) time.Duration {
	return time.Since(t)
}

// NewTicker creates a new ticker.
func (d *DefaultClock) NewTicker(dur time.Duration) Ticker {
	return &defaultTicker{ticker: time.NewTicker(dur)}
}

// After waits for the duration and returns the current time.
func (d *DefaultClock) After(d2 time.Duration) <-chan time.Time {
	return time.After(d2)
}

// defaultTicker wraps time.Ticker to implement the Ticker interface.
type defaultTicker struct {
	ticker *time.Ticker
}

// C returns the ticker channel.
func (t *defaultTicker) C() <-chan time.Time {
	return t.ticker.C
}

// Stop stops the ticker.
func (t *defaultTicker) Stop() {
	t.ticker.Stop()
}
