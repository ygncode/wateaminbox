import { useState, useEffect, useCallback } from "react";

/**
 * Generic media query hook that listens for changes in a CSS media query
 * @param query - CSS media query string (e.g., "(max-width: 768px)")
 * @returns boolean indicating if the media query matches
 */
export function useMediaQuery(query: string): boolean {
  const getMatches = useCallback((query: string): boolean => {
    // Prevent SSR issues
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(query).matches;
  }, []);

  const [matches, setMatches] = useState<boolean>(() => getMatches(query));

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);

    // Update state on initial mount
    setMatches(mediaQueryList.matches);

    // Event listener callback
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    // Modern browsers
    if (mediaQueryList.addEventListener) {
      mediaQueryList.addEventListener("change", handleChange);
    } else {
      // Fallback for older browsers
      mediaQueryList.addListener(handleChange);
    }

    return () => {
      if (mediaQueryList.removeEventListener) {
        mediaQueryList.removeEventListener("change", handleChange);
      } else {
        // Fallback for older browsers
        mediaQueryList.removeListener(handleChange);
      }
    };
  }, [query]);

  return matches;
}

/**
 * Hook to detect mobile devices (screens < 768px)
 * Matches Tailwind's md: breakpoint
 * @returns boolean indicating if the current screen is mobile
 */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/**
 * Hook to detect tablet devices (screens < 1024px)
 * Matches Tailwind's lg: breakpoint
 * @returns boolean indicating if the current screen is tablet or smaller
 */
export function useIsTablet(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}

/**
 * Hook to detect small screens (screens < 640px)
 * Matches Tailwind's sm: breakpoint
 * @returns boolean indicating if the current screen is small mobile
 */
export function useIsSmallMobile(): boolean {
  return useMediaQuery("(max-width: 639px)");
}

/**
 * Hook to detect if device supports touch
 * @returns boolean indicating if the device supports touch
 */
export function useIsTouchDevice(): boolean {
  return useMediaQuery("(pointer: coarse)");
}

/**
 * Hook to detect landscape orientation
 * @returns boolean indicating if the device is in landscape orientation
 */
export function useIsLandscape(): boolean {
  return useMediaQuery("(orientation: landscape)");
}

/**
 * Hook to get responsive breakpoint information
 * @returns object with boolean flags for each breakpoint
 */
export function useBreakpoints() {
  const isSmall = useMediaQuery("(max-width: 639px)");
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isTablet = useMediaQuery("(max-width: 1023px)");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isLargeDesktop = useMediaQuery("(min-width: 1280px)");

  return {
    isSmall,
    isMobile,
    isTablet,
    isDesktop,
    isLargeDesktop,
    // Computed convenience values
    isMobileOrTablet: isTablet,
    isTabletOnly: isTablet && !isMobile,
  };
}
