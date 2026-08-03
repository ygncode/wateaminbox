export function buildBillingUrl(
  baseUrl: string | undefined,
  companyId: string,
  options: { onboarding?: boolean; origin?: string } = {},
): string | null {
  const configured = baseUrl?.trim();
  if (!configured) return null;

  const origin = options.origin ?? window.location.origin;
  const url = new URL(configured, origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    return null;
  }

  url.searchParams.set("companyId", companyId);
  if (options.onboarding) url.searchParams.set("mode", "onboarding");

  return url.origin === origin
    ? `${url.pathname}${url.search}${url.hash}`
    : url.toString();
}

export function getWorkspaceBillingUrl(
  companyId: string,
  options: { onboarding?: boolean } = {},
): string | null {
  return buildBillingUrl(import.meta.env.VITE_BILLING_URL, companyId, options);
}

export function isBillingRequiredAfterSetup(): boolean {
  return import.meta.env.VITE_BILLING_REQUIRED_AFTER_SETUP === "true";
}
