import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
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
          <Skeleton className="h-5 w-20 rounded-full bg-black/10 dark:bg-white/10" />
        </div>
        <Skeleton className="h-12 w-[58%] max-w-md rounded-2xl rounded-bl-sm bg-white/75 dark:bg-dark-tertiary" />
        <Skeleton className="h-16 w-[46%] max-w-sm rounded-2xl rounded-bl-sm bg-white/75 dark:bg-dark-tertiary" />
        <div className="flex justify-end">
          <Skeleton className="h-12 w-[52%] max-w-md rounded-2xl rounded-br-sm bg-[#d9fdd3]/80 dark:bg-[#005c4b]/70" />
        </div>
        <Skeleton className="h-10 w-[36%] max-w-xs rounded-2xl rounded-bl-sm bg-white/75 dark:bg-dark-tertiary" />
        <div className="flex justify-end">
          <Skeleton className="h-16 w-[44%] max-w-sm rounded-2xl rounded-br-sm bg-[#d9fdd3]/80 dark:bg-[#005c4b]/70" />
        </div>
      </div>
    </div>
  );
}
