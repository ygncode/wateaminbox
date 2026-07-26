# Development utilities

## Reset a WhatsApp test account

`reset-whatsapp-account.sh` removes WhatsApp/imported data for one company while preserving the user login, company, memberships, notification preferences, custom tags, and quick replies.

```bash
./dev-utils/reset-whatsapp-account.sh setkyar16@gmail.com
```

The script asks you to type the email before deleting anything. For automation or a known local test account:

```bash
./dev-utils/reset-whatsapp-account.sh setkyar16@gmail.com --yes
```

If the user belongs to multiple companies, an interactive run presents a numbered workspace picker. Automated `--yes` runs refuse to guess and print a ready-to-run command for each workspace:

```bash
./dev-utils/reset-whatsapp-account.sh user@example.com \
  --company-id 00000000-0000-0000-0000-000000000000 \
  --yes
```

The utility stops active workers through NATS and cleans the tenant database, whatsmeow sessions, worker registry, company-scoped NATS messages, MinIO media, and Meilisearch indexes. A dead in-memory orchestrator reference may remain until the orchestrator restarts; it has no process or persisted state and does not block pairing.

Run `--help` for supported environment overrides and the complete cleanup scope.
