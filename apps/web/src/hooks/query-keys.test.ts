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
