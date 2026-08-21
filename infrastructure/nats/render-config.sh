#!/bin/sh
set -eu

service_file=${NATS_SERVICE_PASSWORD_FILE:-/run/secrets/nats_service_password}
worker_file=${NATS_WORKER_PASSWORD_FILE:-/run/secrets/nats_worker_password}
output=${NATS_CONFIG_OUTPUT:-/tmp/nats.conf}

read_password() {
  label=$1
  file=$2
  [ -r "$file" ] || {
    echo "render-nats-config: missing $label credential file" >&2
    exit 1
  }
  value=$(cat "$file")
  case "$value" in
    ''|*[!A-Za-z0-9_-]*)
      echo "render-nats-config: $label credential must be non-empty URL-safe characters" >&2
      exit 1
      ;;
  esac
  [ "${#value}" -ge 32 ] || {
    echo "render-nats-config: $label credential must be at least 32 characters" >&2
    exit 1
  }
  printf '%s' "$value"
}

service_password=$(read_password service "$service_file")
worker_password=$(read_password worker "$worker_file")
[ "$service_password" != "$worker_password" ] || {
  echo "render-nats-config: service and worker credentials must differ" >&2
  exit 1
}

umask 077
cat >"$output" <<EOF
jetstream { store_dir: "/data" }
http: 8222
authorization {
  users: [
    {
      user: "service"
      password: "$service_password"
      permissions: { publish: ">"; subscribe: ">" }
    }
    {
      user: "worker"
      password: "$worker_password"
      permissions: {
        publish: {
          allow: [
            "WHATSAPP.events.>",
            "WHATSAPP.workers.>",
            "\$JS.API.STREAM.INFO.WHATSAPP_COMMANDS",
            "\$JS.API.STREAM.INFO.WHATSAPP_DOWNLOADS",
            "\$JS.API.CONSUMER.INFO.WHATSAPP_COMMANDS.*",
            "\$JS.API.CONSUMER.CREATE.WHATSAPP_COMMANDS.>",
            "\$JS.API.CONSUMER.MSG.NEXT.WHATSAPP_COMMANDS.*",
            "\$JS.API.CONSUMER.CREATE.WHATSAPP_DOWNLOADS.>",
            "\$JS.API.CONSUMER.DELETE.WHATSAPP_DOWNLOADS.*",
            "\$JS.ACK.WHATSAPP_COMMANDS.>",
            "\$JS.ACK.WHATSAPP_DOWNLOADS.>"
          ]
          deny: [
            "WHATSAPP.commands", "WHATSAPP.commands.>",
            "WHATSAPP.control", "WHATSAPP.control.>",
            "WHATSAPP.lifecycle", "WHATSAPP.lifecycle.>",
            "WHATSAPP.rollouts", "WHATSAPP.rollouts.>",
            "\$JS.API.STREAM.CREATE.>", "\$JS.API.STREAM.UPDATE.>",
            "\$JS.API.STREAM.DELETE.>", "\$JS.API.STREAM.PURGE.>",
            "\$JS.API.STREAM.SNAPSHOT.>", "\$JS.API.STREAM.RESTORE.>",
            "\$JS.API.ACCOUNT.>", "\$JS.API.SERVER.>"
          ]
        }
        subscribe: {
          allow: ["_INBOX.>", "WHATSAPP.commands.>", "WHATSAPP.download.>"]
          deny: [
            "WHATSAPP.workers.>", "WHATSAPP.events.>",
            "WHATSAPP.control.>", "WHATSAPP.lifecycle.>", "WHATSAPP.rollouts.>"
          ]
        }
      }
    }
  ]
}
EOF
chmod 0600 "$output"
service_password=
worker_password=
