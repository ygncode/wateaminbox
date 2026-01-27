/**
 * Pusher Routes
 *
 * Main router for Pusher-related endpoints.
 */

import { Hono } from "hono";
import { pusherAuthRoutes } from "./auth.js";

export const pusherRoutes = new Hono();

// Mount auth routes
pusherRoutes.route("/", pusherAuthRoutes);

export { pusherAuthRoutes };
