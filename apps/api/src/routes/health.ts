import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get("/ready", (c) => {
  // Add readiness checks here (e.g., database connection)
  return c.json({
    status: "ready",
    timestamp: new Date().toISOString(),
  });
});

healthRoutes.get("/live", (c) => {
  return c.json({
    status: "live",
    timestamp: new Date().toISOString(),
  });
});
