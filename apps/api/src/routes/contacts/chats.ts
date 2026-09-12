import { Hono } from "hono";
import { successData } from "../../lib/response.js";
import { getRouteContext } from "../../middleware/context.js";
import {
  hasContactVisibility,
  requireContactVisibility,
} from "../../middleware/resource-visibility.js";
import { listCustomerChats } from "../../services/customer-chats.service.js";

export const customerChatsRoutes = new Hono();

/**
 * GET /contacts/:id/chats - every thread this customer can be reached on.
 *
 * Mounted ahead of the contact-visibility middleware like the other contact
 * sub-routes, so it carries its own gate, and it gates twice: once on the
 * requested contact, and again on every thread it is about to name. A
 * restricted member assigned to one of a merged customer's threads must not
 * learn about the others through the switcher.
 */
customerChatsRoutes.get(
  "/:id/chats",
  requireContactVisibility(),
  async (c) => {
    const { tenantDb, permissions } = getRouteContext(c);
    const chats = await listCustomerChats(tenantDb, c.req.param("id")!);
    const visible = await Promise.all(
      chats.map(async (chat) => {
        // A neutral thread with no contact row has no assignment to check
        // against, so it is shown only to a role that may see every chat
        // rather than being treated as unrestricted.
        const allowed =
          chat.contactId === null
            ? permissions.can_view_all_chats
            : await hasContactVisibility(c, chat.contactId);
        return allowed ? chat : null;
      }),
    );
    return successData(c, { chats: visible.filter((chat) => chat !== null) });
  },
);
