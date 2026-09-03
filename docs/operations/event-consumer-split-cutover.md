# WhatsApp event consumer split cutover

This runbook applies when upgrading an existing installation from the single
`whatsapp-api-events-v1` JetStream consumer to the isolated consumers:

- `whatsapp-api-critical-events-v1` — messages, receipts, send confirmations,
  connection state, and other durable application events
- `whatsapp-api-transient-events-v1` — presence and typing events

The split prevents reconnect-driven presence bursts from delaying send
confirmations. The `WHATSAPP_EVENTS` stream uses interest retention, so preserve
consumer coverage throughout the cutover.

Deleting a production consumer is a production-sensitive operation. Obtain
explicit approval immediately before the deletion command.

## Cutover

Do not run old and new API revisions concurrently while creating the split
consumers. Events published after a replacement consumer is created are retained
for it; an old API still bound to the legacy consumer could process the same
event first. Some lifecycle handlers are not idempotent, so overlap can create
duplicate rows and broadcasts.

1. Record the deployed revisions and confirm the legacy consumer is drained.
2. Stop/drain every old API replica and stop every WhatsApp event publisher
   (workers and orchestrator-managed worker starts). Leave NATS and both
   databases running. Confirm no API remains bound to
   `whatsapp-api-events-v1` and no worker can publish during the gap; worker
   event outboxes remain durable while workers are stopped.
3. Deploy the revision containing the split. The orchestrator creates both new
   consumers with `DeliverNew` policy before the new API binds to them. The
   existing legacy consumer is left untouched but is no longer created on fresh
   installations. Keep the API stopped if provisioning fails; do not restart
   an old API alongside the new consumers.
4. Confirm both new consumers exist:

   ```sh
   nats consumer info WHATSAPP_EVENTS whatsapp-api-critical-events-v1
   nats consumer info WHATSAPP_EVENTS whatsapp-api-transient-events-v1
   ```

5. Start only the new API revision, then resume workers after both split
   consumers exist. Confirm readiness is healthy. During normal traffic,
   verify the critical
   consumer's `num_pending` and `num_ack_pending` are stable or draining. A
   presence burst may backlog the transient consumer but must not increase the
   critical backlog.
6. Confirm send confirmations continue changing pending messages to `sent`,
   `delivered`, or `read` without timeout metadata.
7. After explicit approval, delete the unbound legacy consumer:

   ```sh
   nats consumer rm WHATSAPP_EVENTS whatsapp-api-events-v1 --force
   ```

8. Verify the two new consumers again and confirm the legacy consumer is absent.

Do not leave the legacy consumer unbound indefinitely. Its unacknowledged copy
of every event prevents interest-based deletion and can eventually fill the
stream, whose discard policy rejects new publishes when full.

## Rollback

Do not run old and new API revisions concurrently during rollback. Stop/drain
all new API replicas first. Do not delete either new consumer: their disjoint
filters retain events published while no API is bound. Confirm the legacy
consumer still exists, then start only the previous API revision and verify it
is active before changing consumer registrations. Any event retained by both
the legacy and replacement consumers may be delivered twice; inspect the
backlogs and reconcile non-idempotent lifecycle data before retiring either
copy.
