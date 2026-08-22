/**
 * Root classes for the conversation column (`MainContent`).
 *
 * `min-h-0` is load-bearing. On mobile and tablet this box is a `flex-1` item
 * of a *column* flex container (the mobile view stack, the tablet main
 * column), so height is the main axis and the default `min-height: auto`
 * resolves to the content-based minimum - which includes the message list's
 * entire scroll height. The column then sizes itself to the whole
 * conversation rather than to the viewport, and the composer is laid out
 * hundreds or thousands of pixels below the shell's clipping box: on a phone
 * it simply disappears, and the message list runs under the floating
 * navigation. `min-h-0` keeps the column the height of its parent and hands
 * the overflow to the message list, which is the box that actually scrolls.
 *
 * Desktop never hit this: there the column is a *row* flex item, where height
 * is the cross axis and `min-height: auto` is already 0.
 *
 * Kept in its own module (like `mobile-navigation.ts`) so the invariant is
 * testable without pulling the component's runtime dependencies in.
 */
export const MAIN_CONTENT_ROOT_CLASS =
  "flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50 dark:bg-dark-primary";
