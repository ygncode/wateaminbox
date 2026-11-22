import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CONVERSATION_BOTTOM_INSET_CLASS,
  CONVERSATION_HEADER_INSET_CLASS,
} from "@/components/layout/conversation-chrome";
import {
  CONVERSATION_CANVAS_CLASS,
  ConversationCanvasPattern,
} from "./ConversationCanvas";

/**
 * The placeholder bubbles shown on the message canvas while a thread's
 * history is being fetched.
 *
 * Both loading stages of a conversation share this: ChatPage paints it while
 * the contact/channel metadata resolves, and MessageThread paints it while the
 * messages query runs. Keeping them identical means opening a chat no longer
 * swaps a skeleton for a centred spinner mid-load - it is one continuous
 * surface until the real messages land. It renders on the same
 * `CONVERSATION_CANVAS_CLASS` + `ConversationCanvasPattern` as the populated
 * thread, so the canvas never repaints when the bubbles resolve.
 */
export function ConversationMessagesSkeleton({
  /**
   * When embedded inside a container that already announces the loading
   * state (ChatPage's `ConversationLoadingState`), set this so the canvas
   * renders decoratively instead of nesting a second `role="status"`.
   */
  decorative = false,
}: {
  decorative?: boolean;
} = {}) {
  const { t } = useTranslation();

  const status = decorative
    ? ({ "aria-hidden": "true" } as const)
    : ({
        role: "status",
        "aria-live": "polite",
        "aria-busy": "true",
        "aria-label": t("chat.loadingMessages", "Loading messages..."),
      } as const);

  return (
    <div
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${CONVERSATION_CANVAS_CLASS}`}
      {...status}
    >
      {!decorative && (
        <span className="sr-only">
          {t("chat.loadingMessages", "Loading messages...")}
        </span>
      )}

      <ConversationCanvasPattern />

      <div
        className="relative mx-auto flex h-full w-full max-w-4xl flex-col justify-end gap-3 px-5 py-8 sm:px-10"
        aria-hidden="true"
      >
        <div className="flex justify-center pb-2">
          <Skeleton className="h-5 w-20 rounded-full bg-fg/10" />
        </div>
        <Skeleton className="h-12 w-[58%] max-w-md rounded-2xl rounded-es-sm bg-muted/75" />
        <Skeleton className="h-16 w-[46%] max-w-sm rounded-2xl rounded-es-sm bg-muted/75" />
        <div className="flex justify-end">
          <Skeleton className="h-12 w-[52%] max-w-md rounded-2xl rounded-ee-sm bg-bubble-out/70" />
        </div>
        <Skeleton className="h-10 w-[36%] max-w-xs rounded-2xl rounded-es-sm bg-muted/75" />
        <div className="flex justify-end">
          <Skeleton className="h-16 w-[44%] max-w-sm rounded-2xl rounded-ee-sm bg-bubble-out/70" />
        </div>
      </div>
    </div>
  );
}

/**
 * Conversation header placeholder: same inset class (height and notch) and
 * padding as MessageHeader.
 */
export function ThreadHeaderSkeleton() {
  return (
    <div
      data-sk="thread-header"
      aria-hidden="true"
      className={`flex shrink-0 items-center gap-0.5 border-b border-line bg-surface px-1 md:gap-2 md:px-3 ${CONVERSATION_HEADER_INSET_CLASS}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-1 md:gap-3 md:px-2">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3.5 w-36 max-w-[42%]" />
          <Skeleton className="mt-2 h-2.5 w-24 max-w-[30%]" />
        </div>
      </div>
      <Skeleton className="size-11 shrink-0 rounded-full md:size-10" />
    </div>
  );
}

/**
 * Composer placeholder for an open conversation: the route/actions bar, then
 * the rounded field and send button (MessageComposer inside
 * ComposerLifecycleArea).
 */
export function ComposerSkeleton() {
  return (
    <div
      data-sk="composer"
      aria-hidden="true"
      className={`shrink-0 bg-surface ${CONVERSATION_BOTTOM_INSET_CLASS}`}
    >
      <div className="flex min-h-8 items-center gap-2 border-b border-line bg-subtle/55 px-3 py-1">
        <Skeleton className="h-2.5 w-40 max-w-[45%]" />
        <div className="ms-auto flex items-center gap-1.5">
          <Skeleton className="h-9 w-[5.5rem] rounded-full" />
          <Skeleton className="h-9 w-[5.5rem] rounded-full" />
        </div>
      </div>
      <div className="flex items-end gap-1.5 px-2 pb-2 pt-1.5 sm:px-3">
        <Skeleton className="h-11 min-w-0 flex-1 rounded-[1.5rem] bg-raised" />
        <Skeleton className="size-11 shrink-0 rounded-full" />
      </div>
    </div>
  );
}
