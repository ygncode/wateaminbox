# Contributing to WATeamInbox

Thanks for helping improve WATeamInbox. This project is an open-source beta, so focused bug fixes, documentation improvements, tests, and small, reviewable features are especially welcome.

By participating, follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Before you start

- Search existing [issues](https://github.com/ygncode/wateaminbox/issues) before opening a duplicate.
- Open an issue before a substantial feature, architecture change, or breaking change so the approach can be discussed.
- Never include credentials, private messages, phone numbers, session data, or other personal data in issues, fixtures, screenshots, or logs.

## Development workflow

1. Fork the repository and create a focused branch.
2. Follow the setup instructions in [README.md](README.md).
3. Make the smallest coherent change and add or update tests where appropriate.
4. Update documentation when behavior, configuration, or user-visible workflows change.
5. Run the checks relevant to your change. For a general code change, run:

   ```bash
   bun run lint
   bun run typecheck
   bun run test
   bun run build
   ```

   Database, NATS, orchestrator, or WhatsApp-worker changes may also require `bun run test:integration` with the local infrastructure running.

6. Open a pull request explaining the problem, approach, validation, and any operational or security impact.

Do not commit generated build output or `.env` files. If you change a dependency, include the reason and preserve its license and notice requirements. The `vendor/whatsmeow` submodule and Go module dependency remain governed by MPL-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Unless stated otherwise, contributions submitted to this repository are provided under the repository's [MIT License](LICENSE). Submit only work you have the right to contribute.
