# Orchestrator Horizontal Scaling Plan

## Objective

Allow more than one Go orchestrator instance to run concurrently against one
fleet, so that WhatsApp worker capacity is no longer bound to a single host and
orchestrator replacement no longer requires a full stop-first outage.

Implementation status: workstreams 1 and 2 are implemented (migration 077,
`ORCHESTRATOR_NODE_ID`, node-scoped recovery with NULL-owner adoption, per-node
command consumers, and ownership-aware routing with hop-bounded forwarding).
Workstreams 3 through 6 remain design only, so multi-node production deployment
is still not permitted; the single-node stop-first constraint is now per node.

## Current state

The orchestrator is single-instance by design. `docs/deployment.md` states the
constraint directly: do not scale the orchestrator horizontally without changing
its ownership model.

The reason is that the orchestrator owns workers as local operating-system child
processes:

- `services/orchestrator/internal/manager/manager.go:547` starts each worker with
  `exec.Command`, and stop paths signal the PID and its process group directly.
- `recoverOrphanedWorkers` (`manager.go:1888`) reads the entire registry through
  `registry.GetAllWorkers`, with no host predicate, and respawns any row whose
  PID is not alive on the local machine.
- Commands arrive on one shared durable JetStream consumer,
  `orchestrator-commands` (`internal/nats/streams.go`), so a command for any
  connection can be delivered to any instance.
- `handleKillCommand` treats `ErrWorkerNotFound` as an idempotent success and
  acknowledges the message (`internal/manager/handlers.go:213`), and
  `handleStatusCommand` answers from the local in-memory worker map.
- `ORCHESTRATOR_MAX_WORKERS` (default `15`) is a per-process counter that
  currently doubles as the global effective-connection ceiling.
- The worker upgrade and rollout state machine in `internal/manager/upgrade.go`
  drives a single global batch and assumes it owns every item in it.
- The operator HTTP API binds `127.0.0.1:8080` and serves `/workers` and
  `/rollouts` from in-process state.

Running two instances against this model today would produce duplicate
respawns of every connection, silently dropped kill commands, and incorrect
status replies.

## What already supports scaling

The parts that are usually expensive to retrofit are already in place. Workers
are location-transparent to everything except the orchestrator:

- WhatsApp session state, including whatsmeow device and key material, lives in
  PostgreSQL scoped by `connection_id`
  (`services/whatsapp/internal/store/pgstore.go`). Workers hold no local disk
  state, so a worker can legitimately start on any host.
- The API reaches workers over per-connection NATS subjects with their own
  durable consumers (`services/whatsapp/internal/nats/subscriber.go:367`). It
  never addresses a worker through the orchestrator's host.
- Worker operating-system identities are allocated from a global PostgreSQL
  sequence behind a unique index, so per-host process isolation does not collide
  across hosts.
- `ClaimWorkerLaunch` (`internal/manager/persistence.go:254`) is already a
  generation-scoped compare-and-swap whose stated purpose is preventing
  overlapping orchestrators from both claiming one connection. It is a safety
  net for stop-first replacement rather than a sharding mechanism, but it is the
  correct primitive to build placement on.

The work is therefore adding placement and ownership to the control plane, not
re-architecting worker execution.

## Workstreams

### 1. Node identity and host-scoped recovery (implemented)

Required first; without it every other change is unsafe.

- Add `node_id` to `worker_registry` and populate it from a stable
  `ORCHESTRATOR_NODE_ID` environment value.
- Include `node_id` in `ClaimWorkerLaunch` and `ActivateWorkerLaunch`.
- Replace `GetAllWorkers` in `recoverOrphanedWorkers` with a node-scoped query.
- Follow the existing migration-gate convention: the new orchestrator refuses to
  start until the migration exists, matching how migrations 070 and 071 are
  handled.

Until this lands, a second instance will adopt or respawn connections owned by
another host, producing two whatsmeow clients against one set of device rows.

### 2. Ownership-aware command routing (implemented)

- Introduce per-node command subjects, `WHATSAPP.commands.node.<nodeID>.>`, each
  with its own durable consumer.
- Retain the shared consumer only for placement decisions.
- Route in `handlers.go`:
  - Spawn with no registry row: attempt a claim under this node, subject to
    admission control.
  - Spawn with a row owned elsewhere: forward to the owner's node subject.
  - Kill and status: resolve the owner from the registry and forward.
- Remove the current behaviour where a kill for an unknown connection is
  acknowledged as already satisfied. Under multiple instances that path silently
  discards stop intent, so it must distinguish "no such connection" from "not
  mine".

### 3. Placement and global capacity

- Separate per-node capacity from the fleet-wide connection ceiling. The
  effective-connection cap of 15 is a commercial invariant and must be enforced
  from authoritative shared state, not from a per-process counter.
- Keep entitlement authority in the private control plane. The orchestrator
  enforces placement and capacity; it does not acquire commercial policy.
- Select a target node by live capacity, subject to the affinity rule in the
  risks section below.

### 4. Node liveness and fencing

This is the workstream with real correctness risk.

- Add an `orchestrator_nodes` table carrying a lease heartbeat per instance.
- Adopt self-fencing: an orchestrator that cannot renew its lease for a bounded
  interval must terminate its own workers. The orchestrator already writes
  worker heartbeats on their behalf from its health-check loop
  (`manager.go:1440`), so lease renewal has a natural home there.
- Permit takeover of a failed node's connections only after the lease interval
  plus a margin, so that the previous owner has provably self-fenced.
- Do not take over on a missed heartbeat alone. Two live whatsmeow clients on
  one connection's device rows can corrupt the session or force a logout, which
  is a customer-visible reconnect and re-pair.

### 5. Rollout and upgrade coordination

- Make the batch in `upgrade.go` node-aware, either by electing one coordinator
  that drives the batch while each node executes its own items through the node
  subject, or by splitting into per-node batches.
- `RecoverWorkerUpgrade` must resume only items belonging to the recovering
  node.
- Preserve the existing durable stop-first item semantics; overlap between a
  source and target generation remains prohibited.

### 6. Operator surface and deployment

- Serve `/workers` and `/rollouts` from the registry rather than in-process
  state, so an operator sees the fleet instead of one instance.
- Run the worker-artifact installer on every host and keep artifact version and
  SHA-256 identity as the cross-host contract.
- Convert the stop-first orchestrator constraint from fleet-wide to per-node.
  That conversion is what makes rolling orchestrator deployment possible, and is
  a significant operational benefit independent of added capacity.

## Sequencing

1. Workstreams 1 through 3 deliver multi-host capacity.
2. Workstream 4 delivers availability, and should not be attempted before 1
   through 3 are stable.
3. Workstreams 5 and 6 can proceed in parallel with 4 but must land before any
   multi-node production deployment.

Workstreams 1 and 2 must ship together. Node-scoped recovery without ownership
routing leaves kill and status commands landing on the wrong instance.

## Risks and open decisions

- **Fencing must reach the workers, not just the orchestrator.** A SIGKILLed
  or wedged orchestrator cannot self-fence. On Linux this is covered by the
  existing parent-death `SIGKILL` (`Pdeathsig` in
  `internal/manager/process_isolation_linux.go`): the kernel kills workers when
  their orchestrator dies. Workstream 4's takeover window may rely on that only
  on Linux, and must add a worker-side lease check (or session-layer fencing
  token) before any non-Linux or containerized topology where parent death
  does not reliably kill the child.
- **The fleet ceiling must be atomic with the claim.** Counting active rows
  and then claiming is a race two nodes can both win. Workstream 3's cap check
  must run inside the same statement/transaction as `ClaimWorkerLaunch`.
- **A dead node's command subject strands forwarded messages.** Commands
  forwarded to `WHATSAPP.commands.node.<nodeID>.>` wait in that node's durable
  consumer until it returns. Workstream 4's takeover must re-drive pending
  intent for reassigned connections (the registry's `desired_state` is the
  authoritative record to reconcile from), and forwarding intentionally breaks
  per-connection command ordering across nodes.

- **Egress IP identity.** Moving a worker between hosts changes its outbound IP.
  WhatsApp session and account reputation are sensitive to this. Node affinity
  per connection, with movement only on node failure, is the safer default and
  should be decided before free placement is implemented.
- **Infrastructure scope.** Production today is a single Singapore droplet.
  Genuine horizontal scaling also requires NATS clustering, PostgreSQL
  availability planning, and multi-host artifact distribution. Until that exists,
  multiple orchestrators on one host add process resilience but not availability.
- **No SLA implication.** Completing this plan does not by itself justify an
  availability commitment, and none should be published on the current topology.
- **Capacity is not the current pressure.** The 15-connection effective ceiling
  fits comfortably on one host. The near-term value of this work is rolling
  orchestrator replacement and failure recovery, not throughput.

## Validation expectations

Any implementation of this plan should extend the existing orchestrator test
suites rather than add parallel ones. The areas that need direct coverage are:

- Node-scoped recovery, asserting that a node never adopts or respawns a row
  owned by another node.
- Command routing, including forwarding and the distinction between an unknown
  connection and a remotely-owned one.
- Lease expiry and self-fencing, asserting that a node with an expired lease
  terminates its workers before any takeover window opens.
- Placement under the fleet-wide connection ceiling.

Run checks from within `services/orchestrator` alongside the repository's
existing Go and Compose tests.
