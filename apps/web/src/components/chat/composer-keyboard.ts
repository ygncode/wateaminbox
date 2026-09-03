/** Desktop keeps its fast Enter-to-send shortcut; mobile Enter is a newline. */
export function shouldSendMessageOnEnter({
  key,
  shiftKey,
  isMobile,
  isComposing,
}: {
  key: string;
  shiftKey: boolean;
  isMobile: boolean;
  isComposing: boolean;
}): boolean {
  return key === "Enter" && !shiftKey && !isMobile && !isComposing;
}
