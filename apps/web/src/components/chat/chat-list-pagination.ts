/** Ignore scroll clamping when a sparsely filtered window becomes empty. */
export function shouldLoadNewerChats(
  root: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
  previousScrollTop: number,
): boolean {
  return (
    root.scrollTop < previousScrollTop &&
    root.scrollTop < 380 &&
    root.scrollHeight > root.clientHeight
  );
}

/** Observe the list's footer inside its own scroll viewport, not the window. */
export function observeChatListEnd(
  root: HTMLElement,
  footer: HTMLElement,
  loadMore: () => void,
): () => void {
  // The visible Load more button remains usable without IntersectionObserver.
  if (typeof IntersectionObserver === "undefined") return () => {};
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    },
    { root, rootMargin: "0px 0px 380px 0px" },
  );
  observer.observe(footer);
  return () => observer.disconnect();
}
