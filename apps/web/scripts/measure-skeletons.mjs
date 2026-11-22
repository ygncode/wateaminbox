#!/usr/bin/env node
/*
 * Skeleton audit: measures every loading skeleton against the loaded UI it
 * stands in for (see DESIGN.md → Loading skeletons).
 *
 * For each route and viewport it records the boxes of `[data-sk]` landmarks
 * in three states and fails when a skeleton box is more than TOLERANCE px off:
 *   loaded  - real data (empty lists are filled from fixtures below)
 *   shell   - cold load: the session refresh is held, guards paint
 *             PageSkeleton withShell
 *   data    - session loaded, page data requests held (in-page skeletons)
 *
 * Needs a running web + API and a signed-in-able account:
 *   SK_BASE=http://localhost:4460 SK_EMAIL=… SK_PASSWORD=… \
 *   SK_THEME=whatsapp SK_OUT=../../tmp/skeleton/run \
 *   node scripts/measure-skeletons.mjs
 * Playwright is not a project dependency: set PLAYWRIGHT to its index.mjs, or
 * run where `playwright` resolves. Screenshots are written to SK_OUT.
 */
import fs from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const base = process.env.SK_BASE ?? "http://localhost:4460";
const theme = process.env.SK_THEME ?? "whatsapp";
const out = process.env.SK_OUT ?? "skeleton-audit";
const EMAIL = process.env.SK_EMAIL;
const PASS = process.env.SK_PASSWORD;
const tol = Number(process.env.SK_TOLERANCE ?? 3);
if (!EMAIL || !PASS) {
  console.error(
    "Set SK_EMAIL and SK_PASSWORD for an account with a workspace.",
  );
  process.exit(2);
}
fs.mkdirSync(out.replace(/\/[^/]*$/, "") || ".", { recursive: true });

// Realistic rows for lists the test workspace may have none of.
const now = Date.now();
const iso = (m) => new Date(now - m * 60000).toISOString();
const actor = { id: "u1", name: "Maya Chen", email: "maya@northwind.example" };
const audit = {
  data: Array.from({ length: 20 }, (_, i) => ({
    id: `a${i}`,
    userId: "u1",
    action: [
      "user.login",
      "invitation.sent",
      "contact.updated",
      "conversation.resolved",
    ][i % 4],
    entityType: "contact",
    entityId: `c${i}`,
    details: { name: "Ravi Kumar" },
    ipAddress: "203.0.113.24",
    createdAt: iso(i * 37),
    actor,
  })),
  pagination: { total: 64, limit: 20, offset: 0, hasMore: true },
};
const progress = {
  total: 120,
  pending: 0,
  processing: 0,
  sent: 112,
  failed: 3,
  canceled: 0,
  skipped: 5,
};
const bulkJobs = {
  data: Array.from({ length: 12 }, (_, i) => ({
    id: `b${i}`,
    name: [
      "November promo",
      "Order delay notice",
      "Holiday hours",
      "Feedback survey",
    ][i % 4],
    status: ["completed", "running", "scheduled", "completed_with_errors"][
      i % 4
    ],
    content: "Hi {{name}}, …",
    messageType: "text",
    mediaUrl: null,
    mediaMimeType: null,
    mediaFileName: null,
    audience: { tagIds: ["t1"], contactIds: [] },
    scheduledAt: iso(i * 400),
    totalRecipients: 120,
    progress,
    createdBy: "u1",
    createdByName: "Maya Chen",
    canceledAt: null,
    completedAt: iso(i * 300),
    createdAt: iso(i * 500),
    updatedAt: iso(i * 300),
  })),
  pagination: { total: 12, limit: 20, offset: 0, hasMore: false },
};
const notifications = {
  data: Array.from({ length: 12 }, (_, i) => ({
    id: `n${i}`,
    userId: "u1",
    notificationType: ["message", "mention", "assignment", "team"][i % 4],
    title: [
      "New message from Ravi Kumar",
      "Daniel mentioned you",
      "Ava Chen was assigned to you",
      "Sam joined the team",
    ][i % 4],
    message: "Could you send the tracking link for the second parcel?",
    actionUrl: null,
    metadata: null,
    isRead: i > 2,
    readAt: null,
    createdAt: iso(i * 45),
  })),
  meta: { total: 12, unreadCount: 3, limit: 20, offset: 0 },
};
const fx = { audit, bulkJobs, notifications };

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const collect = (page) =>
  page.evaluate(() => {
    const seen = {};
    for (const el of document.querySelectorAll("[data-sk]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const k = el.dataset.sk;
      (seen[k] ??= []).push({
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
    // Keep the first box plus a count for repeated landmarks.
    // Off-canvas panels (the mobile view stack, closed sheets) are not on
    // screen, so they are not compared.
    const res = {};
    for (const [k, v] of Object.entries(seen)) {
      const onScreen = v.filter((b) => b.x + b.w > 0 && b.x < innerWidth);
      if (onScreen.length) res[k] = { ...onScreen[0], n: onScreen.length };
    }
    return res;
  });

const results = {};
const b = await chromium.launch({ channel: "chrome" });

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript(
    (t) => localStorage.setItem("wateaminbox-theme", t),
    theme,
  );
  const p = await ctx.newPage();
  p.setDefaultTimeout(20000);
  await p.goto(base + "/login");
  await p.fill('input[type="email"]', EMAIL);
  await p.fill('input[type="password"]', PASS);
  await p.keyboard.press("Enter");
  await p.waitForURL((u) => u.pathname.includes("/chat"));
  await p.waitForTimeout(1500);
  const ws = new URL(p.url()).pathname.split("/")[2];

  // Open a conversation to learn its URL.
  await p.locator('[data-sk="list-row"]').first().click();
  await p.waitForTimeout(1500);
  const threadPath = new URL(p.url()).pathname;

  const routes = {
    inbox: `/w/${ws}/chat`,
    thread: threadPath,
    settings: `/w/${ws}/settings`,
    dashboard: `/w/${ws}/dashboard`,
    team: `/w/${ws}/team`,
    notifications: `/w/${ws}/notifications`,
    audit: `/w/${ws}/audit`,
    broadcasts: `/w/${ws}/broadcasts`,
  };

  // Filled lists for the loaded state; GET only, so writes stay real.
  const fill = async (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.fallback();
    if (/^\/api\/audit$/.test(u.pathname))
      return route.fulfill({ json: fx.audit });
    if (/^\/api\/bulk-jobs$/.test(u.pathname))
      return route.fulfill({ json: fx.bulkJobs });
    if (/^\/api\/notifications$/.test(u.pathname))
      return route.fulfill({ json: fx.notifications });
    // Show the full composer: report the thread as open (read-only fixture).
    const st = u.pathname.match(/^\/api\/conversations\/([^/]+)\/state$/);
    if (st) {
      const res = await route.fetch();
      const body = await res.json().catch(() => ({}));
      return route.fulfill({
        response: res,
        json: { ...body, status: "open" },
      });
    }
    return route.fallback();
  };
  for (const [name, path] of Object.entries(routes)) {
    // 1. Loaded.
    await p.route("**/api/**", fill);
    await p.goto(base + path, { waitUntil: "commit" });
    await p.waitForLoadState("networkidle").catch(() => {});
    await p.waitForTimeout(1200);
    const loaded = await collect(p);
    await p.screenshot({ path: `${out}-${vpName}-${name}-loaded.png` });
    await p.unrouteAll({ behavior: "ignoreErrors" });

    // 2. Cold-load shell skeleton: hold the session refresh.
    let release;
    const gate = new Promise((r) => (release = r));
    await p.route("**/api/auth/refresh", async (route) => {
      await gate;
      await route.continue().catch(() => {});
    });
    await p.goto(base + path, { waitUntil: "commit" });
    await p.waitForTimeout(900);
    const shell = await collect(p);
    await p.screenshot({ path: `${out}-${vpName}-${name}-shell.png` });
    release();
    await p.unrouteAll({ behavior: "ignoreErrors" });
    await p.waitForTimeout(800);

    // 3. In-page data skeleton: session loads, page data held.
    let release2;
    const gate2 = new Promise((r) => (release2 = r));
    const held =
      /^\/api\/(inbox|conversations|contacts|dashboard|analytics|members|companies\/[^/]+\/(members|invitations|audit|stats|dashboard|analytics)|notifications|bulk-jobs|audit)/;
    await p.route(
      (u) => held.test(u.pathname),
      async (route) => {
        await gate2;
        await route.continue().catch(() => {});
      },
    );
    await p.goto(base + path, { waitUntil: "commit" });
    await p.waitForTimeout(1500);
    const data = await collect(p);
    await p.screenshot({ path: `${out}-${vpName}-${name}-data.png` });
    release2();
    await p.unrouteAll({ behavior: "ignoreErrors" });
    await p.waitForTimeout(500);

    results[`${vpName}/${name}`] = { loaded, shell, data };
  }
  await ctx.close();
}
await b.close();

let bad = 0;
for (const [state, { loaded, shell, data: dataState }] of Object.entries(
  results,
)) {
  for (const [phase, sk] of [
    ["shell", shell],
    ["data", dataState],
  ]) {
    const lines = [];
    for (const [k, real] of Object.entries(loaded)) {
      const s = sk[k];
      if (!s) {
        lines.push(
          `  ${k.padEnd(14)} MISSING in skeleton (real ${real.w}x${real.h} @${real.x},${real.y})`,
        );
        continue;
      }
      const d = ["x", "y", "w", "h"].map((a) => s[a] - real[a]);
      if (d.some((v) => Math.abs(v) > tol))
        lines.push(
          `  ${k.padEnd(14)} real ${real.w}x${real.h} @${real.x},${real.y}  skel ${s.w}x${s.h} @${s.x},${s.y}  Δ x${d[0]} y${d[1]} w${d[2]} h${d[3]}`,
        );
    }
    for (const k of Object.keys(sk))
      if (!loaded[k]) lines.push(`  ${k.padEnd(14)} only in skeleton`);
    if (lines.length) {
      bad += lines.length;
      console.log(`${state} [${phase}]`);
      console.log(lines.join("\n"));
    }
  }
}
console.log(bad ? `\n${bad} mismatches` : "all landmarks within tolerance");
process.exit(bad ? 1 : 0);
