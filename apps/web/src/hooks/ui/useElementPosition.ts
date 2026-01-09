import { useCallback, useState, type RefObject } from 'react'

/**
 * Position coordinates
 */
export interface Position {
  x: number
  y: number
}

/**
 * Options for position calculation
 */
export interface PositionOptions {
  /**
   * Fixed offset to apply (e.g., for alignment adjustments)
   */
  offset?: Position
}

/**
 * Hook to calculate position relative to a reference element.
 * Useful for context menus, tooltips, and popovers.
 *
 * @example
 * ```tsx
 * function MessageBubble() {
 *   const bubbleRef = useRef<HTMLDivElement>(null)
 *   const [showContextMenu, setShowContextMenu] = useState(false)
 *   const { position, calculateFromMouseEvent } = useRelativePosition(bubbleRef)
 *
 *   const handleContextMenu = (e: React.MouseEvent) => {
 *     e.preventDefault()
 *     calculateFromMouseEvent(e)
 *     setShowContextMenu(true)
 *   }
 *
 *   return (
 *     <div ref={bubbleRef} onContextMenu={handleContextMenu}>
 *       <MessageContent />
 *       {showContextMenu && (
 *         <ContextMenu position={position} />
 *       )}
 *     </div>
 *   )
 * }
 * ```
 *
 * @param ref - RefObject of the container element
 * @returns Object with position state and calculation functions
 */
export function useRelativePosition<T extends HTMLElement>(ref: RefObject<T | null>) {
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 })

  /**
   * Calculate position from a mouse event relative to the ref element
   */
  const calculateFromMouseEvent = useCallback(
    (event: React.MouseEvent, options: PositionOptions = {}) => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return

      const { offset = { x: 0, y: 0 } } = options

      setPosition({
        x: event.clientX - rect.left + offset.x,
        y: event.clientY - rect.top + offset.y,
      })
    },
    [ref]
  )

  /**
   * Set a fixed position (e.g., for popovers that open at a specific location)
   */
  const setFixedPosition = useCallback(
    (pos: Position | ((rect: DOMRect) => Position)) => {
      if (typeof pos === 'function') {
        const rect = ref.current?.getBoundingClientRect()
        if (rect) {
          setPosition(pos(rect))
        }
      } else {
        setPosition(pos)
      }
    },
    [ref]
  )

  /**
   * Calculate position for a reaction picker relative to bubble
   * @param isOwn - Whether this is user's own message (affects horizontal placement)
   * @param verticalOffset - Vertical offset from top of element
   */
  const calculateReactionPickerPosition = useCallback(
    (isOwn: boolean, verticalOffset: number = -50) => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return

      setPosition({
        x: isOwn ? -20 : rect.width - 20,
        y: verticalOffset,
      })
    },
    [ref]
  )

  return {
    position,
    calculateFromMouseEvent,
    setFixedPosition,
    calculateReactionPickerPosition,
    setPosition,
  }
}

/**
 * Options for popover positioning with viewport boundary awareness
 */
export interface PopoverPositionOptions {
  /**
   * Preferred placement of the popover
   * @default 'bottom'
   */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /**
   * Gap between trigger and popover
   * @default 8
   */
  gap?: number
  /**
   * Padding from viewport edges
   * @default 8
   */
  viewportPadding?: number
}

/**
 * Calculate position for a popover with viewport boundary awareness.
 * Flips to opposite side if not enough space.
 *
 * @example
 * ```tsx
 * function TooltipTrigger({ content }: { content: string }) {
 *   const triggerRef = useRef<HTMLButtonElement>(null)
 *   const [visible, setVisible] = useState(false)
 *
 *   const position = usePopoverPosition(triggerRef, {
 *     placement: 'top',
 *     gap: 4,
 *   })
 *
 *   return (
 *     <>
 *       <button ref={triggerRef} onMouseEnter={() => setVisible(true)}>
 *         Hover me
 *       </button>
 *       {visible && (
 *         <Tooltip style={{ left: position.x, top: position.y }}>
 *           {content}
 *         </Tooltip>
 *       )}
 *     </>
 *   )
 * }
 * ```
 */
export function usePopoverPosition<T extends HTMLElement>(
  triggerRef: RefObject<T | null>,
  options: PopoverPositionOptions = {}
): Position & { placement: 'top' | 'bottom' | 'left' | 'right' } {
  const { placement = 'bottom', gap = 8, viewportPadding = 8 } = options
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 })
  const [actualPlacement, setActualPlacement] = useState(placement)

  const calculate = useCallback(
    (popoverWidth: number = 200, popoverHeight: number = 100) => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return

      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
      }

      let x = 0
      let y = 0
      let finalPlacement = placement

      // Calculate position based on placement
      switch (placement) {
        case 'top':
          x = rect.left + rect.width / 2 - popoverWidth / 2
          y = rect.top - popoverHeight - gap
          // Flip to bottom if not enough space at top
          if (y < viewportPadding) {
            y = rect.bottom + gap
            finalPlacement = 'bottom'
          }
          break
        case 'bottom':
          x = rect.left + rect.width / 2 - popoverWidth / 2
          y = rect.bottom + gap
          // Flip to top if not enough space at bottom
          if (y + popoverHeight > viewport.height - viewportPadding) {
            y = rect.top - popoverHeight - gap
            finalPlacement = 'top'
          }
          break
        case 'left':
          x = rect.left - popoverWidth - gap
          y = rect.top + rect.height / 2 - popoverHeight / 2
          // Flip to right if not enough space at left
          if (x < viewportPadding) {
            x = rect.right + gap
            finalPlacement = 'right'
          }
          break
        case 'right':
          x = rect.right + gap
          y = rect.top + rect.height / 2 - popoverHeight / 2
          // Flip to left if not enough space at right
          if (x + popoverWidth > viewport.width - viewportPadding) {
            x = rect.left - popoverWidth - gap
            finalPlacement = 'left'
          }
          break
      }

      // Clamp horizontal position to viewport
      x = Math.max(viewportPadding, Math.min(x, viewport.width - popoverWidth - viewportPadding))

      // Clamp vertical position to viewport
      y = Math.max(viewportPadding, Math.min(y, viewport.height - popoverHeight - viewportPadding))

      setPosition({ x, y })
      setActualPlacement(finalPlacement)
    },
    [triggerRef, placement, gap, viewportPadding]
  )

  return { ...position, placement: actualPlacement, calculate } as Position & {
    placement: 'top' | 'bottom' | 'left' | 'right'
    calculate: typeof calculate
  }
}
