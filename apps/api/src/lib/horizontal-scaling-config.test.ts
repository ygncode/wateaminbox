import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../../..");
const compose = readFileSync(join(repoRoot, "compose.production.yml"), "utf8");
const caddy = readFileSync(
  join(repoRoot, "infrastructure/production/Caddyfile"),
  "utf8",
);
const haproxy = readFileSync(
  join(repoRoot, "infrastructure/production/haproxy-api.cfg"),
  "utf8",
);
const appSource = readFileSync(join(repoRoot, "apps/api/src/app.ts"), "utf8");

describe("production API horizontal-scaling contract", () => {
  test("uses a shared limiter, bounded per-replica pools, and safe membership reads", () => {
    expect(compose).toContain("replicas: ${API_REPLICA_COUNT:-1}");
    expect(compose).toContain(
      "RATE_LIMIT_STORE_TYPE: ${RATE_LIMIT_STORE_TYPE:-postgres}",
    );
    expect(compose).toContain("PUBLIC_DB_POOL_MAX: ${PUBLIC_DB_POOL_MAX:-5}");
    expect(compose).toContain("TENANT_DB_POOL_MAX: ${TENANT_DB_POOL_MAX:-10}");
    expect(compose).toContain(
      "REALTIME_MEMBERSHIP_CACHE_TTL_MS: ${REALTIME_MEMBERSHIP_CACHE_TTL_MS:-0}",
    );
  });

  test("routes through a readiness-aware Docker-DNS load balancer", () => {
    expect(caddy).toContain("reverse_proxy api-router:4451");
    expect(caddy).not.toContain("reverse_proxy api:4445");
    expect(haproxy).toContain("server-template api 1-10 api:4445");
    expect(haproxy).toContain("http-check send meth GET uri /api/health/ready");
    expect(haproxy).toContain("nameserver docker 127.0.0.11:53");
    expect(compose).toContain(
      "TRUSTED_PROXY_IPS: ${API_ROUTER_IP:-10.254.0.254}",
    );
    expect(compose).toContain("/api/health/ready').then");
    expect(caddy).toContain("header_up X-Forwarded-For {client_ip}");
    expect(caddy).toContain("trusted_proxies_strict");
  });

  test("keeps only the health namespace outside the PostgreSQL limiter", () => {
    expect(appSource).toContain('path === "/api/health"');
    expect(appSource).toContain('path.startsWith("/api/health/")');
    expect(appSource).not.toContain('path.startsWith("/api/health")');
  });
});
