import { Outlet, useLocation } from "react-router-dom";
import { NotificationCenter } from "../notifications/NotificationCenter";

/** Shared application shell for company-authenticated routes. */
export function ProtectedAppLayout() {
  const { pathname } = useLocation();
  const isChatRoute = pathname === "/chat" || pathname.startsWith("/chat/");

  return (
    <>
      <Outlet />
      {/* Chat docks the bell in its navigation rail. Standalone pages keep a
          floating fallback so notifications remain available everywhere. */}
      {!isChatRoute && (
        <div className="fixed right-3 top-3 z-40 rounded-full border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-dark-border dark:bg-dark-elevated/95 md:right-5">
          <NotificationCenter />
        </div>
      )}
    </>
  );
}
