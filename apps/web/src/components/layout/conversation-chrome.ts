import { getWorkspaceDestination } from "@/lib/workspace-routes";

/**
 * Shell chrome rules for the conversation detail view.
 *
 * An open conversation owns the whole touch layout. Both pieces of global
 * chrome step aside below `lg`:
 *
 * - the floating bottom navigation, which costs 5.5rem of reserved height plus
 *   a pill hovering over the composer. The reserved height goes with it;
 *   leaving the padding behind would open a dead band under the composer.
 * - the workspace header, whose switcher, notifications and theme controls all
 *   address the workspace rather than the conversation. It cost a second
 *   stacked bar above a header that already names the contact, on the layout
 *   with the least vertical room.
 *
 * Both return the moment the member goes back to the list.
 *
 * Desktop is untouched: at `lg` the fixed navigation rail has always owned
 * navigation and the floating bar has always been hidden, so these rules
 * change nothing there.
 *
 * Withdrawing the bar on tablet removes the only route to Dashboard,
 * Broadcast and the profile sheet while a conversation is open, so the
 * conversation header's back control now runs to `lg` rather than `md` and
 * deselects the conversation - which puts the member back on the list route,
 * where the bar returns. See `MessageHeader`/`ChatPage`.
 *
 * Everything is expressed as static class strings rather than a `useIsMobile()`
 * branch on purpose: media queries resolve before first paint, so the bar and
 * its reserved space can never flash in and out while React measures the
 * viewport.
 *
 * Kept free of React (like `mobile-navigation.ts` and `main-content-layout.ts`)
 * so the complementary-padding invariant below stays unit-testable.
 */

/**
 * Every class below is written out in full. Tailwind extracts utilities by
 * scanning source text, so a class assembled from a shared constant
 * (`` `pb-[${RESERVE}]` ``) is never generated - the reserve silently
 * disappears from the stylesheet and the composer slides back under the
 * floating bar. The duplication is the price of being scannable.
 */

/** Bar shown: phones and tablets, never at `lg` where the rail takes over. */
export const MOBILE_NAV_DEFAULT_CLASS = "flex lg:hidden";

/** Bar withdrawn on every touch layout; `lg` never rendered it anyway. */
export const MOBILE_NAV_CONVERSATION_CLASS = "hidden";

/** Workspace header: touch layouts only, since `lg` has the rail instead. */
export const WORKSPACE_HEADER_DEFAULT_CLASS = "flex lg:hidden";

/** Workspace header withdrawn; `lg` never rendered it anyway. */
export const WORKSPACE_HEADER_CONVERSATION_CLASS = "hidden";

/** Shell reserves the bar's height wherever the bar is rendered. */
export const SHELL_MAIN_NAV_RESERVE_CLASS =
  "pb-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:pb-0";

/** Conversation detail: nothing to reserve, because there is no bar. */
export const SHELL_MAIN_CONVERSATION_CLASS = "pb-0";

/**
 * The complement of `SHELL_MAIN_CONVERSATION_CLASS`. The shell reserves
 * nothing at any width once a conversation is open, so the bottom-most element
 * of the conversation column owns the whole bottom inset: the home indicator
 * and any on-screen keyboard.
 *
 * It owns them as a single `max()`, not a sum - both describe the same strip
 * of screen, and adding them lifts the composer a home-indicator's height
 * above an open keyboard. The declaration lives in `index.css` as
 * `.conversation-bottom-inset`; this constant only names it, so that the
 * "shell pays nothing, footer pays once" invariant stays checkable from a
 * test. Safe because the composer only ever mounts on a conversation detail
 * route: selecting a chat always navigates to `/chat/:contactId` first.
 */
export const CONVERSATION_BOTTOM_INSET_CLASS = "conversation-bottom-inset";

/**
 * Top inset for the conversation header, mirroring the bottom one.
 *
 * With the workspace header withdrawn there is nothing above the conversation
 * header on any layout that renders it, so it becomes the element that clears
 * the notch. The declaration lives in `index.css` as
 * `.conversation-header-inset` because the inset has to be *added* to the bar
 * height rather than eaten out of it: `box-sizing: border-box` is global and
 * the viewport opts into `viewport-fit=cover`, so pairing `h-14` with a
 * `padding-top` would leave roughly 9px of usable header on a notched phone.
 * Expressing height and padding together in one rule is what keeps those two
 * from drifting apart.
 */
export const CONVERSATION_HEADER_INSET_CLASS = "conversation-header-inset";

export interface AppShellChrome {
  /** True when the URL addresses one conversation rather than the list. */
  isConversationDetail: boolean;
  /** Visibility classes for the floating bottom navigation container. */
  navClass: string;
  /** Visibility classes for the mobile/tablet workspace header. */
  workspaceHeaderClass: string;
  /** Bottom padding the shell reserves for that navigation. */
  mainPaddingClass: string;
}

/**
 * A conversation detail is addressed by a contact id under the chat
 * destination - `/w/:workspaceId/chat/:contactId`, or the legacy `/chat/:id`.
 * The list itself (`/w/:workspaceId/chat`, with or without `?view=groups`)
 * is not a detail, and neither is any other destination.
 */
export function isConversationDetailPath(pathname: string): boolean {
  const { destination, suffix } = getWorkspaceDestination(pathname);
  return destination === "chat" && Boolean(suffix);
}

export function resolveAppShellChrome(pathname: string): AppShellChrome {
  const isConversationDetail = isConversationDetailPath(pathname);
  return {
    isConversationDetail,
    navClass: isConversationDetail
      ? MOBILE_NAV_CONVERSATION_CLASS
      : MOBILE_NAV_DEFAULT_CLASS,
    workspaceHeaderClass: isConversationDetail
      ? WORKSPACE_HEADER_CONVERSATION_CLASS
      : WORKSPACE_HEADER_DEFAULT_CLASS,
    mainPaddingClass: isConversationDetail
      ? SHELL_MAIN_CONVERSATION_CLASS
      : SHELL_MAIN_NAV_RESERVE_CLASS,
  };
}
