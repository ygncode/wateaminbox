import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { clearCompanyId, setCompanyId } from "../lib/api/client";
import { queryKeys } from "./query-keys";
import { infiniteMessageKeys } from "./useInfiniteMessages";

describe("tenant query keys", () => {
  test("company switches cannot read prior-company server state", () => {
    const client = new QueryClient();
    setCompanyId("company-a");
    const companyAContacts = queryKeys.contacts.lists();
    const companyAMessages = infiniteMessageKeys.list("conversation-1");
    client.setQueryData(companyAContacts, ["A contact"]);
    client.setQueryData(companyAMessages, ["A message"]);

    setCompanyId("company-b");
    const companyBContacts = queryKeys.contacts.lists();
    const companyBMessages = infiniteMessageKeys.list("conversation-1");

    expect(companyBContacts).not.toEqual(companyAContacts);
    expect(companyBMessages).not.toEqual(companyAMessages);
    expect(client.getQueryData(companyBContacts)).toBeUndefined();
    expect(client.getQueryData(companyBMessages)).toBeUndefined();
    clearCompanyId();
  });
});

describe("response-time analytics query keys", () => {
  test("invalidating the date-less key invalidates every cached date-range variant", async () => {
    const client = new QueryClient();
    const companyId = "company-a";
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-31T00:00:00Z");

    const statsKey = queryKeys.analytics.responseTimeStats(
      companyId,
      start,
      end,
    );
    const trendKey = queryKeys.analytics.responseTimeTrend(
      companyId,
      start,
      end,
    );
    client.setQueryData(statsKey, { totalConversations: 5 });
    client.setQueryData(trendKey, { trend: [] });

    // The prefix key returned when no dates are passed - this is exactly
    // what useCreateSlaPolicy invalidates after an SLA policy edit.
    await client.invalidateQueries({
      queryKey: queryKeys.analytics.responseTimeStats(companyId),
    });

    expect(client.getQueryState(statsKey)?.isInvalidated).toBe(true);
    // A different family (trend) sharing only the companyId prefix, not the
    // "response-time-stats" segment, must be unaffected.
    expect(client.getQueryState(trendKey)?.isInvalidated).toBeFalsy();
  });

  test("date-less and dated keys have different shapes (prefix vs. specific)", () => {
    const companyId = "company-a";
    const withDates = queryKeys.analytics.slaBreaches(
      companyId,
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-01-31T00:00:00Z"),
    );
    const withoutDates = queryKeys.analytics.slaBreaches(companyId);
    expect(withDates.length).toBe(5);
    expect(withoutDates.length).toBe(3);
  });
});
