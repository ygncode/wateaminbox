import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

export const SIDEBAR_MIN_WIDTH = 280;
export const SIDEBAR_DEFAULT_WIDTH = 400;
export const SIDEBAR_MAX_WIDTH = 640;
const SIDEBAR_STORAGE_KEY = "wateaminbox:chat-sidebar-width";

export function getSidebarMaxWidth(viewportWidth: number): number {
  return Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, Math.floor(viewportWidth * 0.5)),
  );
}

export function clampSidebarWidth(
  width: number,
  viewportWidth: number,
): number {
  return Math.min(
    getSidebarMaxWidth(viewportWidth),
    Math.max(SIDEBAR_MIN_WIDTH, width),
  );
}

function getViewportWidth(): number {
  return typeof window === "undefined"
    ? SIDEBAR_DEFAULT_WIDTH * 3
    : window.innerWidth;
}

function getInitialWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;

  const storedWidth = Number.parseInt(
    window.localStorage.getItem(SIDEBAR_STORAGE_KEY) ?? "",
    10,
  );
  return clampSidebarWidth(
    Number.isFinite(storedWidth) ? storedWidth : SIDEBAR_DEFAULT_WIDTH,
    window.innerWidth,
  );
}

interface ResizableSidebarProps {
  children: ReactNode;
  className?: string;
}

/** Desktop conversation list with a WhatsApp-style draggable divider. */
export function ResizableSidebar({
  children,
  className,
}: ResizableSidebarProps) {
  const [width, setWidth] = useState(getInitialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const dragStart = useRef<{ pointerX: number; width: number } | null>(null);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(width));
  }, [width]);

  useEffect(() => {
    const handleWindowResize = () => {
      setWidth((currentWidth) =>
        clampSidebarWidth(currentWidth, window.innerWidth),
      );
    };
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { pointerX: event.clientX, width };
    setIsResizing(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const nextWidth =
      dragStart.current.width + event.clientX - dragStart.current.pointerX;
    setWidth(clampSidebarWidth(nextWidth, getViewportWidth()));
  };

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleLostPointerCapture = () => {
    dragStart.current = null;
    setIsResizing(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    let nextWidth: number | null = null;

    if (event.key === "ArrowLeft") nextWidth = width - step;
    if (event.key === "ArrowRight") nextWidth = width + step;
    if (event.key === "Home") nextWidth = SIDEBAR_MIN_WIDTH;
    if (event.key === "End") nextWidth = getSidebarMaxWidth(getViewportWidth());

    if (nextWidth === null) return;
    event.preventDefault();
    setWidth(clampSidebarWidth(nextWidth, getViewportWidth()));
  };

  const resetWidth = () => {
    setWidth(clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, getViewportWidth()));
  };

  return (
    <div
      className={cn("relative flex h-full min-w-0 flex-none", className)}
      style={{ width }}
    >
      {children}
      <div
        role="separator"
        aria-label="Resize conversation list"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={getSidebarMaxWidth(getViewportWidth())}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={handleLostPointerCapture}
        onDoubleClick={resetWidth}
        onKeyDown={handleKeyDown}
        className={cn(
          "group/resize absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize touch-none outline-none",
          "focus-visible:bg-whatsapp-teal-green/15",
        )}
      >
        <span
          className={cn(
            "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors",
            isResizing
              ? "bg-whatsapp-teal-green"
              : "bg-transparent group-hover/resize:bg-whatsapp-teal-green/70 group-focus-visible/resize:bg-whatsapp-teal-green",
          )}
        />
      </div>
    </div>
  );
}
