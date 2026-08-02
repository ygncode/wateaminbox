package api

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/manager"
)

func TestNewServerDefaultsToLoopback(t *testing.T) {
	server, err := NewServer(Config{Manager: manager.New(manager.Config{})})
	require.NoError(t, err)
	assert.Equal(t, "127.0.0.1:8080", server.addr)
	assert.Equal(t, "127.0.0.1:8080", server.httpServer.Addr)
}

func TestNewServerRequiresTokenForNonLoopbackListener(t *testing.T) {
	addresses := []string{
		":8080",
		"0.0.0.0:8080",
		"[::]:8080",
		"192.0.2.10:8080",
		"orchestrator.internal:8080",
	}

	for _, address := range addresses {
		t.Run(address, func(t *testing.T) {
			server, err := NewServer(Config{Address: address})
			assert.Nil(t, server)
			require.Error(t, err)
			assert.Contains(t, err.Error(), "HTTP_BEARER_TOKEN")
		})
	}
}

func TestNewServerAllowsLoopbackWithoutToken(t *testing.T) {
	for _, address := range []string{"localhost:8080", "127.0.0.2:8080", "[::1]:8080"} {
		t.Run(address, func(t *testing.T) {
			server, err := NewServer(Config{Address: address})
			require.NoError(t, err)
			assert.Equal(t, address, server.addr)
		})
	}
}

func TestNewServerRejectsShortBearerToken(t *testing.T) {
	server, err := NewServer(Config{
		Address:     "0.0.0.0:8080",
		BearerToken: "too-short",
	})
	assert.Nil(t, server)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "at least 32 characters")
}

func TestServerStartBindsBeforeReturning(t *testing.T) {
	server, err := NewServer(Config{Address: "127.0.0.1:0"})
	require.NoError(t, err)
	require.NoError(t, server.Start())
	require.NotNil(t, server.listener)
	assert.NotEqual(t, 0, server.listener.Addr().(*net.TCPAddr).Port)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, server.Stop(ctx))
}

func TestServerStartReportsBindFailure(t *testing.T) {
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer occupied.Close()

	server, err := NewServer(Config{Address: occupied.Addr().String()})
	require.NoError(t, err)
	err = server.Start()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "listen on")
}

func TestHealthRemainsPublicWhenWorkerEndpointsAreProtected(t *testing.T) {
	server := newProtectedTestServer(t)

	response := performRequest(server, http.MethodGet, "/health", "")
	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	assert.Contains(t, response.Body.String(), `"status":"healthy"`)
}

func TestWorkerEndpointsRequireValidBearerToken(t *testing.T) {
	server := newProtectedTestServer(t)

	for _, authorization := range []string{
		"",
		"Basic orchestrator-test-token-1234567890",
		"Bearer wrong",
		"Bearer orchestrator-test-token-1234567890-extra",
	} {
		response := performRequest(server, http.MethodGet, "/workers", authorization)
		assert.Equal(t, http.StatusUnauthorized, response.Code)
		assert.Equal(t, `Bearer realm="orchestrator"`, response.Header().Get("WWW-Authenticate"))
	}

	response := performRequest(
		server,
		http.MethodGet,
		"/workers",
		"bearer orchestrator-test-token-1234567890",
	)
	assert.Equal(t, http.StatusOK, response.Code)
	assert.Contains(t, response.Body.String(), `"count":0`)

	response = performRequest(
		server,
		http.MethodGet,
		"/workers/missing",
		"Bearer orchestrator-test-token-1234567890",
	)
	assert.Equal(t, http.StatusNotFound, response.Code)
}

func TestNewServerRejectsMalformedAddress(t *testing.T) {
	server, err := NewServer(Config{Address: "not-an-address"})
	assert.Nil(t, server)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid HTTP address")
}

func newProtectedTestServer(t *testing.T) *Server {
	t.Helper()
	server, err := NewServer(Config{
		Address:     "0.0.0.0:8080",
		BearerToken: "orchestrator-test-token-1234567890",
		Manager:     manager.New(manager.Config{}),
	})
	require.NoError(t, err)
	return server
}

func performRequest(server *Server, method, path, authorization string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, nil)
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	response := httptest.NewRecorder()
	server.httpServer.Handler.ServeHTTP(response, request)
	return response
}
