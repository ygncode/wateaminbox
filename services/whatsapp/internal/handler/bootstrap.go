package handler

import (
	"context"
	"errors"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
)

const (
	bootstrapRepairCooldown = 5 * time.Minute
	bootstrapRetryInterval  = time.Minute
)

var errBootstrapNotReady = errors.New("bootstrap prerequisites unavailable")

type bootstrapKind int

const (
	bootstrapContacts bootstrapKind = iota
	bootstrapGroups
	bootstrapJobCount
)

type bootstrapRequest struct {
	ctx       context.Context
	notBefore time.Time
	force     bool // app-state/history updates must bypass the reconnect cooldown
}

type bootstrapJob struct {
	running        bool
	pending        *bootstrapRequest // latest request only, never an unbounded queue
	lastSuccess    time.Time
	retryNotBefore time.Time // provider cooldown survives session replacement
	wake           chan struct{}
}

type connectionBootstrap struct {
	mu                sync.Mutex
	ctx               context.Context
	cancel            context.CancelFunc
	contactsRequested bool
	contactRepairDue  time.Time // retain event-driven repair across session cancellation
	jobs              [bootstrapJobCount]bootstrapJob
	// Immutable after first use. Tests shorten real timers and replace only I/O.
	repairCooldown time.Duration
	retryInterval  time.Duration
	run            func(context.Context, bootstrapKind) error
}

func bootstrapDuration(value, fallback time.Duration) time.Duration {
	if value > 0 {
		return value
	}
	return fallback
}

// beginBootstrap reserves the session before doing any connected work. Duplicate
// Connected events do not start more workers.
func (h *Handler) beginBootstrap() (context.Context, bool) {
	b := &h.bootstrap
	b.mu.Lock()
	defer b.mu.Unlock()
	parent := h.config.Ctx
	if parent == nil {
		parent = context.Background()
	}
	// The real client cancels this context when it observes a disconnect,
	// before waiting for an older lifecycle handler/status publish to finish.
	if source, ok := h.config.Client.(interface{ ConnectionSessionContext() context.Context }); ok {
		parent = source.ConnectionSessionContext()
		if parent == nil {
			return nil, false
		}
	}
	if parent.Err() != nil || (b.ctx != nil && b.ctx.Err() == nil) {
		return nil, false
	}
	// A newer Connected may supersede queued Disconnected delivery. Its
	// predecessor is already cancelled; discard only that obsolete session.
	if b.cancel != nil {
		b.cancel()
		for i := range b.jobs {
			b.jobs[i].pending = nil
		}
	}
	b.ctx, b.cancel = context.WithCancel(parent)
	b.contactsRequested = false
	return b.ctx, true
}

func (h *Handler) cancelBootstrap() {
	b := &h.bootstrap
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.cancel != nil {
		b.cancel()
	}
	b.ctx, b.cancel = nil, nil
	for i := range b.jobs {
		b.jobs[i].pending = nil
	}
}

func (h *Handler) startBootstrap(ctx context.Context) {
	b := &h.bootstrap
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ctx != ctx || ctx.Err() != nil {
		return
	}
	// Presence is demand-driven by live messages, never an address-book scan.
	for kind := bootstrapContacts; kind < bootstrapJobCount; kind++ {
		// A reconnect does not change the durable name cache. Once a complete
		// scan has been queued successfully, only actual app-state/history
		// updates need another scan. Periodic reconnect replay can outproduce
		// the API history consumer even with a multi-minute cooldown.
		if kind == bootstrapContacts && !b.jobs[kind].lastSuccess.IsZero() && b.contactRepairDue.IsZero() {
			continue
		}
		notBefore := time.Now()
		// Preserve a cache-sync notification received during initial availability.
		if kind != bootstrapContacts || !b.contactsRequested {
			request := &bootstrapRequest{ctx: ctx, notBefore: notBefore}
			if kind == bootstrapContacts && !b.contactRepairDue.IsZero() {
				request.force = true
				request.notBefore = b.contactRepairDue
			}
			h.queueBootstrapLocked(kind, request)
		}
	}
}

// requestContactRepair also coalesces history/app-state replays. Those events
// still publish their incremental updates immediately; only the full cache scan
// is scheduled here. Without a session the next Connected retains both the
// request and its persistence grace period, including during initial pairing.
func (h *Handler) requestContactRepair(delay time.Duration) {
	b := &h.bootstrap
	b.mu.Lock()
	defer b.mu.Unlock()
	due := time.Now().Add(delay)
	if due.After(b.contactRepairDue) {
		b.contactRepairDue = due
	}
	if b.ctx == nil || b.ctx.Err() != nil {
		return
	}
	b.contactsRequested = true
	h.queueBootstrapLocked(bootstrapContacts, &bootstrapRequest{
		ctx: b.ctx, notBefore: b.contactRepairDue, force: true,
	})
}

// Caller holds bootstrap.mu. Each lane has at most one goroutine, including
// across reconnects: a cancelled I/O call must return before its successor runs.
func (h *Handler) queueBootstrapLocked(kind bootstrapKind, request *bootstrapRequest) {
	job := &h.bootstrap.jobs[kind]
	mergeBootstrapRequest(request, job.pending)
	job.pending = request
	if !job.running {
		job.running = true
		job.wake = make(chan struct{}, 1)
		go h.runBootstrapJob(kind)
	} else {
		select {
		case job.wake <- struct{}{}:
		default:
		}
	}
}

func (h *Handler) runBootstrapJob(kind bootstrapKind) {
	b := &h.bootstrap
	for {
		b.mu.Lock()
		job := &b.jobs[kind]
		request := job.pending
		job.pending = nil
		if request == nil {
			job.running = false
			b.mu.Unlock()
			return
		}
		due := request.notBefore
		if job.retryNotBefore.After(due) {
			due = job.retryNotBefore
		}
		if !request.force {
			cooldown := job.lastSuccess.Add(bootstrapDuration(b.repairCooldown, bootstrapRepairCooldown))
			if cooldown.After(due) {
				due = cooldown
			}
		}
		// Drain notifications covered by the request we just took.
		select {
		case <-job.wake:
		default:
		}
		b.mu.Unlock()

		// A fresh app-state/history request can interrupt a reconnect cooldown.
		// A newer session likewise replaces the obsolete delayed request.
		timer := time.NewTimer(max(0, time.Until(due)))
		select {
		case <-job.wake:
			timer.Stop()
			b.mu.Lock()
			mergeBootstrapRequest(job.pending, request)
			b.mu.Unlock()
			continue
		case <-request.ctx.Done():
		case <-timer.C:
		}
		timer.Stop()
		err := request.ctx.Err()
		if err == nil {
			err = h.runBootstrap(request.ctx, kind)
		}

		b.mu.Lock()
		// An explicit provider limit applies to the account even if the socket
		// was cancelled while that response was returning.
		if errors.Is(err, whatsmeow.ErrIQRateOverLimit) {
			delay := max(bootstrapDuration(b.retryInterval, bootstrapRetryInterval), bootstrapDuration(b.repairCooldown, bootstrapRepairCooldown))
			job.retryNotBefore = time.Now().Add(delay)
		}
		// A cancelled/obsolete completion must not suppress the next session's
		// retry, even if an I/O implementation returned nil on cancellation.
		if request.ctx.Err() == nil {
			if err == nil {
				job.lastSuccess = time.Now()
				job.retryNotBefore = time.Time{}
				if kind == bootstrapContacts && request.force && !b.contactRepairDue.After(request.notBefore) {
					b.contactRepairDue = time.Time{}
				}
			} else {
				delay := bootstrapDuration(b.retryInterval, bootstrapRetryInterval)
				if job.pending == nil {
					request.notBefore = time.Now().Add(delay)
					job.pending = request
				}
			}
		}
		b.mu.Unlock()
	}
}

// Do not let an immediate app-state notification discard a history request's
// persistence grace period. Only merge requests belonging to the same session.
func mergeBootstrapRequest(latest, previous *bootstrapRequest) {
	if latest == nil || previous == nil || latest.ctx != previous.ctx || !previous.force {
		return
	}
	latest.force = true
	if previous.notBefore.After(latest.notBefore) {
		latest.notBefore = previous.notBefore
	}
}

func (h *Handler) runBootstrap(ctx context.Context, kind bootstrapKind) error {
	if h.bootstrap.run != nil {
		return h.bootstrap.run(ctx, kind)
	}
	switch kind {
	case bootstrapContacts:
		return h.syncKnownContactNames(ctx)
	default:
		return h.syncJoinedGroups(ctx)
	}
}
