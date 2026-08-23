module github.com/ygncode-lab/whatsapp-web/services/orchestrator

go 1.25.0

toolchain go1.25.13

require (
	github.com/DATA-DOG/go-sqlmock v1.5.2
	github.com/lib/pq v1.10.9
	github.com/nats-io/nats.go v1.31.0
	github.com/stretchr/testify v1.11.1
	github.com/ygncode-lab/whatsapp-web/services/shared v0.0.0
)

require (
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/klauspost/compress v1.18.7 // indirect
	github.com/nats-io/nkeys v0.4.6 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	golang.org/x/crypto v0.52.0 // indirect
	golang.org/x/sys v0.45.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace github.com/ygncode-lab/whatsapp-web/services/shared => ../shared
