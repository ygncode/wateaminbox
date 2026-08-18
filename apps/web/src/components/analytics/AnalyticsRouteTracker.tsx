import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import {
  createNavigationDeduper,
  productAnalytics,
} from "@/lib/product-analytics";

/**
 * Sends one sanitized page view per navigation. The deduper suppresses only
 * StrictMode's duplicate effect run for the same history entry; revisiting a
 * route through a later navigation still produces another page view.
 */
export function AnalyticsRouteTracker() {
  const location = useLocation();
  const shouldTrackRef = useRef(createNavigationDeduper());

  useEffect(() => {
    if (!shouldTrackRef.current(location.key)) return;
    productAnalytics.trackPage(location.pathname);
  }, [location.key, location.pathname]);

  return null;
}
