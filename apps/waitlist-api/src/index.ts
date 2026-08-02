import { app } from "./app";
import { pruneExpired } from "./services/waitlist";
import type { Env } from "./types";

export default {
  fetch(request, env, context) {
    return app.fetch(request, env, context);
  },
  scheduled(_controller, env, context) {
    context.waitUntil(pruneExpired(env));
  },
} satisfies ExportedHandler<Env>;
