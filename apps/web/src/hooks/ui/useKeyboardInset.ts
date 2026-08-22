import { useEffect } from "react";
import { KEYBOARD_INSET_CSS_VAR, resolveKeyboardInset } from "./keyboard-inset";

/**
 * Publishes the on-screen keyboard overlap as a CSS variable on the document
 * root, so layout can react to it without every consumer subscribing to the
 * visual viewport.
 *
 * The variable is always defined while this hook is mounted (0 when there is
 * no keyboard) and removed on unmount, so a page that does not opt in can
 * never inherit a stale inset. See `keyboard-inset.ts` for why the value is
 * measured rather than assumed.
 */
export function useKeyboardInset(enabled = true): void {
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => root.style.removeProperty(KEYBOARD_INSET_CSS_VAR);

    if (!enabled) {
      clear();
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) {
      // Every browser that lacks the API also resizes the layout viewport.
      root.style.setProperty(KEYBOARD_INSET_CSS_VAR, "0px");
      return clear;
    }

    let frame = 0;
    const apply = () => {
      frame = 0;
      const inset = resolveKeyboardInset({
        layoutViewportHeight: window.innerHeight,
        visualViewportHeight: viewport.height,
        visualViewportOffsetTop: viewport.offsetTop,
        visualViewportScale: viewport.scale,
      });
      root.style.setProperty(KEYBOARD_INSET_CSS_VAR, `${inset}px`);
    };
    // The viewport fires a burst of events while the keyboard animates in;
    // one write per frame is enough and keeps layout off the event path.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    apply();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      clear();
    };
  }, [enabled]);
}
