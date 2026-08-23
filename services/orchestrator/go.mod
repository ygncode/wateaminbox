module github.com/ygncode-lab/whatsapp-web/services/orchestrator

go 1.25.0

require (
	github.com/DATA-DOG/go-sqlmock v1.5.2
	github.com/lib/pq v1.12.3
	github.com/nats-io/nats.go v1.53.1
	github.com/stretchr/testify v1.12.1
	github.com/ygncode-lab/whatsapp-web/services/shared v0.0.0
)

require (
	github.com/klauspost/compress v1.18.5 // indirect
	github.com/nats-io/nkeys v0.4.15 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	go.yaml.in/yaml/v3 v3.0.5 // indirect
	golang.org/x/crypto v0.49.0 // indirect
	golang.org/x/sys v0.42.0 // indirect
)

replace github.com/ygncode-lab/whatsapp-web/services/shared => ../shared
