import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * Position coordinates
 */
export interface ViewportBoundedPosition {
  x: number;
  y: number;
}

/**
 * Placement direction that may flip if constrained by viewport
 */
export type Placement = "top" | "bottom" | "left" | "right";

/**
 * Options for viewport-bounded position calculation
 */
export interface ViewportBoundedPositionOptions {
  /**
   * Initial position before adjustment
   */
  initialPosition: ViewportBoundedPosition;
  /**
   * Padding from viewport edges
   * @default 10
   */
  viewportPadding?: number;
  /**
   * Element dimensions (required for proper bounds checking)
   */
  elementDimensions?: {
    width: number;
    height: number;
  };
  /**
   * Whether to automatically adjust position when viewport changes
   * @default true
   */
  adjustOnResize?: boolean;
}

/**
 * Result from useViewportBoundedPosition hook
 */
export interface ViewportBoundedPositionResult {
  /**
   * Adjusted position that stays within viewport
   */
  position: ViewportBoundedPosition;
  /**
   * Recalculate position with new dimensions
   */
  recalculate: (dimensions?: { width: number; height: number }) => void;
  /**
   * Set a new initial position and recalculate
   */
  setInitialPosition: (pos: ViewportBoundedPosition) => void;
}

/**
 * Hook to calculate a position that stays within viewport boundaries.
 * Useful for floating elements like emoji pickers, context menus, and popovers.
 *
 * @example
 * ```tsx
 * function EmojiPicker({ triggerPosition, onClose }) {
 *   const pickerRef = useRef<HTMLDivElement>(null);
 *   const { position, recalculate } = useViewportBoundedPosition({
 *     initialPosition: triggerPosition,
 *     viewportPadding: 10,
 *   });
 *
 *   // Recalculate after mounting when we know the element size
 *   useLayoutEffect(() => {
 *     if (pickerRef.current) {
 *       const rect = pickerRef.current.getBoundingClientRect();
 *       recalculate({ width: rect.width, height: rect.height });
 *     }
 *   }, [recalculate]);
 *
 *   return (
 *     <div
 *       ref={pickerRef}
 *       style={{ position: 'fixed', left: position.x, top: position.y }}
 *     >
 *       <EmojiContent />
 *     </div>
 *   );
 * }
 * ```
 */
export function useViewportBoundedPosition({
  initialPosition,
  viewportPadding = 10,
  elementDimensions,
  adjustOnResize = true,
}: ViewportBoundedPositionOptions): ViewportBoundedPositionResult {
  const [position, setPosition] = useState(initialPosition);
  const initialPosRef = useRef(initialPosition);

  const calculateBoundedPosition = useCallback(
    (
      pos: ViewportBoundedPosition,
      dimensions?: { width: number; height: number },
    ): ViewportBoundedPosition => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const elementWidth = dimensions?.width ?? 0;
      const elementHeight = dimensions?.height ?? 0;

      let adjustedX = pos.x;
      let adjustedY = pos.y;

      // Check right boundary
      if (adjustedX + elementWidth > viewportWidth - viewportPadding) {
        adjustedX = viewportWidth - elementWidth - viewportPadding;
      }

      // Check left boundary
      if (adjustedX < viewportPadding) {
        adjustedX = viewportPadding;
      }

      // Check bottom boundary
      if (adjustedY + elementHeight > viewportHeight - viewportPadding) {
        adjustedY = viewportHeight - elementHeight - viewportPadding;
      }

      // Check top boundary
      if (adjustedY < viewportPadding) {
        adjustedY = viewportPadding;
      }

      return { x: adjustedX, y: adjustedY };
    },
    [viewportPadding],
  );

  const recalculate = useCallback(
    (dimensions?: { width: number; height: number }) => {
      const dims = dimensions ?? elementDimensions;
      const boundedPos = calculateBoundedPosition(initialPosRef.current, dims);
      setPosition(boundedPos);
    },
    [calculateBoundedPosition, elementDimensions],
  );

  const setInitialPosition = useCallback(
    (pos: ViewportBoundedPosition) => {
      initialPosRef.current = pos;
      const boundedPos = calculateBoundedPosition(pos, elementDimensions);
      setPosition(boundedPos);
    },
    [calculateBoundedPosition, elementDimensions],
  );

  // Handle window resize
  useEffect(() => {
    if (!adjustOnResize) return;

    const handleResize = () => {
      recalculate();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [adjustOnResize, recalculate]);

  // Initial position update
  useEffect(() => {
    initialPosRef.current = initialPosition;
    if (elementDimensions) {
      const boundedPos = calculateBoundedPosition(
        initialPosition,
        elementDimensions,
      );
      setPosition(boundedPos);
    } else {
      setPosition(initialPosition);
    }
  }, [initialPosition, elementDimensions, calculateBoundedPosition]);

  return {
    position,
    recalculate,
    setInitialPosition,
  };
}

/**
 * Options for auto-adjusting position based on element ref
 */
export interface UseAutoAdjustedPositionOptions {
  /**
   * Initial position before adjustment
   */
  initialPosition: ViewportBoundedPosition;
  /**
   * Padding from viewport edges
   * @default 10
   */
  viewportPadding?: number;
}

/**
 * Hook that automatically adjusts position based on element's actual dimensions.
 * Uses a ref to measure the element after render.
 *
 * @example
 * ```tsx
 * function ContextMenu({ triggerPosition }) {
 *   const { ref, position } = useAutoAdjustedPosition({
 *     initialPosition: triggerPosition,
 *     viewportPadding: 8,
 *   });
 *
 *   return (
 *     <div
 *       ref={ref}
 *       style={{ position: 'fixed', left: position.x, top: position.y }}
 *     >
 *       <MenuContent />
 *     </div>
 *   );
 * }
 * ```
 */
export function useAutoAdjustedPosition<T extends HTMLElement>({
  initialPosition,
  viewportPadding = 10,
}: UseAutoAdjustedPositionOptions): {
  ref: RefObject<T | null>;
  position: ViewportBoundedPosition;
} {
  const ref = useRef<T>(null);
  const [position, setPosition] = useState(initialPosition);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      setPosition(initialPosition);
      return;
    }

    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = initialPosition.x;
    let adjustedY = initialPosition.y;

    // Check right boundary
    if (rect.right > viewportWidth - viewportPadding) {
      adjustedX =
        initialPosition.x - (rect.right - viewportWidth) - viewportPadding;
    }

    // Check left boundary
    if (rect.left < viewportPadding) {
      adjustedX = viewportPadding;
    }

    // Check bottom boundary
    if (rect.bottom > viewportHeight - viewportPadding) {
      adjustedY = initialPosition.y - rect.height - viewportPadding;
    }

    // Check top boundary
    if (rect.top < viewportPadding) {
      adjustedY = viewportPadding;
    }

    setPosition({ x: adjustedX, y: adjustedY });
  }, [initialPosition, viewportPadding]);

  return { ref, position };
}
