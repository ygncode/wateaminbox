# Security Policy

WATeamInbox is currently a beta. Only the latest code on the default branch is actively considered for security fixes; older commits and unreleased snapshots do not have a separate support window.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/ygncode/wateaminbox/security/advisories/new). Do not open a public issue or include secrets, WhatsApp session material, message content, phone numbers, or other personal data in a report.

Include, when possible:

- affected component and version or commit;
- reproduction steps or a minimal proof of concept;
- potential impact and prerequisites;
- suggested mitigation, if known.

Maintainers will acknowledge and assess reports as capacity permits. Because this is a community beta, no response or remediation deadline is guaranteed. Please allow time for a fix before public disclosure.

For ordinary bugs, configuration questions, and feature requests, use [GitHub Issues](https://github.com/ygncode/wateaminbox/issues).

## Deployment responsibility

The development defaults are not a hardened production configuration. Self-hosters are responsible for TLS, secret management, access controls, dependency updates, backups, monitoring, data retention, and compliance obligations applicable to their deployment. See the production caveat in [README.md](README.md).
