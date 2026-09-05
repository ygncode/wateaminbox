package manager

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	natsclient "github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/nats"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

const workerRecordSelect = "SELECT connection_id, company_id, tenant_schema, database_url, pid, status, started_at, last_heartbeat, restart_count, launch_id, desired_state, artifact_version, artifact_sha256, worker_uid, worker_gid, node_id FROM worker_registry WHERE connection_id = $1"

func TestUnadmittedNodeForwardsNewConnectionWithoutSpawning(t *testing.T) {
	h, mock, forwarded := newRoutingHandlers(t)
	h.manager.registry.newConnectionAdmission = true
	mock.ExpectQuery(regexp.QuoteMeta(workerRecordSelect)).WithArgs("connection").WillReturnRows(sqlmock.NewRows(workerRecordColumns))
	mock.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"allowed"}).AddRow(false))
	mock.ExpectQuery("SELECT n.node_id").WillReturnRows(sqlmock.NewRows([]string{"node_id"}).AddRow("ready-peer"))
	payload, err := json.Marshal(types.SpawnWorkerCommand{Type: types.CommandSpawn, CompanyID: "company", ConnectionID: "connection"})
	require.NoError(t, err)
	require.NoError(t, h.handleSpawnCommand(context.Background(), payload, 0))
	require.Equal(t, []string{"ready-peer"}, *forwarded)
	require.Zero(t, h.manager.WorkerCount())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUnadmittedNodeWithoutPeerReturnsForRedelivery(t *testing.T) {
	h, mock, forwarded := newRoutingHandlers(t)
	h.manager.registry.newConnectionAdmission = true
	mock.ExpectQuery(regexp.QuoteMeta(workerRecordSelect)).WithArgs("connection").WillReturnRows(sqlmock.NewRows(workerRecordColumns))
	mock.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"allowed"}).AddRow(false))
	mock.ExpectQuery("SELECT n.node_id").WillReturnRows(sqlmock.NewRows([]string{"node_id"}))
	payload, err := json.Marshal(types.SpawnWorkerCommand{Type: types.CommandSpawn, CompanyID: "company", ConnectionID: "connection"})
	require.NoError(t, err)
	require.ErrorContains(t, h.handleSpawnCommand(context.Background(), payload, 0), "no admitted runtime")
	require.Empty(t, *forwarded)
	require.Zero(t, h.manager.WorkerCount())
	require.NoError(t, mock.ExpectationsWereMet())
}

var workerRecordColumns = []string{
	"connection_id", "company_id", "tenant_schema", "database_url", "pid", "status",
	"started_at", "last_heartbeat", "restart_count", "launch_id", "desired_state",
	"artifact_version", "artifact_sha256", "worker_uid", "worker_gid", "node_id",
}

func expectWorkerOwnedBy(mock sqlmock.Sqlmock, connectionID, companyID, nodeID string) {
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta(workerRecordSelect)).
		WithArgs(connectionID).
		WillReturnRows(sqlmock.NewRows(workerRecordColumns).AddRow(
			connectionID, companyID, "tenant_company", "", 4242, types.StatusConnected,
			now, now, 0, "remote-launch", DesiredStateRunning, "v1",
			"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			100000, 100000, nodeID,
		))
}

func newRoutingHandlers(t *testing.T) (*Handlers, sqlmock.Sqlmock, *[]string) {
	t.Helper()
	registry, mock := newMockRegistry(t)
	m := New(Config{NodeID: "test-node-1"})
	m.ctx = context.Background()
	m.registry = registry
	var forwarded []string
	h := &Handlers{manager: m}
	h.forwardCommand = func(nodeID, companyID, connectionID string, data []byte, hops int) error {
		forwarded = append(forwarded, nodeID)
		return nil
	}
	return h, mock, &forwarded
}

// A kill for a connection owned by another node must be forwarded, never
// acknowledged locally as already satisfied: acking it would silently discard
// stop intent for a live worker on the owner's host.
func TestKillCommandForRemotelyOwnedConnectionIsForwarded(t *testing.T) {
	h, mock, forwarded := newRoutingHandlers(t)
	expectWorkerOwnedBy(mock, "connection", "company", "test-node-2")

	payload, err := json.Marshal(types.KillWorkerCommand{
		Type: types.CommandKill, CompanyID: "company", ConnectionID: "connection", Reason: "stop",
	})
	require.NoError(t, err)

	require.NoError(t, h.handleKillCommand(context.Background(), payload, 0))
	assert.Equal(t, []string{"test-node-2"}, *forwarded)
	assert.Equal(t, 0, h.manager.WorkerCount(), "a forwarded kill must not touch local workers")
	require.NoError(t, mock.ExpectationsWereMet())
}

// A kill with no durable row anywhere is a genuinely unknown connection: the
// desired end state already holds fleet-wide, so it stays idempotent.
func TestKillCommandForUnknownConnectionRemainsIdempotent(t *testing.T) {
	h, mock, forwarded := newRoutingHandlers(t)
	mock.ExpectQuery(regexp.QuoteMeta(workerRecordSelect)).
		WithArgs("connection").
		WillReturnRows(sqlmock.NewRows(workerRecordColumns))
	// The local stop path re-reads the durable record before consulting memory.
	mock.ExpectQuery(regexp.QuoteMeta(workerRecordSelect)).
		WithArgs("connection").
		WillReturnRows(sqlmock.NewRows(workerRecordColumns))

	payload, err := json.Marshal(types.KillWorkerCommand{
		Type: types.CommandKill, CompanyID: "company", ConnectionID: "connection", Reason: "stop",
	})
	require.NoError(t, err)

	require.NoError(t, h.handleKillCommand(context.Background(), payload, 0))
	assert.Empty(t, *forwarded)
	require.NoError(t, mock.ExpectationsWereMet())
}

// A registry failure must surface for redelivery. Falling through to the
// idempotent path on a read error would lose stop intent.
func TestKillCommandRegistryFailureIsRedeliverable(t *testing.T) {
	h, mock, forwarded := newRoutingHandlers(t)
	mock.ExpectQuery(regexp.QuoteMeta(workerRecordSelect)).
		WithArgs("connection").
		WillReturnError(assert.AnError)

	payload, err := json.Marshal(types.KillWorkerCommand{
		Type: types.CommandKill, CompanyID: "company", ConnectionID: "connection", Reason: "stop",
	})
	require.NoError(t, err)

	require.ErrorContains(t, h.handleKillCommand(context.Background(), payload, 0), "resolve owner")
	assert.Empty(t, *forwarded)
	require.NoError(t, mock.ExpectationsWereMet())
}

// A spawn for a connection owned by another node must run there: its session
// affinity and durable launch generation belong to that node.
func TestSpawnCommandForRemotelyOwnedConnectionIsForwarded(t *testing.T) {
	h, mock, forwarded := newRoutingHandlers(t)
	expectWorkerOwnedBy(mock, "connection", "company", "test-node-2")

	payload, err := json.Marshal(types.SpawnWorkerCommand{
		Type: types.CommandSpawn, CompanyID: "company", ConnectionID: "connection",
		TenantSchema: "tenant_company",
	})
	require.NoError(t, err)

	require.NoError(t, h.handleSpawnCommand(context.Background(), payload, 0))
	assert.Equal(t, []string{"test-node-2"}, *forwarded)
	assert.Equal(t, 0, h.manager.WorkerCount(), "a forwarded spawn must not start a local worker")
	require.NoError(t, mock.ExpectationsWereMet())
}

// A command whose registry row names another tenant must be rejected for
// redelivery rather than executed or forwarded.
func TestRoutingRejectsCrossTenantCommands(t *testing.T) {
	h, mock, forwarded := newRoutingHandlers(t)
	expectWorkerOwnedBy(mock, "connection", "other-company", "test-node-2")

	payload, err := json.Marshal(types.KillWorkerCommand{
		Type: types.CommandKill, CompanyID: "company", ConnectionID: "connection", Reason: "stop",
	})
	require.NoError(t, err)

	require.ErrorContains(t, h.handleKillCommand(context.Background(), payload, 0), "belongs to another company")
	assert.Empty(t, *forwarded)
	require.NoError(t, mock.ExpectationsWereMet())
}

// Forwarding is bounded: once the hop budget is spent the message errors into
// redelivery, which re-resolves ownership, instead of hopping forever.
func TestForwardingStopsAtHopBound(t *testing.T) {
	h, mock, forwarded := newRoutingHandlers(t)
	expectWorkerOwnedBy(mock, "connection", "company", "test-node-2")

	payload, err := json.Marshal(types.KillWorkerCommand{
		Type: types.CommandKill, CompanyID: "company", ConnectionID: "connection", Reason: "stop",
	})
	require.NoError(t, err)

	err = h.handleKillCommand(context.Background(), payload, maxForwardHops)
	require.ErrorContains(t, err, "forwarding hops")
	assert.Empty(t, *forwarded)
	require.NoError(t, mock.ExpectationsWereMet())
}

// A status request for a remotely-owned connection is answered from the
// registry rather than forwarded; the registry answer stays available even
// while the owning node is down.
func TestStatusCommandForRemotelyOwnedConnectionAnswersFromRegistry(t *testing.T) {
	h, mock, forwarded := newRoutingHandlers(t)
	expectWorkerOwnedBy(mock, "connection", "company", "test-node-2")

	var published []types.WorkerStatusResponse
	h.publishEvent = func(subject string, data []byte) error {
		require.Equal(t, types.SubjectEvents, subject)
		var response types.WorkerStatusResponse
		require.NoError(t, json.Unmarshal(data, &response))
		published = append(published, response)
		return nil
	}

	payload, err := json.Marshal(types.WorkerStatusCommand{
		Type: types.CommandStatus, CompanyID: "company", ConnectionID: "connection",
	})
	require.NoError(t, err)

	require.NoError(t, h.handleStatusCommand(context.Background(), payload, 0))
	assert.Empty(t, *forwarded)
	require.Len(t, published, 1)
	assert.Equal(t, types.StatusConnected, published[0].Status)
	assert.Equal(t, "connection", published[0].ConnectionID)
	require.NoError(t, mock.ExpectationsWereMet())
}

// The shared placement consumer's filter overlaps every node-addressed
// subject, and each node consumer receives an independent copy of the same
// message. The shared consumer must therefore skip ALL node-addressed
// subjects — foreign and its own alike — or every forwarded command would be
// executed twice (a forwarded spawn's second run stops the just-spawned
// worker as a "restart requested for pairing").
func TestNodeSubjectsAreSkippedByTheSharedConsumer(t *testing.T) {
	m := New(Config{NodeID: "test-node-1"})
	h := &Handlers{manager: m}

	assert.True(t, h.sharedConsumerSkips("WHATSAPP.commands.node.test-node-2.company.connection"))
	assert.True(t, h.sharedConsumerSkips("WHATSAPP.commands.node.test-node-1.company.connection"),
		"own-node subjects are executed by the node consumer's copy, never the shared one")
	assert.True(t, h.sharedConsumerSkips("WHATSAPP.commands.node.test-node-11.company.connection"))
	assert.False(t, h.sharedConsumerSkips("WHATSAPP.commands.company.connection"))

	// Without a node identity (persistence-free single instance) there is no
	// node consumer, so nothing may be skipped.
	single := &Handlers{manager: New(Config{})}
	assert.False(t, single.sharedConsumerSkips("WHATSAPP.commands.node.test-node-2.company.connection"))
}

// Recovery must read only rows this node owns, after adopting only ownerless
// pre-migration rows. The adoption CAS predicate and the node-scoped read
// together guarantee a node never adopts or respawns another node's row.
func TestRecoveryReadsOnlyNodeOwnedRows(t *testing.T) {
	registry, mock := newMockRegistry(t)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE worker_registry SET node_id = $1 WHERE node_id IS NULL")).
		WithArgs("test-node-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM worker_registry\n\t\tWHERE node_id = $1")).
		WithArgs("test-node-1").
		WillReturnRows(sqlmock.NewRows(workerRecordColumns))

	m := New(Config{NodeID: "test-node-1"})
	m.ctx = context.Background()
	m.registry = registry
	require.NoError(t, m.recoverOrphanedWorkers(context.Background()))
	assert.Equal(t, 0, m.WorkerCount())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestNodeCommandSubjectShape(t *testing.T) {
	subject := natsclient.NodeCommandSubject("node-2", "company", "connection")
	assert.Equal(t, "WHATSAPP.commands.node.node-2.company.connection", subject)
	assert.True(t, natsclient.IsNodeCommandSubject(subject))
	assert.False(t, natsclient.IsNodeCommandSubject("WHATSAPP.commands.company.connection"))
}

func TestValidateNodeID(t *testing.T) {
	require.NoError(t, validateNodeID("node-1"))
	require.NoError(t, validateNodeID("Node_A2"))
	require.Error(t, validateNodeID(""))
	require.Error(t, validateNodeID("node.one"), "dots would break subject token boundaries")
	require.Error(t, validateNodeID("node one"))
	require.Error(t, validateNodeID("node*"))
	require.Error(t, validateNodeID("node>"))
}
