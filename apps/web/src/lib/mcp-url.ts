export function resolveMcpEndpointUrl(
  apiBaseUrl: string,
  origin: string,
): string {
  const normalizedBase = apiBaseUrl.replace(/\/+$/, "");
  return new URL(`${normalizedBase}/mcp`, origin).toString();
}
