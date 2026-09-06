package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

const commandQueueLimit = 8
const mediaPreparationLimit = 2

type mediaPreparation struct {
	data []byte
	err  error
}

func isMediaCommand(cmd SendMessageCommand) bool {
	switch cmd.Type {
	case "image", "video", "audio", "document", "sticker":
		return true
	}
	return false
}

func (s *Subscriber) downloadCommandMedia(ctx context.Context, cmd SendMessageCommand) ([]byte, error) {
	if s.storage == nil {
		return nil, fmt.Errorf("object storage is not configured")
	}
	prefix := fmt.Sprintf("media/%s/", s.companyID)
	if !strings.HasPrefix(cmd.MediaObjectKey, prefix) || strings.Contains(cmd.MediaObjectKey, "..") {
		return nil, fmt.Errorf("media object key is outside tenant prefix")
	}
	if cmd.MediaSize <= 0 || cmd.MediaSize > maxSendMediaBytes {
		return nil, fmt.Errorf("invalid media size %d", cmd.MediaSize)
	}
	data, err := s.storage.DownloadMediaObject(ctx, cmd.MediaObjectKey, maxSendMediaBytes, cmd.MediaChecksum)
	if err == nil && int64(len(data)) != cmd.MediaSize {
		return nil, fmt.Errorf("media size mismatch: expected %d, got %d", cmd.MediaSize, len(data))
	}
	return data, err
}

// Heartbeat starts at delivery, including time waiting for preparation or the
// sender. Stop joins the goroutine before ACK/NAK ownership is released.
func keepCommandAlive(ctx context.Context, interval time.Duration, progress func() error) func() {
	done, stopped := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-done:
				return
			case <-ticker.C:
				_ = progress()
			}
		}
	}()
	var once sync.Once
	return func() { once.Do(func() { close(done); <-stopped }) }
}

type scheduledCommand struct {
	msg      *nats.Msg
	cmd      SendMessageCommand
	key      string
	ready    bool
	prepared *mediaPreparation
	release  func()
	stop     func()
	received time.Time
	retryAt  time.Time
	settled  bool
	started  time.Time
}

type preparedCommand struct {
	job     *scheduledCommand
	media   mediaPreparation
	release func()
}

func (s *Subscriber) processMessages() {
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	incoming := make(chan *scheduledCommand)
	prepared := make(chan preparedCommand, commandQueueLimit)
	finished := make(chan *scheduledCommand, 1)
	slots := make(chan struct{}, commandQueueLimit)
	mediaSlots := make(chan struct{}, mediaPreparationLimit)
	var tasks sync.WaitGroup
	defer tasks.Wait()
	defer cancel()
	tasks.Add(1)
	go func() {
		defer tasks.Done()
		for {
			select {
			case slots <- struct{}{}:
			case <-ctx.Done():
				return
			}
			// Fetch only one: no batch sits unacknowledged behind a slow send.
			messages, err := s.sub.Fetch(1, nats.MaxWait(time.Second))
			if err != nil {
				<-slots
				select {
				case <-ctx.Done():
					return
				case <-time.After(100 * time.Millisecond):
				}
				continue
			}
			msg := messages[0]
			job := &scheduledCommand{msg: msg, received: time.Now()}
			_ = json.Unmarshal(msg.Data, &job.cmd)
			job.key = job.cmd.To
			if job.key == "" {
				job.key = "control"
			}
			job.stop = keepCommandAlive(ctx, 20*time.Second, func() error { return msg.InProgress() })
			select {
			case incoming <- job:
			case <-ctx.Done():
				job.stop()
				_ = msg.Nak()
				return
			}
		}
	}()
	queues := map[string][]*scheduledCommand{}
	order := []string{}
	activeIDs := map[string]bool{}
	var sending *scheduledCommand
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	defer func() {
		for _, queue := range queues {
			for _, job := range queue {
				job.stop()
				// The active send settles its own command before tasks.Wait completes.
				if job != sending {
					_ = job.msg.Nak()
				}
			}
		}
	}()
	startHead := func(job *scheduledCommand) {
		if !isMediaCommand(job.cmd) {
			job.ready = true
			return
		}
		tasks.Add(1)
		go func() {
			defer tasks.Done()
			// Result replay needs no media bytes, including when the original
			// object has already expired or storage is temporarily unavailable.
			if s.ledger != nil && job.cmd.CommandID != "" {
				if _, found, err := s.ledger.GetProcessedCommand(ctx, job.cmd.CommandID); err == nil && found {
					select {
					case prepared <- preparedCommand{job: job, release: func() {}}:
					case <-ctx.Done():
					}
					return
				}
			}
			select {
			case mediaSlots <- struct{}{}:
			case <-ctx.Done():
				return
			}
			release := func() { <-mediaSlots }
			var result mediaPreparation
			for attempt := 1; attempt <= commandSideEffectMaxAttempts; attempt++ {
				attemptCtx, stop := context.WithTimeout(ctx, 30*time.Second)
				result.data, result.err = s.downloadCommandMedia(attemptCtx, job.cmd)
				stop()
				if result.err == nil || ctx.Err() != nil {
					break
				}
				select {
				case <-ctx.Done():
					release()
					return
				case <-time.After(time.Duration(attempt) * time.Second):
				}
			}
			select {
			case prepared <- preparedCommand{job, result, release}:
			case <-ctx.Done():
				release()
			}
		}()
	}
	for {
		select {
		case <-ctx.Done():
			return
		case job := <-incoming:
			if job.cmd.CommandID != "" && activeIDs[job.cmd.CommandID] {
				job.stop()
				_ = job.msg.InProgress()
				<-slots
				continue
			}
			activeIDs[job.cmd.CommandID] = true
			if len(queues[job.key]) == 0 {
				order = append(order, job.key)
				startHead(job)
			}
			queues[job.key] = append(queues[job.key], job)
		case result := <-prepared:
			result.job.prepared, result.job.release, result.job.ready = &result.media, result.release, true
		case job := <-finished:
			log.Printf("[NATS] command completed: queue_wait_ms=%d execution_ms=%d pending=%d", job.started.Sub(job.received).Milliseconds(), time.Since(job.started).Milliseconds(), len(slots))
			sending = nil
			// Unsettled transport/ledger errors retain ownership locally;
			// heartbeat renewal avoids spending broker retries on an outage.
			if !job.settled {
				job.retryAt = time.Now().Add(time.Second)
				break
			}

			job.stop()
			if job.release != nil {
				job.release()
			}
			delete(activeIDs, job.cmd.CommandID)
			queue := queues[job.key][1:]
			queues[job.key] = queue
			<-slots
			if len(queue) > 0 {
				startHead(queue[0])
			} else {
				for i, key := range order {
					if key == job.key {
						order = append(order[:i], order[i+1:]...)
						break
					}
				}
			}
		case <-ticker.C:
		}
		if sending != nil {
			continue
		}
		// Round robin among ready contact heads. A media download never occupies
		// the sender, and later messages in that conversation cannot jump its head.
		for i := 0; i < len(order); i++ {
			key := order[0]
			order = order[1:]
			queue := queues[key]
			if len(queue) == 0 {
				delete(queues, key)
				i--
				continue
			}
			order = append(order, key)
			job := queue[0]
			if !job.ready || time.Now().Before(job.retryAt) {
				continue
			}
			sending = job
			tasks.Add(1)
			go func() {
				defer tasks.Done()
				if job.prepared != nil {
					s.prepared = map[*nats.Msg]mediaPreparation{job.msg: *job.prepared}
				}
				s.scheduled = job
				job.settled = true // non-send commands retain their existing retry protocol
				switch job.cmd.Type {
				case "text", "image", "video", "audio", "document", "sticker", "reaction":
					job.settled = false
				}
				job.started = time.Now()
				s.handleCommand(job.msg)
				s.scheduled = nil
				select {
				case finished <- job:
				case <-ctx.Done():
				}
			}()
			break
		}
	}
}

// Scheduled sends retain the head on a transient failure. Standalone callers
// use normal JetStream redelivery, but never an external-side-effect counter.
func (s *Subscriber) deferSend(msg *nats.Msg) {
	if s.scheduled != nil && s.scheduled.msg == msg {
		return
	}
	_ = msg.NakWithDelay(time.Second)
}

func (s *Subscriber) ackSend(msg *nats.Msg) {
	err := msg.Ack()
	if s.scheduled != nil && s.scheduled.msg == msg {
		s.scheduled.settled = err == nil
	}
}
