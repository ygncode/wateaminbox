package manager

import (
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/nats-io/nats.go"
)

// MockProcessExecutor is a mock implementation of ProcessExecutor for testing.
type MockProcessExecutor struct {
	mu sync.Mutex

	// StartFunc allows customizing Start behavior
	StartFunc func(cmd *exec.Cmd) error
	// WaitFunc allows customizing Wait behavior
	WaitFunc func(cmd *exec.Cmd) error
	// SignalFunc allows customizing Signal behavior
	SignalFunc func(pid int, sig syscall.Signal) error
	// KillFunc allows customizing Kill behavior
	KillFunc func(pid int) error
	// FindProcessFunc allows customizing FindProcess behavior
	FindProcessFunc func(pid int) (*os.Process, error)
	// GetProcessGroupFunc allows customizing GetProcessGroup behavior
	GetProcessGroupFunc func(pid int) (int, error)
	// KillProcessGroupFunc allows customizing KillProcessGroup behavior
	KillProcessGroupFunc func(pgid int, sig syscall.Signal) error

	// Call tracking
	StartCalls           []exec.Cmd
	WaitCalls            []exec.Cmd
	SignalCalls          []signalCall
	KillCalls            []int
	FindProcessCalls     []int
	GetProcessGroupCalls []int
	KillProcessGroupCalls []killPgCall
}

type signalCall struct {
	PID    int
	Signal syscall.Signal
}

type killPgCall struct {
	PGID   int
	Signal syscall.Signal
}

// NewMockProcessExecutor creates a new mock process executor with default behavior.
func NewMockProcessExecutor() *MockProcessExecutor {
	return &MockProcessExecutor{
		StartFunc: func(cmd *exec.Cmd) error {
			return nil
		},
		WaitFunc: func(cmd *exec.Cmd) error {
			return nil
		},
		SignalFunc: func(pid int, sig syscall.Signal) error {
			return nil
		},
		KillFunc: func(pid int) error {
			return nil
		},
		FindProcessFunc: func(pid int) (*os.Process, error) {
			return &os.Process{Pid: pid}, nil
		},
		GetProcessGroupFunc: func(pid int) (int, error) {
			return pid, nil
		},
		KillProcessGroupFunc: func(pgid int, sig syscall.Signal) error {
			return nil
		},
	}
}

func (m *MockProcessExecutor) Start(cmd *exec.Cmd) error {
	m.mu.Lock()
	m.StartCalls = append(m.StartCalls, *cmd)
	m.mu.Unlock()
	if m.StartFunc != nil {
		return m.StartFunc(cmd)
	}
	return nil
}

func (m *MockProcessExecutor) Wait(cmd *exec.Cmd) error {
	m.mu.Lock()
	m.WaitCalls = append(m.WaitCalls, *cmd)
	m.mu.Unlock()
	if m.WaitFunc != nil {
		return m.WaitFunc(cmd)
	}
	return nil
}

func (m *MockProcessExecutor) Signal(pid int, sig syscall.Signal) error {
	m.mu.Lock()
	m.SignalCalls = append(m.SignalCalls, signalCall{PID: pid, Signal: sig})
	m.mu.Unlock()
	if m.SignalFunc != nil {
		return m.SignalFunc(pid, sig)
	}
	return nil
}

func (m *MockProcessExecutor) Kill(pid int) error {
	m.mu.Lock()
	m.KillCalls = append(m.KillCalls, pid)
	m.mu.Unlock()
	if m.KillFunc != nil {
		return m.KillFunc(pid)
	}
	return nil
}

func (m *MockProcessExecutor) FindProcess(pid int) (*os.Process, error) {
	m.mu.Lock()
	m.FindProcessCalls = append(m.FindProcessCalls, pid)
	m.mu.Unlock()
	if m.FindProcessFunc != nil {
		return m.FindProcessFunc(pid)
	}
	return &os.Process{Pid: pid}, nil
}

func (m *MockProcessExecutor) GetProcessGroup(pid int) (int, error) {
	m.mu.Lock()
	m.GetProcessGroupCalls = append(m.GetProcessGroupCalls, pid)
	m.mu.Unlock()
	if m.GetProcessGroupFunc != nil {
		return m.GetProcessGroupFunc(pid)
	}
	return pid, nil
}

func (m *MockProcessExecutor) KillProcessGroup(pgid int, sig syscall.Signal) error {
	m.mu.Lock()
	m.KillProcessGroupCalls = append(m.KillProcessGroupCalls, killPgCall{PGID: pgid, Signal: sig})
	m.mu.Unlock()
	if m.KillProcessGroupFunc != nil {
		return m.KillProcessGroupFunc(pgid, sig)
	}
	return nil
}

// MockNATSClient is a mock implementation of NATSClient for testing.
type MockNATSClient struct {
	mu sync.Mutex

	// Behavior functions
	SubscribeToCommandsFunc func(handler func(msg *nats.Msg)) (*nats.Subscription, error)
	PublishEventFunc        func(subject string, data []byte) error
	PublishCommandFunc      func(data []byte) error
	CreateStreamsFunc       func() error
	CloseFunc               func()

	// Call tracking
	PublishEventCalls   []publishEventCall
	PublishCommandCalls [][]byte
	CreateStreamsCalls  int
	CloseCalls          int

	// Mock subscription to return
	MockSubscription *MockSubscription
}

type publishEventCall struct {
	Subject string
	Data    []byte
}

// NewMockNATSClient creates a new mock NATS client with default behavior.
func NewMockNATSClient() *MockNATSClient {
	mockSub := NewMockSubscription()
	return &MockNATSClient{
		MockSubscription: mockSub,
		SubscribeToCommandsFunc: func(handler func(msg *nats.Msg)) (*nats.Subscription, error) {
			return nil, nil
		},
		PublishEventFunc: func(subject string, data []byte) error {
			return nil
		},
		PublishCommandFunc: func(data []byte) error {
			return nil
		},
		CreateStreamsFunc: func() error {
			return nil
		},
		CloseFunc: func() {},
	}
}

func (m *MockNATSClient) SubscribeToCommands(handler func(msg *nats.Msg)) (*nats.Subscription, error) {
	if m.SubscribeToCommandsFunc != nil {
		return m.SubscribeToCommandsFunc(handler)
	}
	return nil, nil
}

func (m *MockNATSClient) PublishEvent(subject string, data []byte) error {
	m.mu.Lock()
	m.PublishEventCalls = append(m.PublishEventCalls, publishEventCall{Subject: subject, Data: data})
	m.mu.Unlock()
	if m.PublishEventFunc != nil {
		return m.PublishEventFunc(subject, data)
	}
	return nil
}

func (m *MockNATSClient) PublishCommand(data []byte) error {
	m.mu.Lock()
	m.PublishCommandCalls = append(m.PublishCommandCalls, data)
	m.mu.Unlock()
	if m.PublishCommandFunc != nil {
		return m.PublishCommandFunc(data)
	}
	return nil
}

func (m *MockNATSClient) CreateStreams() error {
	m.mu.Lock()
	m.CreateStreamsCalls++
	m.mu.Unlock()
	if m.CreateStreamsFunc != nil {
		return m.CreateStreamsFunc()
	}
	return nil
}

func (m *MockNATSClient) Close() {
	m.mu.Lock()
	m.CloseCalls++
	m.mu.Unlock()
	if m.CloseFunc != nil {
		m.CloseFunc()
	}
}

// GetPublishEventCalls returns a copy of publish event calls.
func (m *MockNATSClient) GetPublishEventCalls() []publishEventCall {
	m.mu.Lock()
	defer m.mu.Unlock()
	calls := make([]publishEventCall, len(m.PublishEventCalls))
	copy(calls, m.PublishEventCalls)
	return calls
}

// MockSubscription is a mock implementation of a NATS subscription.
type MockSubscription struct {
	mu sync.Mutex

	// Behavior functions
	FetchFunc func(batch int, opts ...nats.PullOpt) ([]*nats.Msg, error)
	DrainFunc func() error

	// Messages to return from Fetch
	Messages []*nats.Msg
	// Error to return from Fetch
	FetchError error

	// Call tracking
	FetchCalls int
	DrainCalls int
}

// NewMockSubscription creates a new mock subscription.
func NewMockSubscription() *MockSubscription {
	return &MockSubscription{
		FetchFunc: func(batch int, opts ...nats.PullOpt) ([]*nats.Msg, error) {
			return nil, nats.ErrTimeout
		},
		DrainFunc: func() error {
			return nil
		},
	}
}

func (m *MockSubscription) Fetch(batch int, opts ...nats.PullOpt) ([]*nats.Msg, error) {
	m.mu.Lock()
	m.FetchCalls++
	m.mu.Unlock()

	if m.FetchFunc != nil {
		return m.FetchFunc(batch, opts...)
	}

	if m.FetchError != nil {
		return nil, m.FetchError
	}

	return m.Messages, nil
}

func (m *MockSubscription) Drain() error {
	m.mu.Lock()
	m.DrainCalls++
	m.mu.Unlock()

	if m.DrainFunc != nil {
		return m.DrainFunc()
	}
	return nil
}

// SetMessages sets the messages to return from Fetch.
func (m *MockSubscription) SetMessages(msgs []*nats.Msg) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Messages = msgs
}

// MockClock is a mock implementation of Clock for testing.
type MockClock struct {
	mu sync.Mutex

	// Current time
	currentTime time.Time

	// Tickers created
	Tickers []*MockTicker
}

// NewMockClock creates a new mock clock set to a specific time.
func NewMockClock(t time.Time) *MockClock {
	return &MockClock{
		currentTime: t,
	}
}

func (m *MockClock) Now() time.Time {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.currentTime
}

func (m *MockClock) Since(t time.Time) time.Duration {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.currentTime.Sub(t)
}

func (m *MockClock) NewTicker(d time.Duration) Ticker {
	m.mu.Lock()
	defer m.mu.Unlock()
	ticker := NewMockTicker(d)
	m.Tickers = append(m.Tickers, ticker)
	return ticker
}

func (m *MockClock) After(d time.Duration) <-chan time.Time {
	ch := make(chan time.Time, 1)
	go func() {
		time.Sleep(d)
		ch <- m.Now()
	}()
	return ch
}

// Advance advances the clock by the given duration.
func (m *MockClock) Advance(d time.Duration) {
	m.mu.Lock()
	m.currentTime = m.currentTime.Add(d)
	m.mu.Unlock()
}

// Set sets the clock to a specific time.
func (m *MockClock) Set(t time.Time) {
	m.mu.Lock()
	m.currentTime = t
	m.mu.Unlock()
}

// MockTicker is a mock implementation of Ticker for testing.
type MockTicker struct {
	mu       sync.Mutex
	ch       chan time.Time
	duration time.Duration
	stopped  bool
}

// NewMockTicker creates a new mock ticker.
func NewMockTicker(d time.Duration) *MockTicker {
	return &MockTicker{
		ch:       make(chan time.Time, 1),
		duration: d,
	}
}

func (m *MockTicker) C() <-chan time.Time {
	return m.ch
}

func (m *MockTicker) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopped = true
}

// Tick sends a tick to the ticker channel.
func (m *MockTicker) Tick(t time.Time) {
	m.mu.Lock()
	stopped := m.stopped
	m.mu.Unlock()

	if !stopped {
		select {
		case m.ch <- t:
		default:
		}
	}
}

// IsStopped returns whether the ticker has been stopped.
func (m *MockTicker) IsStopped() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.stopped
}

// MockMessage wraps nats.Msg with tracking for tests.
type MockMessage struct {
	*nats.Msg
	mu       sync.Mutex
	AckCalls int
	NakCalls int
	AckErr   error
	NakErr   error
}

// NewMockMessage creates a mock message with the given data.
func NewMockMessage(data []byte) *MockMessage {
	return &MockMessage{
		Msg: &nats.Msg{Data: data},
	}
}

// TrackAck tracks Ack calls (for use in tests).
func (m *MockMessage) TrackAck() {
	m.mu.Lock()
	m.AckCalls++
	m.mu.Unlock()
}

// TrackNak tracks Nak calls (for use in tests).
func (m *MockMessage) TrackNak() {
	m.mu.Lock()
	m.NakCalls++
	m.mu.Unlock()
}

// GetAckCalls returns the number of Ack calls.
func (m *MockMessage) GetAckCalls() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.AckCalls
}

// GetNakCalls returns the number of Nak calls.
func (m *MockMessage) GetNakCalls() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.NakCalls
}
