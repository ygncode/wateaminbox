import { useCallback, useEffect, useRef } from "react";

export type SwipeDirection = "left" | "right" | "up" | "down";

export interface SwipeGestureOptions {
  /**
   * Minimum distance in pixels for a swipe to be recognized
   * @default 50
   */
  threshold?: number;

  /**
   * Maximum time in milliseconds for a swipe gesture
   * @default 500
   */
  timeout?: number;

  /**
   * Prevent default touch behavior
   * @default false
   */
  preventDefault?: boolean;

  /**
   * Callback when swipe left is detected
   */
  onSwipeLeft?: () => void;

  /**
   * Callback when swipe right is detected
   */
  onSwipeRight?: () => void;

  /**
   * Callback when swipe up is detected
   */
  onSwipeUp?: () => void;

  /**
   * Callback when swipe down is detected
   */
  onSwipeDown?: () => void;

  /**
   * Generic callback for any swipe direction
   */
  onSwipe?: (direction: SwipeDirection) => void;

  /**
   * Callback when swiping starts
   */
  onSwipeStart?: (x: number, y: number) => void;

  /**
   * Callback during swipe movement
   */
  onSwipeMove?: (deltaX: number, deltaY: number) => void;

  /**
   * Callback when swipe ends (regardless of direction)
   */
  onSwipeEnd?: () => void;

  /**
   * Whether the hook is enabled
   * @default true
   */
  enabled?: boolean;
}

export interface SwipeState {
  isSwiping: boolean;
  direction: SwipeDirection | null;
  deltaX: number;
  deltaY: number;
}

interface TouchPoint {
  x: number;
  y: number;
  time: number;
}

/**
 * Hook to detect swipe gestures on touch devices
 * @param ref - React ref to the element to attach gesture handlers
 * @param options - Configuration options for swipe detection
 */
export function useSwipeGesture<T extends HTMLElement>(
  ref: React.RefObject<T>,
  options: SwipeGestureOptions = {},
) {
  const {
    threshold = 50,
    timeout = 500,
    preventDefault = false,
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    onSwipe,
    onSwipeStart,
    onSwipeMove,
    onSwipeEnd,
    enabled = true,
  } = options;

  const touchStartRef = useRef<TouchPoint | null>(null);
  const isTouchActiveRef = useRef(false);

  const handleTouchStart = useCallback(
    (event: TouchEvent) => {
      if (!enabled) return;

      const touch = event.touches[0];
      if (!touch) return;

      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
      isTouchActiveRef.current = true;

      onSwipeStart?.(touch.clientX, touch.clientY);

      if (preventDefault) {
        event.preventDefault();
      }
    },
    [enabled, onSwipeStart, preventDefault],
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      if (!enabled || !isTouchActiveRef.current || !touchStartRef.current)
        return;

      const touch = event.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;

      onSwipeMove?.(deltaX, deltaY);

      if (preventDefault) {
        event.preventDefault();
      }
    },
    [enabled, onSwipeMove, preventDefault],
  );

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      if (!enabled || !touchStartRef.current) return;

      const touchStart = touchStartRef.current;
      const touchEnd = event.changedTouches[0];

      if (!touchEnd) {
        touchStartRef.current = null;
        isTouchActiveRef.current = false;
        onSwipeEnd?.();
        return;
      }

      const deltaX = touchEnd.clientX - touchStart.x;
      const deltaY = touchEnd.clientY - touchStart.y;
      const deltaTime = Date.now() - touchStart.time;

      // Check if swipe completed within timeout
      if (deltaTime <= timeout) {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        // Determine swipe direction
        if (absX > absY && absX >= threshold) {
          // Horizontal swipe
          const direction: SwipeDirection = deltaX > 0 ? "right" : "left";
          onSwipe?.(direction);

          if (direction === "left") {
            onSwipeLeft?.();
          } else {
            onSwipeRight?.();
          }
        } else if (absY > absX && absY >= threshold) {
          // Vertical swipe
          const direction: SwipeDirection = deltaY > 0 ? "down" : "up";
          onSwipe?.(direction);

          if (direction === "up") {
            onSwipeUp?.();
          } else {
            onSwipeDown?.();
          }
        }
      }

      touchStartRef.current = null;
      isTouchActiveRef.current = false;
      onSwipeEnd?.();
    },
    [
      enabled,
      threshold,
      timeout,
      onSwipe,
      onSwipeLeft,
      onSwipeRight,
      onSwipeUp,
      onSwipeDown,
      onSwipeEnd,
    ],
  );

  const handleTouchCancel = useCallback(() => {
    touchStartRef.current = null;
    isTouchActiveRef.current = false;
    onSwipeEnd?.();
  }, [onSwipeEnd]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    element.addEventListener("touchstart", handleTouchStart, {
      passive: !preventDefault,
    });
    element.addEventListener("touchmove", handleTouchMove, {
      passive: !preventDefault,
    });
    element.addEventListener("touchend", handleTouchEnd, { passive: true });
    element.addEventListener("touchcancel", handleTouchCancel, {
      passive: true,
    });

    return () => {
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [
    ref,
    enabled,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    preventDefault,
  ]);
}

/**
 * Hook that returns a callback ref for swipe gesture detection
 * Use this when you need to attach the gesture to a component without an existing ref
 */
export function useSwipeGestureCallback(options: SwipeGestureOptions = {}) {
  const {
    threshold = 50,
    timeout = 500,
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    onSwipe,
    enabled = true,
  } = options;

  const touchStartRef = useRef<TouchPoint | null>(null);

  const handlers = {
    onTouchStart: useCallback(
      (event: React.TouchEvent) => {
        if (!enabled) return;

        const touch = event.touches[0];
        if (!touch) return;

        touchStartRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          time: Date.now(),
        };
      },
      [enabled],
    ),

    onTouchEnd: useCallback(
      (event: React.TouchEvent) => {
        if (!enabled || !touchStartRef.current) return;

        const touchStart = touchStartRef.current;
        const touchEnd = event.changedTouches[0];

        if (!touchEnd) {
          touchStartRef.current = null;
          return;
        }

        const deltaX = touchEnd.clientX - touchStart.x;
        const deltaY = touchEnd.clientY - touchStart.y;
        const deltaTime = Date.now() - touchStart.time;

        if (deltaTime <= timeout) {
          const absX = Math.abs(deltaX);
          const absY = Math.abs(deltaY);

          if (absX > absY && absX >= threshold) {
            const direction: SwipeDirection = deltaX > 0 ? "right" : "left";
            onSwipe?.(direction);

            if (direction === "left") {
              onSwipeLeft?.();
            } else {
              onSwipeRight?.();
            }
          } else if (absY > absX && absY >= threshold) {
            const direction: SwipeDirection = deltaY > 0 ? "down" : "up";
            onSwipe?.(direction);

            if (direction === "up") {
              onSwipeUp?.();
            } else {
              onSwipeDown?.();
            }
          }
        }

        touchStartRef.current = null;
      },
      [
        enabled,
        threshold,
        timeout,
        onSwipe,
        onSwipeLeft,
        onSwipeRight,
        onSwipeUp,
        onSwipeDown,
      ],
    ),
  };

  return handlers;
}

/**
 * Hook to track swipe progress for animated transitions
 */
export function useSwipeProgress<T extends HTMLElement>(
  ref: React.RefObject<T>,
  options: {
    direction?: "horizontal" | "vertical";
    maxDistance?: number;
    onProgressChange?: (progress: number) => void;
    onSwipeComplete?: (direction: SwipeDirection) => void;
    threshold?: number;
    enabled?: boolean;
  } = {},
) {
  const {
    direction = "horizontal",
    maxDistance = 200,
    onProgressChange,
    onSwipeComplete,
    threshold = 0.5,
    enabled = true,
  } = options;

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!touchStartRef.current) return;

      const touch = event.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;

      const delta = direction === "horizontal" ? deltaX : deltaY;
      const progress = Math.min(Math.abs(delta) / maxDistance, 1);
      const signedProgress = delta > 0 ? progress : -progress;

      onProgressChange?.(signedProgress);
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!touchStartRef.current) return;

      const touch = event.changedTouches[0];
      if (!touch) {
        touchStartRef.current = null;
        onProgressChange?.(0);
        return;
      }

      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;

      const delta = direction === "horizontal" ? deltaX : deltaY;
      const progress = Math.abs(delta) / maxDistance;

      if (progress >= threshold) {
        if (direction === "horizontal") {
          onSwipeComplete?.(delta > 0 ? "right" : "left");
        } else {
          onSwipeComplete?.(delta > 0 ? "down" : "up");
        }
      }

      touchStartRef.current = null;
      onProgressChange?.(0);
    };

    const handleTouchCancel = () => {
      touchStartRef.current = null;
      onProgressChange?.(0);
    };

    element.addEventListener("touchstart", handleTouchStart, { passive: true });
    element.addEventListener("touchmove", handleTouchMove, { passive: true });
    element.addEventListener("touchend", handleTouchEnd, { passive: true });
    element.addEventListener("touchcancel", handleTouchCancel, {
      passive: true,
    });

    return () => {
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [
    ref,
    enabled,
    direction,
    maxDistance,
    threshold,
    onProgressChange,
    onSwipeComplete,
  ]);
}
