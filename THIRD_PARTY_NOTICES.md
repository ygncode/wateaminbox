# Third-Party Notices

WATeamInbox depends on third-party software distributed under its own license terms. The repository's MIT License applies to WATeamInbox's original content and does not replace third-party licenses.

## whatsmeow

- Project: [whatsmeow](https://github.com/tulir/whatsmeow)
- Go module: `go.mau.fi/whatsmeow`
- License: [Mozilla Public License 2.0 (MPL-2.0)](https://github.com/tulir/whatsmeow/blob/main/LICENSE)
- Used by: `services/whatsapp`

`services/whatsapp/go.mod` selects the whatsmeow module version used by the worker. This repository also tracks upstream whatsmeow as the `vendor/whatsmeow` Git submodule. Those references can point to different upstream commits; consult `go.mod`, `go.sum`, `.gitmodules`, and the Git submodule entry for the exact revisions in a checkout.

whatsmeow source files, including any modifications to MPL-covered files, remain governed by MPL-2.0. The upstream source and license are available from the project link above. Distributors should review and preserve all license and notice obligations for the exact dependency versions they ship.

## Other dependencies

JavaScript and Go manifests and lockfiles list additional direct and transitive dependencies, each under its own terms. This notice highlights whatsmeow because of its MPL-2.0 terms; it is not an exhaustive inventory or a substitute for reviewing dependencies before redistribution.

## Trademarks and affiliation

WATeamInbox is an independent project. It is not affiliated with, endorsed by, or sponsored by WhatsApp or Meta. Names and logos belonging to third parties are used only to identify compatible services or dependencies; all trademarks remain the property of their respective owners.
