package manager

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/nats-io/nats.go"
	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
)

const workerRuntimeStatusWildcard = "WHATSAPP.workers.>"

func (m *Manager) startRuntimeStatusSubscription() error {
	sub, err := m.config.NATSClient.Subscribe(workerRuntimeStatusWildcard, func(message *nats.Msg) {
		var status sharednats.WorkerRuntimeStatus
		if err := json.Unmarshal(message.Data, &status); err != nil {
			log.Printf("Discarding malformed worker runtime status: %v", err)
			return
		}
		parts := strings.Split(message.Subject, ".")
		if len(parts) != 6 || parts[0] != "WHATSAPP" || parts[1] != "workers" || parts[5] != "status" ||
			parts[2] != status.CompanyID || parts[3] != status.ConnectionID || parts[4] != status.LaunchID {
			log.Printf("Discarding worker runtime status with subject/body identity mismatch")
			return
		}
		m.RecordWorkerRuntimeStatus(status)
	})
	if err != nil {
		return fmt.Errorf("subscribe %s: %w", workerRuntimeStatusWildcard, err)
	}
	m.runtimeSub = sub
	return nil
}
