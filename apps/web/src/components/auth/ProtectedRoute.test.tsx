import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The guard's job here is a refusal: when the session could not be verified
 * because the API was unreachable, it must not send the user to the login
 * screen. A refresh cookie survives a deployment, so redirecting discards a
 * session that is still perfectly good - which is what a rolling restart used
 * to do to every connected user.
 */

interface AuthStub {
  isAuthenticated: boolean;
  isLoading: boolean;
  authUnavailable: boolean;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

let auth: AuthStub = {
  isAuthenticated: false,
  isLoading: false,
  authUnavailable: false,
  logout: async () => {},
  refreshSession: async () => {},
};

const navigateTargets: string[] = [];

mock.module("../../contexts/auth-context", () => ({
  useAuth: () => auth,
}));

mock.module("../../contexts/workspace-context", () => ({
  useWorkspace: () => ({
    memberships: [{ companyId: "company-1" }],
    activeWorkspaceId: "company-1",
    isLoading: false,
    error: null,
    refreshWorkspaces: async () => {},
    can: () => true,
    canAny: () => true,
  }),
}));

mock.module("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

mock.module("react-router", () => ({
  Navigate: ({ to }: { to: string }) => {
    navigateTargets.push(to);
    return null;
  },
  useLocation: () => ({ pathname: "/inbox" }),
}));

const { ProtectedRoute } = await import("./ProtectedRoute");

function render(): string {
  navigateTargets.length = 0;
  return renderToStaticMarkup(
    <ProtectedRoute>
      <p>protected content</p>
    </ProtectedRoute>,
  );
}

describe("ProtectedRoute session handling", () => {
  test("offers a retry instead of the login screen when the API is unreachable", () => {
    auth = { ...auth, authUnavailable: true };
    const markup = render();

    expect(navigateTargets).toEqual([]);
    expect(markup).not.toContain("protected content");
    expect(markup).toContain("We couldn’t reach the server");
    expect(markup).toContain("You are still signed in");
  });

  test("still redirects when the session was actually refused", () => {
    auth = { ...auth, authUnavailable: false };
    render();

    expect(navigateTargets).toEqual(["/login"]);
  });

  test("renders the route once the session is confirmed", () => {
    auth = { ...auth, isAuthenticated: true };
    const markup = render();

    expect(navigateTargets).toEqual([]);
    expect(markup).toContain("protected content");
  });
});
