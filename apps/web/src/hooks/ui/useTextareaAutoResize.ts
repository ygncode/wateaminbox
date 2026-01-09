import { useCallback, useEffect, type RefObject } from 'react'

/**
 * Options for useTextareaAutoResize hook
 */
export interface UseTextareaAutoResizeOptions {
  /**
   * Maximum height in pixels before scrolling kicks in
   * @default 150
   */
  maxHeight?: number
  /**
   * Minimum height in pixels
   * @default undefined (uses textarea's natural height)
   */
  minHeight?: number
  /**
   * Dependencies that trigger a resize when changed
   * (e.g., the textarea value)
   */
  deps?: unknown[]
}

/**
 * Hook to automatically resize a textarea based on its content.
 *
 * @example
 * ```tsx
 * function MessageInput() {
 *   const textareaRef = useRef<HTMLTextAreaElement>(null)
 *   const [value, setValue] = useState('')
 *
 *   // Auto-resize up to 150px
 *   const { resize, reset } = useTextareaAutoResize(textareaRef, {
 *     maxHeight: 150,
 *     deps: [value],
 *   })
 *
 *   const handleSend = () => {
 *     // Send message...
 *     setValue('')
 *     reset() // Reset height after clearing
 *   }
 *
 *   return (
 *     <textarea
 *       ref={textareaRef}
 *       value={value}
 *       onChange={(e) => setValue(e.target.value)}
 *     />
 *   )
 * }
 * ```
 *
 * @param ref - RefObject pointing to the textarea element
 * @param options - Configuration options
 * @returns Object with resize() and reset() functions for manual control
 */
export function useTextareaAutoResize(
  ref: RefObject<HTMLTextAreaElement | null>,
  options: UseTextareaAutoResizeOptions = {}
): {
  /** Manually trigger a resize */
  resize: () => void
  /** Reset to auto/min height */
  reset: () => void
} {
  const { maxHeight = 150, minHeight, deps = [] } = options

  const resize = useCallback(() => {
    const textarea = ref.current
    if (!textarea) return

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto'

    // Calculate new height, respecting min and max
    let newHeight = textarea.scrollHeight

    if (minHeight !== undefined && newHeight < minHeight) {
      newHeight = minHeight
    }

    if (newHeight > maxHeight) {
      newHeight = maxHeight
    }

    textarea.style.height = `${newHeight}px`
  }, [ref, maxHeight, minHeight])

  const reset = useCallback(() => {
    const textarea = ref.current
    if (!textarea) return

    textarea.style.height = 'auto'
  }, [ref])

  // Resize on mount and when deps change
  useEffect(() => {
    resize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resize, ...deps])

  return { resize, reset }
}
