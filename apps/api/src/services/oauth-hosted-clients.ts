/**
 * Client metadata documents this server hosts on a client's behalf.
 *
 * CIMD assumes the client publishes its own document, which ChatGPT and Claude
 * do. Grok does not: its connector asks the user to type a client_id and passes
 * whatever they type straight through, so there is nothing to fetch. The MCP
 * spec lists pre-registration alongside CIMD for exactly this case, and other
 * MCP servers handle Grok the same way - by publishing one shared public
 * client_id for users to paste.
 *
 * Hosting the document keeps a single code path: the id is still an https URL,
 * the document is still served and externally verifiable, and authorization
 * still resolves a client with declared redirect URIs. The only difference is
 * that we serve the document rather than the vendor.
 *
 * A hosted entry vouches only for redirecting to that vendor's callback. It
 * grants nothing on its own - every authorization still passes the consent
 * screen, where the user picks a workspace and approves.
 */

export interface HostedClientDefinition {
  /** Path segment under /api/oauth/clients, and the file users paste. */
  slug: string;
  clientName: string;
  redirectUris: string[];
}

export const HOSTED_CLIENTS: readonly HostedClientDefinition[] = [
  {
    slug: "grok",
    clientName: "Grok",
    // Grok sends the trailing-slash form. Its own server redirects that to the
    // bare path, but OAuth compares redirect_uri as an exact string, so both
    // are declared rather than guessing which one arrives.
    redirectUris: [
      "https://grok.com/connectors-oauth-exchange-code/",
      "https://grok.com/connectors-oauth-exchange-code",
    ],
  },
];

/** The client_id a user pastes into the vendor's connector settings. */
export function hostedClientId(issuer: string, slug: string): string {
  return `${issuer}/api/oauth/clients/${slug}.json`;
}

export function findHostedClient(
  issuer: string,
  clientId: string,
): HostedClientDefinition | null {
  return (
    HOSTED_CLIENTS.find(
      (client) => hostedClientId(issuer, client.slug) === clientId,
    ) ?? null
  );
}
