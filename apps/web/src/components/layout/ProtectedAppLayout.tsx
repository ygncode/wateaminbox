import { Outlet } from "react-router-dom";
import { NotificationCenter } from "../notifications/NotificationCenter";

/** One notification trigger shared by every company-authenticated route. */
export function ProtectedAppLayout() {
  return (
    <>
      <Outlet />
      <div className="fixed right-3 top-3 z-40 rounded-full border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-dark-border dark:bg-dark-elevated/95 md:right-5">
        <NotificationCenter />
      </div>
    </>
  );
}
