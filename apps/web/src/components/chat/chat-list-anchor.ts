/** Preserve the first visible chat as pages are prepended/evicted or reordered. */
export function anchoredChatScrollTop(
  previous: readonly { id: string }[],
  current: readonly { id: string }[],
  scrollTop: number,
  rowHeight: number,
  preserveAtTop: boolean,
): number {
  if (!previous.length || !current.length || (scrollTop <= 0 && !preserveAtTop))
    return 0;
  const index = Math.min(
    previous.length - 1,
    Math.max(0, Math.floor(scrollTop / rowHeight)),
  );
  const positions = new Map(
    current.map((chat, position) => [chat.id, position]),
  );
  // If a filter/realtime event removed the anchor, use its closest surviving
  // neighbour. Never jump to the start just because a row disappeared.
  for (let distance = 0; distance < previous.length; distance++) {
    for (const oldIndex of distance === 0
      ? [index]
      : [index + distance, index - distance]) {
      const id = previous[oldIndex]?.id;
      const nextIndex = id === undefined ? undefined : positions.get(id);
      if (nextIndex !== undefined) {
        return Math.max(0, scrollTop + (nextIndex - oldIndex) * rowHeight);
      }
    }
  }
  return 0;
}
