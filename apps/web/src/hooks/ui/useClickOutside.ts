import { useEffect, type RefObject } from 'react'

/**
 * Options for useClickOutside hook
 */
export interface UseClickOutsideOptions {
  /**
   * Whether the hook is enabled. When false, no event listeners are attached.
   * @default true
   */
  enabled?: boolean
  /**
   * Event type to listen for
   * @default 'mousedown'
   */
  eventType?: 'mousedown' | 'mouseup' | 'click'
}

/**
 * Hook to detect clicks outside of a referenced element.
 *
 * @example
 * ```tsx
 * function Dropdown({ onClose }: { onClose: () => void }) {
 *   const ref = useRef<HTMLDivElement>(null)
 *
 *   // Close dropdown when clicking outside
 *   useClickOutside(ref, onClose)
 *
 *   return (
 *     <div ref={ref}>
 *       <p>Dropdown content</p>
 *     </div>
 *   )
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Only listen when menu is open
 * useClickOutside(menuRef, closeMenu, { enabled: isMenuOpen })
 *
 * // Use mouseup instead of mousedown
 * useClickOutside(ref, onClose, { eventType: 'mouseup' })
 * ```
 *
 * @param ref - RefObject pointing to the element to monitor
 * @param callback - Function to call when a click outside is detected
 * @param options - Optional configuration
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  callback: () => void,
  options: UseClickOutsideOptions = {}
): void {
  const { enabled = true, eventType = 'mousedown' } = options

  useEffect(() => {
    if (!enabled) {
      return
    }

    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        callback()
      }
    }

    document.addEventListener(eventType, handleClickOutside)
    return () => {
      document.removeEventListener(eventType, handleClickOutside)
    }
  }, [ref, callback, enabled, eventType])
}
