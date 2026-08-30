# API authorization matrix

All tenant routes require an active session and company membership before the policies below are evaluated.

| Surface | Read policy | Mutation policy |
| --- | --- | --- |
| Contacts and conversations | `can_view_all_chats`, otherwise active assignment to caller | Assigned contact visibility |
| Messages, reactions, notes, tags | Contact visibility inherited through direct message/contact checks | Contact visibility; sends additionally require `can_send_messages` |
| Message/contact deletion | Contact visibility | `can_delete` |
| Batch message operations | Every message must be visible | Batch delete additionally requires `can_delete` |
| Contact assignment | Target must be a company member | Unassigned self-claim allowed; all other assignment/reassignment requires `can_assign_contacts` |
| Search | Results filtered to active assignments unless `can_view_all_chats` | Reindex requires admin/owner |
| Export | Results filtered to active assignments unless `can_view_all_chats` | `can_export`; full backup also requires `can_view_all_chats` |
| Bulk broadcast jobs (`/bulk-jobs`) | `can_send_bulk_messages` | Preview, create, and cancel additionally require `can_send_messages`; create is also audited as a send surface and rate-limited in its own `messaging.bulk` tier |
| Team and permissions | Company membership | Existing `can_manage_team`, `can_invite`, owner/admin policies |
| WhatsApp connections | Company membership | Create, rename, reconnect, disconnect, archive/unlink, and re-link require connection-management permission; permanent inbox deletion also requires delete-data permission |

Routes which create external side effects must declare an explicit permission or role middleware. `apps/api/src/routes/message-send-policy.test.ts` audits every send surface against the shared send policy.

## MCP endpoint and API tokens

The MCP endpoint (`POST /api/mcp`) authenticates with personal API tokens (`Authorization: Bearer wti_...`) instead of a session JWT. Enforcement layers, in order:

| Layer | Policy |
| --- | --- |
| Token | Must exist by SHA-256 hash, not revoked, not expired. Bound to one (user, workspace); no `X-Company-ID` is read. |
| Membership | The owner's role and permissions are re-resolved on every request (`getMemberWithPermissions`); losing membership disables the token immediately. |
| Scope | Tools are filtered by token scope: `read` tools always listed, `write` tools only for write-scoped tokens. |
| Permission | Each write tool re-checks the owner's live permission (`can_send_messages`, `can_assign_contacts`, `can_send_bulk_messages` for broadcasts, which also require `can_send_messages`). |
| Visibility | Contact/conversation/message tools apply the same assigned-contact visibility rules as the REST routes (`hasContactVisibility`); invisible contacts read as not found. |

Token management (`/api/api-tokens`) uses the normal session auth: members create/list/revoke their own tokens; admins and owners can list and revoke any workspace token.
