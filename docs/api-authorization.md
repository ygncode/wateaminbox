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
| Team and permissions | Company membership | Existing `can_manage_team`, `can_invite`, owner/admin policies |
| WhatsApp connections | Company membership | Create, rename, reconnect, disconnect, archive/unlink, and re-link require connection-management permission; permanent inbox deletion also requires delete-data permission |

Routes which create external side effects must declare an explicit permission or role middleware. `apps/api/src/routes/message-send-policy.test.ts` audits every send surface against the shared send policy.
