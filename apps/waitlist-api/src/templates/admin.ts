import type {
  AdminStats,
  AdminSubscriber,
  AdminSubscriberPage,
  AdminSubscriberQuery,
} from "../services/admin";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function documentShell(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
        background: #edf0ea;
        color: #15211f;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100dvh; padding: 24px; background: #edf0ea; }
      main { width: min(100%, 1180px); margin: 0 auto; }
      h1, h2 { font-family: Iowan Old Style, Baskerville, Georgia, serif; font-weight: 700; }
      h1 { margin: 8px 0 10px; font-size: clamp(34px, 6vw, 52px); line-height: .95; letter-spacing: -.035em; }
      h2 { margin: 4px 0 8px; font-size: clamp(25px, 4vw, 34px); line-height: 1; letter-spacing: -.025em; }
      p { color: #52615b; line-height: 1.6; }
      a { color: #1d633d; }
      a:hover { color: #144b2d; }
      .eyebrow { color: #2b7147; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .panel { border: 1px solid #bdc9bd; background: #fffef9; box-shadow: 6px 6px 0 #d4ddd1; }
      .login { width: min(100%, 440px); margin: 12vh auto 0; padding: 28px; }
      label { display: block; margin: 24px 0 8px; color: #263a32; font-size: 13px; font-weight: 700; }
      input, select { width: 100%; min-height: 44px; border: 1px solid #8fa194; border-radius: 0; background: #fffef9; padding: 10px 12px; color: #15211f; font: inherit; }
      input:focus, select:focus, button:focus-visible, a:focus-visible { outline: 3px solid #a7d3a9; outline-offset: 2px; border-color: #27633e; }
      button { min-height: 44px; border: 0; border-radius: 0; background: #1d633d; color: #fff; cursor: pointer; font: inherit; font-weight: 700; padding: 11px 18px; }
      button:hover { background: #144b2d; }
      .notice { border-left: 3px solid #a44924; background: #fdf0e9; color: #71351d; margin-top: 20px; padding: 10px 12px; font-size: 13px; }
      .topline { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin: 8px 0 28px; }
      .topline form { margin: 0; }
      .topline button { min-height: 0; background: transparent; border: 1px solid #779080; color: #234834; padding: 9px 12px; }
      .topline button:hover { background: #e5ece2; }
      .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
      .metric { min-height: 148px; padding: 20px; }
      .metric strong { display: block; margin-top: 18px; color: #15211f; font-family: Iowan Old Style, Baskerville, Georgia, serif; font-size: 42px; font-variant-numeric: tabular-nums; line-height: 1; }
      .metric span { color: #587068; font-size: 12px; line-height: 1.45; }
      .subscribers { margin-top: 32px; }
      .subscriber-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding: 24px 24px 18px; }
      .subscriber-header p { margin: 0; }
      .record-total { flex: 0 0 auto; margin-top: 2px !important; color: #234834 !important; font-size: 13px; font-weight: 700; text-align: right; }
      .filter-form { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(160px, .42fr) auto auto; align-items: end; gap: 12px; border-top: 1px solid #dce4da; border-bottom: 1px solid #dce4da; padding: 16px 24px; background: #f7f9f4; }
      .filter-form label { margin: 0 0 7px; }
      .filter-form button { white-space: nowrap; }
      .clear-filters { align-self: center; color: #52615b; font-size: 13px; white-space: nowrap; }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; min-width: 760px; border-collapse: collapse; font-size: 13px; }
      caption { text-align: left; }
      th, td { padding: 14px 24px; border-bottom: 1px solid #e1e7df; text-align: left; vertical-align: middle; }
      thead th { background: #f1f5ef; color: #466056; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
      tbody tr:hover { background: #fbfcf8; }
      tbody tr:last-child td { border-bottom: 0; }
      .email { max-width: 380px; overflow-wrap: anywhere; color: #15211f; font-weight: 700; }
      .status { display: inline-block; min-width: 88px; border: 1px solid; padding: 4px 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-align: center; text-transform: uppercase; }
      .status-confirmed { border-color: #86b18d; background: #ebf5e8; color: #25613c; }
      .status-pending { border-color: #d5ad62; background: #fff6dc; color: #7a5318; }
      time, .missing { color: #52615b; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .missing { color: #7a8780; }
      .empty { padding: 34px 24px; color: #52615b; text-align: center; }
      .pagination { display: flex; justify-content: space-between; align-items: center; gap: 16px; border-top: 1px solid #dce4da; padding: 15px 24px; color: #52615b; font-size: 12px; }
      .pagination-links { display: flex; gap: 14px; }
      .privacy-note { margin: 14px 0 0; color: #52615b; font-size: 12px; }
      .footnote { margin-top: 22px; font-size: 12px; }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
      @media (max-width: 820px) {
        body { padding: 16px; }
        .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .filter-form { grid-template-columns: 1fr 1fr; }
        .clear-filters { align-self: end; min-height: 44px; display: flex; align-items: center; }
      }
      @media (max-width: 560px) {
        .grid { grid-template-columns: 1fr; }
        .topline, .subscriber-header { flex-direction: column; }
        .subscriber-header { gap: 8px; padding: 20px 18px 16px; }
        .record-total { text-align: left; }
        .filter-form { grid-template-columns: 1fr; padding: 16px 18px; }
        .filter-form button { width: 100%; }
        .clear-filters { align-self: start; min-height: 0; }
        th, td { padding: 13px 18px; }
        .pagination { align-items: flex-start; flex-direction: column; padding: 15px 18px; }
      }
    </style>
  </head>
  <body><main>${content}</main></body>
</html>`;
}

export function renderLoginPage(csrf: string, error?: string): string {
  return documentShell(
    "WATeamInbox Cloud — Admin",
    `<section class="panel login">
      <div class="eyebrow">WATeamInbox Cloud / administration</div>
      <h1>Private waitlist operations.</h1>
      <p>Use the separately configured administrator password to review waitlist metrics and subscriber records.</p>
      ${error ? `<div class="notice" role="alert">${escapeHtml(error)}</div>` : ""}
      <form method="post" action="/admin/login">
        <input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />
        <label for="password">Administrator password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
        <p><button type="submit">Open dashboard</button></p>
      </form>
    </section>`,
  );
}

function metric(label: string, value: string, detail: string): string {
  return `<section class="panel metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></section>`;
}

function dashboardUrl(query: AdminSubscriberQuery, page: number): string {
  const parameters = new URLSearchParams();
  if (query.search) {
    parameters.set("q", query.search);
  }
  if (query.status !== "all") {
    parameters.set("status", query.status);
  }
  if (page > 1) {
    parameters.set("page", String(page));
  }

  const search = parameters.toString();
  return search ? `/admin?${search}` : "/admin";
}

function timestamp(value: number | null): string {
  if (value === null || !Number.isSafeInteger(value)) {
    return '<span class="missing">—</span>';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '<span class="missing">—</span>';
  }

  const iso = date.toISOString();
  const label = `${iso.slice(0, 19).replace("T", " ")} UTC`;
  return `<time datetime="${escapeHtml(iso)}">${escapeHtml(label)}</time>`;
}

function status(subscriber: AdminSubscriber): string {
  const confirmed = subscriber.status === "confirmed";
  return `<span class="status ${confirmed ? "status-confirmed" : "status-pending"}">${confirmed ? "Confirmed" : "Pending"}</span>`;
}

function subscriberRows(records: AdminSubscriber[]): string {
  if (records.length === 0) {
    return '<tr><td class="empty" colspan="4">No subscriber records match these filters.</td></tr>';
  }

  return records
    .map(
      (subscriber) => `<tr>
        <td class="email">${escapeHtml(subscriber.email)}</td>
        <td>${status(subscriber)}</td>
        <td>${timestamp(subscriber.createdAt)}</td>
        <td>${timestamp(subscriber.confirmedAt)}</td>
      </tr>`,
    )
    .join("");
}

function rangeLabel(page: AdminSubscriberPage): string {
  if (page.total === 0) {
    return "No matching records";
  }

  const first = (page.page - 1) * page.pageSize + 1;
  const last = Math.min(page.total, first + page.records.length - 1);
  return `Showing ${first}–${last} of ${page.total}`;
}

function pagination(page: AdminSubscriberPage): string {
  if (page.totalPages <= 1) {
    return "";
  }

  return `<nav class="pagination" aria-label="Subscriber pages">
      <span>Page ${page.page} of ${page.totalPages}</span>
      <span class="pagination-links">
        ${page.page > 1 ? `<a href="${escapeHtml(dashboardUrl(page.query, page.page - 1))}" rel="prev">Previous</a>` : ""}
        ${page.page < page.totalPages ? `<a href="${escapeHtml(dashboardUrl(page.query, page.page + 1))}" rel="next">Next</a>` : ""}
      </span>
    </nav>`;
}

export function renderDashboardPage(
  stats: AdminStats,
  subscribers: AdminSubscriberPage,
  csrf: string,
): string {
  const recordCount = `${subscribers.total} record${subscribers.total === 1 ? "" : "s"}`;

  return documentShell(
    "WATeamInbox Cloud — Waitlist dashboard",
    `<div class="topline">
      <div><div class="eyebrow">WATeamInbox Cloud / private dashboard</div><h1>Waitlist signal</h1></div>
      <form method="post" action="/admin/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}" /><button type="submit">Sign out</button></form>
    </div>
    <section class="grid" aria-label="Waitlist metrics">
      ${metric("Total double-opt-in requests", String(stats.total), "All retained waitlist records")}
      ${metric("Confirmed", String(stats.confirmed), `${stats.conversionRate}% confirmation rate`)}
      ${metric("Still pending", String(stats.pending), "May need a confirmation click")}
      ${metric("Confirmed today", String(stats.confirmedToday), "UTC calendar day")}
      ${metric("Confirmation emails / 7 days", String(stats.confirmationEmailsSevenDays), "Includes eligible resend attempts")}
      ${metric("Expired unconfirmed links", String(stats.expiredUnconfirmedTokens), "A fresh signup can issue another link")}
    </section>
    <section class="panel subscribers" aria-labelledby="subscriber-records-title">
      <header class="subscriber-header">
        <div>
          <div class="eyebrow">Subscriber registry</div>
          <h2 id="subscriber-records-title">Waitlist records</h2>
          <p>Review signup and confirmation state without exposing authentication or confirmation credentials.</p>
        </div>
        <p class="record-total">${escapeHtml(rangeLabel(subscribers))}<br />${escapeHtml(recordCount)}</p>
      </header>
      <form class="filter-form" method="get" action="/admin">
        <div>
          <label for="subscriber-search">Find an email address</label>
          <input id="subscriber-search" name="q" type="search" value="${escapeHtml(subscribers.query.search)}" maxlength="254" autocomplete="off" placeholder="Search subscriber email" />
        </div>
        <div>
          <label for="subscriber-status">Status</label>
          <select id="subscriber-status" name="status">
            <option value="all"${subscribers.query.status === "all" ? " selected" : ""}>All statuses</option>
            <option value="pending"${subscribers.query.status === "pending" ? " selected" : ""}>Pending</option>
            <option value="confirmed"${subscribers.query.status === "confirmed" ? " selected" : ""}>Confirmed</option>
          </select>
        </div>
        <button type="submit">Apply filters</button>
        <a class="clear-filters" href="/admin">Clear filters</a>
      </form>
      <div class="table-wrap" tabindex="0">
        <table>
          <caption class="sr-only">Subscriber email addresses, statuses, signup times, and confirmation times</caption>
          <thead><tr><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Signed up</th><th scope="col">Confirmed</th></tr></thead>
          <tbody>${subscriberRows(subscribers.records)}</tbody>
        </table>
      </div>
      ${pagination(subscribers)}
    </section>
    <p class="privacy-note">Subscriber addresses are visible only to an authenticated administrator. Raw confirmation tokens, session tokens, and IP values are never displayed.</p>
    <p class="footnote">All timestamps are UTC. Search and status filters apply to the paginated subscriber list; aggregate metrics remain unfiltered.</p>`,
  );
}
