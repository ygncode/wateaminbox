package manager

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWorkerEnvironmentIsStrictDataPlaneAllowlist(t *testing.T) {
	for name, value := range map[string]string{
		"HTTP_BEARER_TOKEN":        "rollout-authority",
		"JWT_SECRET":               "jwt-authority",
		"DATABASE_URL":             "postgresql://manager-control",
		"NATS_URL":                 "nats://service-control",
		"POSTGRES_PASSWORD":        "manager-password",
		"NATS_SERVICE_PASSWORD":    "service-password",
		"PATH":                     "/privileged/bin",
		"S3_ENDPOINT":              "https://storage.example",
		"S3_ACCESS_KEY":            "shared-data-plane-key",
		"WORKER_DB_MAX_OPEN_CONNS": "4",
	} {
		t.Setenv(name, value)
	}

	environment := workerBaseEnvironment()
	joined := strings.Join(environment, "\n")
	for _, forbidden := range []string{
		"HTTP_BEARER_TOKEN=", "JWT_SECRET=", "DATABASE_URL=", "NATS_URL=",
		"POSTGRES_PASSWORD=", "NATS_SERVICE_PASSWORD=", "PATH=",
	} {
		assert.NotContains(t, joined, forbidden)
	}
	assert.Contains(t, joined, "S3_ENDPOINT=https://storage.example")
	assert.Contains(t, joined, "S3_ACCESS_KEY=shared-data-plane-key")
	assert.Contains(t, joined, "WORKER_DB_MAX_OPEN_CONNS=4")
}
