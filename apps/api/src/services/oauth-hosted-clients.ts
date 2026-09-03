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

/**
 * Clients that publish a document we cannot fetch.
 *
 * CIMD requires this server to fetch the client's document. Grok publishes a
 * valid one at https://grok.com/oauth/mcp-client.json, but grok.com sits behind
 * a Cloudflare bot challenge that answers 403 "Just a moment..." to every
 * request from the production host - consistently, on every edge address, with
 * or without a User-Agent. The same URL returns 200 from a residential
 * connection, so this is not a mistake in the document or in the fetch; the
 * document is simply not reachable server-to-server from a datacenter IP.
 *
 * Pre-registering it is the MCP spec's other option, and is what the entry
 * below records: the document's contents, verified by fetching it from a
 * network Cloudflare does not challenge.
 *
 * The cost is that a rotation on Grok's side does not reach us. That is the
 * accepted trade for a client whose document we can never fetch, and it fails
 * safe: a redirect_uri Grok adds later is refused until this list catches up,
 * rather than a stale one being honoured beyond its life. Vouching for these
 * URIs grants nothing on its own - every authorization still passes the consent
 * screen, where the user picks a workspace and approves.
 */
export const PRE_REGISTERED_CLIENTS: readonly PreRegisteredClient[] = [
  {
    clientId: "https://grok.com/oauth/mcp-client.json",
    clientName: "Grok",
    // Both slash forms, as with the hosted entry: redirect_uri is compared as
    // an exact string and Grok sends the trailing-slash form.
    redirectUris: [
      "https://grok.com/connectors-oauth-exchange-code/",
      "https://grok.com/connectors-oauth-exchange-code",
      "https://console.x.ai/connectors-oauth-exchange-code/",
      "https://console.x.ai/connectors-oauth-exchange-code",
    ],
  },
];

export interface PreRegisteredClient {
  /** The vendor's own client_id, which is also its document URL. */
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

/**
 * A pre-registered client, matched on its exact client_id.
 *
 * Checked before any fetch, so a client listed here never depends on the
 * network - which is the entire reason the list exists.
 */
export function findPreRegisteredClient(
  clientId: string,
): PreRegisteredClient | null {
  return (
    PRE_REGISTERED_CLIENTS.find((client) => client.clientId === clientId) ??
    null
  );
}

/** The client_id a user pastes into the vendor's connector settings. */
export function hostedClientId(issuer: string, slug: string): string {
  return `${issuer}/api/oauth/clients/${slug}.json`;
}

/**
 * Whether this deployment can host client documents at all.
 *
 * A client_id is an https URL by rule - the CIMD fetch path asserts it and
 * oauth_clients enforces it at the column. An http issuer (APP_URL defaults to
 * http://localhost:4444 in development) would mint an http client_id that
 * cannot be stored, so authorization would fail deep inside the insert rather
 * than at the request. Declining here instead lets the caller reject the
 * client_id the same way it rejects any other non-https one.
 *
 * Nothing is lost by declining: a hosted entry exists so a public vendor can
 * redirect back here, and no such vendor will reach an http localhost anyway.
 */
function canHostClients(issuer: string): boolean {
  return issuer.startsWith("https://");
}

export function findHostedClient(
  issuer: string,
  clientId: string,
): HostedClientDefinition | null {
  if (!canHostClients(issuer)) return null;
  return (
    HOSTED_CLIENTS.find(
      (client) => hostedClientId(issuer, client.slug) === clientId,
    ) ?? null
  );
}
