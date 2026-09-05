package manager

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestConnectionPermitsPostgres(t *testing.T) {
	if os.Getenv("RUN_CONNECTION_PERMIT_DB_TEST") != "1" {
		t.Skip("isolated database required")
	}
	const url = "postgres://postgres@127.0.0.1:5432/wti_permit_test?sslmode=disable"
	db, err := sql.Open("postgres", url)
	require.NoError(t, err)
	defer db.Close()
	ctx := context.Background()
	_, err = db.Exec(`CREATE TABLE public.runtime_node_admission(node_id text PRIMARY KEY,accepting_new boolean,expires_at timestamptz,connection_permits jsonb);
	 CREATE TABLE orchestrator_nodes(node_id text PRIMARY KEY,max_workers int,lease_expires_at timestamptz);
	 CREATE TABLE worker_registry(connection_id uuid PRIMARY KEY,company_id uuid,node_id text,desired_state text);
	 INSERT INTO orchestrator_nodes VALUES ('target',15,now()+interval '1 hour'),('source',15,now()-interval '1 hour');
	 INSERT INTO public.runtime_node_admission VALUES ('target',false,now()+interval '1 hour',
	 jsonb_build_array(jsonb_build_object('company_id','11111111-1111-4111-8111-111111111111','connection_id','22222222-2222-4222-8222-222222222222','expires_at',now()+interval '10 minutes')));`)
	require.NoError(t, err)
	company, connection := "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
	target := &WorkerRegistry{db: db, nodeID: "target", newConnectionAdmission: true}
	source := &WorkerRegistry{db: db, nodeID: "source", newConnectionAdmission: true}
	for _, tc := range []struct {
		company, connection string
		allowed             bool
	}{
		{company, connection, true}, {connection, connection, false}, {company, company, false}, {"", "", false},
	} {
		allowed, e := target.AcceptsNewConnections(ctx, tc.company, tc.connection)
		require.NoError(t, e)
		require.Equal(t, tc.allowed, allowed)
		_, found, e := source.SelectSpawnNode(ctx, tc.company, tc.connection)
		require.NoError(t, e)
		require.Equal(t, tc.allowed, found)
	}
	_, err = db.Exec(`INSERT INTO worker_registry VALUES ($1,$2,'source','running')`, connection, company)
	require.NoError(t, err)
	moved, err := target.TakeOverFailedNodeWorker(ctx, connection, "source", time.Second)
	require.NoError(t, err)
	require.True(t, moved)
	_, err = db.Exec(`UPDATE worker_registry SET node_id='source',company_id=$1`, connection)
	require.NoError(t, err)
	moved, err = target.TakeOverFailedNodeWorker(ctx, connection, "source", time.Second)
	require.NoError(t, err)
	require.False(t, moved)
	for _, mutation := range []string{
		`UPDATE runtime_node_admission SET connection_permits=jsonb_set(connection_permits,'{0,expires_at}',to_jsonb((now()-interval '1 second')::text))`,
		`UPDATE runtime_node_admission SET connection_permits='[]'`,
		`UPDATE runtime_node_admission SET accepting_new=true,expires_at=now()-interval '1 second'`,
	} {
		_, err = db.Exec(mutation)
		require.NoError(t, err)
		allowed, e := target.AcceptsNewConnections(ctx, company, connection)
		require.NoError(t, e)
		require.False(t, allowed)
	}
}
