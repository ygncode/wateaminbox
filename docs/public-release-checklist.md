# Public repository release checklist

Use this checklist before changing GitHub visibility. It covers repository exposure, not deployment approval.

- [ ] Review the final commit and every remote ref that will become public; run a local secret scanner across full reachable history and inspect all findings without printing values.
- [ ] Confirm no `.env.production`, `secrets/`, backups, database exports, logs, WhatsApp sessions, customer media, or subscriber exports are tracked.
- [ ] Decide whether historical generated binaries, build reports, screenshots, workstation paths, and commit-author email metadata are acceptable to publish. If not, rewrite history while the repository is private, then rescan a fresh clone.
- [ ] Verify production credentials through provider metadata only (never retrieve or print values), and rotate any credential that was ever committed or copied into an unsafe location.
- [ ] Use GitHub-hosted runners for untrusted pull-request code. Review Actions permissions, fork-approval policy, branch protection/rulesets, required reviews/checks, and dependency update policy.
- [ ] Enable GitHub secret scanning and push protection, then review existing alerts without exposing matched values. Verify Dependabot alerts/security updates and private vulnerability reporting are enabled, and verify the reporting link in `SECURITY.md`.
- [ ] Confirm the MPL-2.0 whatsmeow submodule source and license remain available and review the complete dependency license inventory for the shipped artifacts.
- [ ] Run lint, typecheck, tests, build, vulnerability/race checks, documentation/link checks, and a production Compose configuration validation from a clean checkout with placeholders or isolated test secrets.
- [ ] Create release tags only from the reviewed commit after required checks pass. Protect release tag patterns and use immutable application/worker image tags and recorded digests; never repoint a published release tag.
- [ ] Confirm README and docs do not imply that a managed Cloud product, SLA, or support entitlement ships with this repository.
