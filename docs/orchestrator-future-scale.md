# Orchestrator: Scaling & Future Architecture

This document analyzes the orchestrator's role, potential bottlenecks, and scaling strategies for handling hundreds to thousands of WhatsApp connections.

## Table of Contents

1. [Current Architecture](#current-architecture)
2. [What the Orchestrator Does](#what-the-orchestrator-does)
3. [Bottleneck Analysis](#bottleneck-analysis)
4. [Scaling Options](#scaling-options)
5. [Implementation Details](#implementation-details)
6. [Recommendations by Scale](#recommendations-by-scale)
7. [Migration Path](#migration-path)

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CURRENT DESIGN                                  │
└─────────────────────────────────────────────────────────────────────────────┘

                         ┌─────────────────────────┐
                         │      ORCHESTRATOR       │
                         │   (Single Go Process)   │
                         │                         │
                         │  - In-memory worker map │
                         │  - Process spawning     │
                         │  - Health monitoring    │
                         └───────────┬─────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
        ┌───────────┐          ┌───────────┐          ┌───────────┐
        │  Worker   │          │  Worker   │          │  Worker   │
        │ (PID 123) │          │ (PID 456) │          │ (PID 789) │
        │           │          │           │          │           │
        │ Company A │          │ Company A │          │ Company B │
        │ Conn 1    │          │ Conn 2    │          │ Conn 1    │
        └─────┬─────┘          └─────┬─────┘          └─────┬─────┘
              │                      │                      │
              └──────────────────────┼──────────────────────┘
                                     │
                                     ▼
                         ┌─────────────────────────┐
                         │     NATS JetStream      │
                         │                         │
                         │  Commands & Events      │
                         │  flow directly between  │
                         │  API ←→ Workers         │
                         └─────────────────────────┘
                                     │
                                     ▼
                         ┌─────────────────────────┐
                         │      API Server         │
                         │    (Hono + Bun)         │
                         └─────────────────────────┘
```

### Key Insight: Orchestrator is NOT in the Message Path

```
Message Flow (Orchestrator NOT involved):

  Incoming:  WhatsApp → Worker → NATS → API → WebSocket → Frontend
  Outgoing:  Frontend → API → NATS → Worker → WhatsApp

Control Flow (Orchestrator IS involved):

  Spawn:     API → NATS → Orchestrator → exec.Command() → Worker
  Kill:      API → NATS → Orchestrator → process.Kill() → Worker stops
```

---

## What the Orchestrator Does

### Responsibilities

| Task | Frequency | Critical? |
|------|-----------|-----------|
| Spawn worker process | On new connection | Yes |
| Kill worker process | On disconnect | Yes |
| Health check workers | Every 30 seconds | Yes |
| Track worker PIDs | Continuous | Yes |
| Restart failed workers | On failure | Yes |

### What It Does NOT Do

| Task | Handled By |
|------|------------|
| Route messages | NATS (direct to workers) |
| Store message history | API + PostgreSQL |
| Handle QR codes | Workers + NATS |
| Authenticate users | API |
| Manage sessions | Workers + PostgreSQL |

### Current Implementation

```go
// services/orchestrator/internal/manager/manager.go

type Manager struct {
    workers map[string]*WorkerProcess  // In-memory state
    mu      sync.RWMutex
    nats    *nats.Client
    config  Config
}

type WorkerProcess struct {
    ID           string
    CompanyID    string
    ConnectionID string
    PID          int
    Status       string
    cmd          *exec.Cmd
    StartedAt    time.Time
}
```

---

## Bottleneck Analysis

### Is the Orchestrator a Bottleneck?

**For messaging: NO**

Messages flow directly through NATS:
- Workers publish events to `WHATSAPP.events.{company}.{connection}.*`
- Workers subscribe to `WHATSAPP.commands.{company}.{connection}`
- API subscribes to events, publishes commands
- Orchestrator is completely bypassed

**For scaling connections: POTENTIALLY**

| Scenario | Impact |
|----------|--------|
| Orchestrator crashes | Can't spawn new workers, existing ones continue |
| Many simultaneous spawns | Could slow down (process spawning is fast though) |
| 1000+ workers on single host | Memory/CPU limits of host machine |

### Single Point of Failure Risks

```
┌─────────────────────────────────────────────────────────────────┐
│                    FAILURE SCENARIOS                             │
└─────────────────────────────────────────────────────────────────┘

Scenario 1: Orchestrator Crashes
├─ Existing workers: ✅ Continue working (they're independent processes)
├─ New connections:  ❌ Cannot spawn
├─ Disconnections:   ⚠️  Workers won't be gracefully killed
└─ Health checks:    ❌ Dead workers won't be detected

Scenario 2: Orchestrator Restarts
├─ Worker PIDs:      ❌ Lost (in-memory state)
├─ Running workers:  ⚠️  Become orphaned
└─ Recovery:         Must scan for orphaned processes or restart all

Scenario 3: Host Machine Fails
├─ All workers:      ❌ Lost
├─ Recovery:         Users must reconnect (sessions in PostgreSQL)
└─ Availability:     Zero until host recovers
```

---

## Scaling Options

### Option 1: Single Orchestrator (Current)

**Best for:** < 100 connections, single-region deployment

```
┌────────────────────────────────────────┐
│         Single Orchestrator            │
│                                        │
│  Pros:                                 │
│  ✅ Simple deployment                  │
│  ✅ No distributed state               │
│  ✅ Easy debugging                     │
│                                        │
│  Cons:                                 │
│  ❌ Single point of failure            │
│  ❌ Limited by host resources          │
│  ❌ State lost on restart              │
└────────────────────────────────────────┘
```

### Option 2: Persistent State Orchestrator

**Best for:** 100-500 connections, need HA

Store worker state externally so multiple orchestrators can run:

```
┌─────────────────────────────────────────────────────────────────┐
│                    DISTRIBUTED ORCHESTRATORS                     │
└─────────────────────────────────────────────────────────────────┘

        ┌──────────────┐      ┌──────────────┐
        │ Orchestrator │      │ Orchestrator │
        │   Node 1     │      │   Node 2     │
        └──────┬───────┘      └──────┬───────┘
               │                     │
               └──────────┬──────────┘
                          │
                          ▼
               ┌─────────────────────┐
               │  Redis / PostgreSQL │
               │                     │
               │  - Worker registry  │
               │  - Distributed locks│
               │  - Health status    │
               └─────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
    ┌─────────┐      ┌─────────┐      ┌─────────┐
    │ Worker  │      │ Worker  │      │ Worker  │
    │ Host 1  │      │ Host 1  │      │ Host 2  │
    └─────────┘      └─────────┘      └─────────┘
```

**Implementation:**

```go
// Worker Registry Interface
type WorkerRegistry interface {
    // Register a worker with its metadata
    Register(ctx context.Context, worker *WorkerInfo) error

    // Update worker heartbeat
    Heartbeat(ctx context.Context, workerID string) error

    // Get worker info
    Get(ctx context.Context, workerID string) (*WorkerInfo, error)

    // List all workers (with optional filters)
    List(ctx context.Context, filter WorkerFilter) ([]*WorkerInfo, error)

    // Deregister worker
    Deregister(ctx context.Context, workerID string) error

    // Acquire lock for spawning (prevent duplicates)
    AcquireSpawnLock(ctx context.Context, connectionID string) (bool, error)

    // Release spawn lock
    ReleaseSpawnLock(ctx context.Context, connectionID string) error
}

type WorkerInfo struct {
    ID           string
    ConnectionID string
    CompanyID    string
    HostID       string    // Which orchestrator host
    PID          int
    Status       string
    StartedAt    time.Time
    LastSeen     time.Time
}
```

### Option 3: Kubernetes Native

**Best for:** 500+ connections, cloud-native deployment

Replace process spawning with Kubernetes pods:

```
┌─────────────────────────────────────────────────────────────────┐
│                    KUBERNETES ARCHITECTURE                       │
└─────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────┐
                    │   Kubernetes Operator   │
                    │   (or simple controller)│
                    └───────────┬─────────────┘
                                │ creates
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                           │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │    Pod      │  │    Pod      │  │    Pod      │             │
│  │  worker-a1  │  │  worker-a2  │  │  worker-b1  │             │
│  │             │  │             │  │             │             │
│  │ Company A   │  │ Company A   │  │ Company B   │             │
│  │ Connection 1│  │ Connection 2│  │ Connection 1│             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Benefits:                                                    ││
│  │ ✅ Auto-restart on failure (K8s handles it)                 ││
│  │ ✅ Resource limits per worker                               ││
│  │ ✅ Horizontal scaling across nodes                          ││
│  │ ✅ Built-in health checks (liveness/readiness probes)       ││
│  │ ✅ Rolling updates                                          ││
│  │ ✅ No custom orchestrator needed                            ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Pod Spec Example:**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: whatsapp-worker-{{ .ConnectionID }}
  labels:
    app: whatsapp-worker
    company: {{ .CompanyID }}
    connection: {{ .ConnectionID }}
spec:
  containers:
  - name: worker
    image: whatsapp-worker:latest
    env:
    - name: COMPANY_ID
      value: "{{ .CompanyID }}"
    - name: CONNECTION_ID
      value: "{{ .ConnectionID }}"
    - name: DATABASE_URL
      valueFrom:
        secretKeyRef:
          name: db-credentials
          key: url
    - name: NATS_URL
      value: "nats://nats:4222"
    resources:
      requests:
        memory: "64Mi"
        cpu: "50m"
      limits:
        memory: "256Mi"
        cpu: "200m"
    livenessProbe:
      httpGet:
        path: /health
        port: 8081
      initialDelaySeconds: 10
      periodSeconds: 30
    readinessProbe:
      httpGet:
        path: /ready
        port: 8081
      initialDelaySeconds: 5
      periodSeconds: 10
  restartPolicy: Always
```

### Option 4: Serverless / On-Demand Machines

**Best for:** Variable load, cost optimization

Use platforms like Fly.io Machines, AWS ECS, or Google Cloud Run:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SERVERLESS ARCHITECTURE                       │
└─────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────┐
                    │      API Server         │
                    │                         │
                    │  On spawn request:      │
                    │  → Call Fly.io API      │
                    │  → Create machine       │
                    └───────────┬─────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Fly.io / AWS ECS                            │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Machine    │  │  Machine    │  │  Machine    │             │
│  │  (running)  │  │  (running)  │  │  (stopped)  │ ← Hibernate │
│  │             │  │             │  │             │   when idle │
│  │  $0.01/hr   │  │  $0.01/hr   │  │  $0/hr      │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Benefits:                                                    ││
│  │ ✅ Pay only for active connections                          ││
│  │ ✅ Auto-hibernation when idle                               ││
│  │ ✅ Global edge deployment                                   ││
│  │ ✅ No server management                                     ││
│  │ ❌ Cold start latency (2-5 seconds)                         ││
│  │ ❌ Platform lock-in                                         ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Fly.io Example:**

```go
// API spawns Fly.io machine instead of local process
func (s *WhatsAppService) SpawnConnection(ctx context.Context, req SpawnRequest) error {
    machine, err := fly.CreateMachine(ctx, fly.MachineConfig{
        App:    "whatsapp-workers",
        Name:   fmt.Sprintf("worker-%s", req.ConnectionID),
        Region: "iad", // or nearest to user
        Config: fly.MachineConfigDetails{
            Image: "registry.fly.io/whatsapp-worker:latest",
            Env: map[string]string{
                "COMPANY_ID":    req.CompanyID,
                "CONNECTION_ID": req.ConnectionID,
                "DATABASE_URL":  os.Getenv("DATABASE_URL"),
                "NATS_URL":      os.Getenv("NATS_URL"),
            },
            Services: []fly.Service{{
                Ports: []fly.Port{{Port: 8081}},
                Protocol: "tcp",
                InternalPort: 8081,
            }},
            AutoDestroy: true,
        },
    })
    return err
}
```

---

## Implementation Details

### Option 2: PostgreSQL-based Registry

```sql
-- Worker registry table
CREATE TABLE orchestrator_workers (
    id UUID PRIMARY KEY,
    connection_id UUID NOT NULL UNIQUE,
    company_id UUID NOT NULL,
    host_id VARCHAR(255) NOT NULL,
    pid INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'starting',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',

    CONSTRAINT fk_connection
        FOREIGN KEY (connection_id)
        REFERENCES whatsapp_connections(id)
        ON DELETE CASCADE
);

-- Index for fast lookups
CREATE INDEX idx_workers_connection ON orchestrator_workers(connection_id);
CREATE INDEX idx_workers_host ON orchestrator_workers(host_id);
CREATE INDEX idx_workers_status ON orchestrator_workers(status);

-- Spawn lock table (prevents duplicate spawns)
CREATE TABLE orchestrator_spawn_locks (
    connection_id UUID PRIMARY KEY,
    locked_by VARCHAR(255) NOT NULL,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
```

```go
// PostgreSQL Registry Implementation
type PGWorkerRegistry struct {
    db     *sql.DB
    hostID string
}

func (r *PGWorkerRegistry) AcquireSpawnLock(ctx context.Context, connectionID string) (bool, error) {
    // Try to insert lock, fail if already exists and not expired
    result, err := r.db.ExecContext(ctx, `
        INSERT INTO orchestrator_spawn_locks (connection_id, locked_by, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '30 seconds')
        ON CONFLICT (connection_id) DO UPDATE
        SET locked_by = EXCLUDED.locked_by,
            locked_at = NOW(),
            expires_at = EXCLUDED.expires_at
        WHERE orchestrator_spawn_locks.expires_at < NOW()
    `, connectionID, r.hostID)

    if err != nil {
        return false, err
    }

    rows, _ := result.RowsAffected()
    return rows > 0, nil
}

func (r *PGWorkerRegistry) Register(ctx context.Context, worker *WorkerInfo) error {
    _, err := r.db.ExecContext(ctx, `
        INSERT INTO orchestrator_workers
            (id, connection_id, company_id, host_id, pid, status)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (connection_id) DO UPDATE
        SET host_id = EXCLUDED.host_id,
            pid = EXCLUDED.pid,
            status = EXCLUDED.status,
            started_at = NOW(),
            last_heartbeat = NOW()
    `, worker.ID, worker.ConnectionID, worker.CompanyID,
       r.hostID, worker.PID, worker.Status)
    return err
}

func (r *PGWorkerRegistry) Heartbeat(ctx context.Context, workerID string) error {
    _, err := r.db.ExecContext(ctx, `
        UPDATE orchestrator_workers
        SET last_heartbeat = NOW()
        WHERE id = $1 AND host_id = $2
    `, workerID, r.hostID)
    return err
}

// Cleanup stale workers (run periodically)
func (r *PGWorkerRegistry) CleanupStale(ctx context.Context, timeout time.Duration) error {
    _, err := r.db.ExecContext(ctx, `
        UPDATE orchestrator_workers
        SET status = 'dead'
        WHERE last_heartbeat < NOW() - $1::interval
        AND status NOT IN ('dead', 'stopped')
    `, timeout.String())
    return err
}
```

### Option 3: Simple Kubernetes Controller

```go
// Simple K8s controller (no full operator needed)
package k8s

import (
    "context"
    corev1 "k8s.io/api/core/v1"
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    "k8s.io/client-go/kubernetes"
)

type WorkerController struct {
    clientset *kubernetes.Clientset
    namespace string
    image     string
}

func (c *WorkerController) SpawnWorker(ctx context.Context, req SpawnRequest) error {
    pod := &corev1.Pod{
        ObjectMeta: metav1.ObjectMeta{
            Name:      fmt.Sprintf("whatsapp-worker-%s", req.ConnectionID[:8]),
            Namespace: c.namespace,
            Labels: map[string]string{
                "app":        "whatsapp-worker",
                "company":    req.CompanyID,
                "connection": req.ConnectionID,
            },
        },
        Spec: corev1.PodSpec{
            RestartPolicy: corev1.RestartPolicyAlways,
            Containers: []corev1.Container{{
                Name:  "worker",
                Image: c.image,
                Env: []corev1.EnvVar{
                    {Name: "COMPANY_ID", Value: req.CompanyID},
                    {Name: "CONNECTION_ID", Value: req.ConnectionID},
                    {Name: "TENANT_SCHEMA", Value: req.TenantSchema},
                    {Name: "DATABASE_URL", ValueFrom: &corev1.EnvVarSource{
                        SecretKeyRef: &corev1.SecretKeySelector{
                            LocalObjectReference: corev1.LocalObjectReference{
                                Name: "db-credentials",
                            },
                            Key: "url",
                        },
                    }},
                    {Name: "NATS_URL", Value: "nats://nats:4222"},
                },
                Resources: corev1.ResourceRequirements{
                    Requests: corev1.ResourceList{
                        corev1.ResourceMemory: resource.MustParse("64Mi"),
                        corev1.ResourceCPU:    resource.MustParse("50m"),
                    },
                    Limits: corev1.ResourceList{
                        corev1.ResourceMemory: resource.MustParse("256Mi"),
                        corev1.ResourceCPU:    resource.MustParse("200m"),
                    },
                },
            }},
        },
    }

    _, err := c.clientset.CoreV1().Pods(c.namespace).Create(ctx, pod, metav1.CreateOptions{})
    return err
}

func (c *WorkerController) KillWorker(ctx context.Context, connectionID string) error {
    // Find pod by label
    pods, err := c.clientset.CoreV1().Pods(c.namespace).List(ctx, metav1.ListOptions{
        LabelSelector: fmt.Sprintf("connection=%s", connectionID),
    })
    if err != nil {
        return err
    }

    for _, pod := range pods.Items {
        err := c.clientset.CoreV1().Pods(c.namespace).Delete(ctx, pod.Name, metav1.DeleteOptions{})
        if err != nil {
            return err
        }
    }
    return nil
}
```

---

## Recommendations by Scale

| Connections | Recommendation | Complexity | Cost |
|-------------|----------------|------------|------|
| < 50 | Option 1: Single Orchestrator | Low | $ |
| 50 - 200 | Option 1 + Health endpoint | Low | $ |
| 200 - 500 | Option 2: Persistent State | Medium | $$ |
| 500 - 2000 | Option 3: Kubernetes | High | $$$ |
| 2000+ | Option 3 + Sharding | Very High | $$$$ |
| Variable/Bursty | Option 4: Serverless | Medium | $ - $$$ |

### Decision Flowchart

```
Start
  │
  ▼
┌─────────────────────────────┐
│ How many connections?       │
└─────────────────────────────┘
  │
  ├─── < 100 ──────────────────▶ Option 1: Keep current
  │                               (add health endpoint + monitoring)
  │
  ├─── 100 - 500 ──────────────▶ Option 2: PostgreSQL registry
  │                               (enables HA, no major rewrite)
  │
  ├─── 500+ ───────────────────▶ Are you on Kubernetes?
  │                               │
  │                               ├── Yes ──▶ Option 3: K8s pods
  │                               │
  │                               └── No ───▶ Option 4: Fly.io/ECS
  │
  └─── Highly variable ────────▶ Option 4: Serverless
                                  (pay per use, auto-scale)
```

---

## Migration Path

### Phase 1: Add Observability (Now)

```go
// Add health endpoint to current orchestrator
func (m *Manager) HealthHandler(w http.ResponseWriter, r *http.Request) {
    m.mu.RLock()
    defer m.mu.RUnlock()

    health := HealthStatus{
        Status:      "healthy",
        WorkerCount: len(m.workers),
        Uptime:      time.Since(m.startTime),
        Workers:     make([]WorkerHealth, 0, len(m.workers)),
    }

    for _, w := range m.workers {
        health.Workers = append(health.Workers, WorkerHealth{
            ID:        w.ID,
            CompanyID: w.CompanyID,
            Status:    w.Status,
            Uptime:    time.Since(w.StartedAt),
        })
    }

    json.NewEncoder(w).Encode(health)
}
```

### Phase 2: Externalize State (When needed)

1. Create `orchestrator_workers` table
2. Modify orchestrator to write state to PostgreSQL
3. Add spawn lock mechanism
4. Deploy second orchestrator instance
5. Test failover

### Phase 3: Kubernetes Migration (When ready)

1. Containerize whatsapp-worker
2. Create Helm chart with pod templates
3. Replace spawn logic with K8s API calls
4. Remove process-based orchestrator
5. Use K8s native features (HPA, PDB)

---

## Appendix: Resource Estimation

### Per-Worker Resource Usage

| Resource | Idle | Active (messaging) |
|----------|------|-------------------|
| Memory | ~30 MB | ~50-100 MB |
| CPU | ~0.01 cores | ~0.05-0.1 cores |
| Network | ~1 KB/s | ~10-50 KB/s |

### Host Capacity Planning

| Host Size | Max Workers | Notes |
|-----------|-------------|-------|
| 2 CPU / 4 GB | ~50 | Development |
| 4 CPU / 8 GB | ~100 | Small production |
| 8 CPU / 16 GB | ~250 | Medium production |
| 16 CPU / 32 GB | ~500 | Large production |

### Cost Comparison (100 connections)

| Option | Monthly Cost | Notes |
|--------|--------------|-------|
| Single VM (8 CPU/16GB) | ~$80 | All-in-one |
| Kubernetes (3 nodes) | ~$150 | + managed K8s fee |
| Fly.io Machines | ~$50-100 | Pay per use |
| AWS ECS Fargate | ~$100-150 | Higher per-task cost |
