/**
 * Brand marks for the channel picker.
 *
 * These are inline paths rather than an icon dependency: the picker has to
 * render a provider's own mark to be recognizable at a glance, and lucide
 * carries no brand icons. Each mark draws on a rounded tile filled with the
 * provider's colour so the grid reads as one system.
 */
interface ChannelMarkProps {
  className?: string;
}

export function WhatsAppMark({ className }: ChannelMarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.03-.2-.31a8.17 8.17 0 0 1-1.25-4.37c0-4.54 3.7-8.23 8.23-8.23 2.2 0 4.26.86 5.82 2.41a8.17 8.17 0 0 1 2.41 5.82c0 4.54-3.7 8.22-8.24 8.22Zm4.52-6.16c-.25-.13-1.47-.72-1.69-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.54c.13.17 1.74 2.66 4.22 3.73.59.25 1.05.4 1.4.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.19.2-.58.2-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z"
      />
    </svg>
  );
}

export function TelegramMark({ className }: ChannelMarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.94 4.6 18.9 19a1.15 1.15 0 0 1-1.83.65l-4.1-3.03-1.99 1.92c-.22.22-.4.4-.82.4l.29-4.16 7.57-6.84c.33-.29-.07-.46-.51-.17l-9.35 5.89-4.03-1.26c-.88-.28-.9-.88.18-1.3L20.8 3.3c.73-.27 1.37.17 1.14 1.3Z"
      />
    </svg>
  );
}

export function InstagramMark({ className }: ChannelMarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.8 3.8 0 0 1-1.38-.9 3.8 3.8 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16Zm0 5.9a3.94 3.94 0 1 0 0 7.88 3.94 3.94 0 0 0 0-7.88Zm0 6.5a2.56 2.56 0 1 1 0-5.12 2.56 2.56 0 0 1 0 5.12Zm5.02-6.66a.92.92 0 1 1-1.84 0 .92.92 0 0 1 1.84 0Z"
      />
    </svg>
  );
}

export function MessengerMark({ className }: ChannelMarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2C6.4 2 2.1 6.1 2.1 11.6c0 3.14 1.4 5.94 3.6 7.76V23l3.3-1.81c.88.24 1.82.38 2.8.38 5.6 0 9.9-4.1 9.9-9.6S17.6 2 12 2Zm1 12.9-2.53-2.7-4.93 2.7 5.42-5.76 2.6 2.7 4.86-2.7L13 14.9Z"
      />
    </svg>
  );
}

export function LineMark({ className }: ChannelMarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {/*
        The brand mark sets the letters LINE inside the bubble. At the size a
        picker tile gives it those letters collapse into an illegible smudge,
        so this draws the bubble alone - recognizable at 24px, which is the
        only thing the tile has to achieve.
      */}
      <path
        fill="currentColor"
        d="M12 3c5.24 0 9.5 3.44 9.5 7.68 0 1.7-.66 3.23-2.03 4.74-1.98 2.28-6.4 5.06-7.4 5.48-.98.42-.85-.26-.8-.5l.13-.79c.03-.24.06-.6-.03-.83-.1-.25-.5-.38-.79-.44C6.4 17.79 3 14.6 3 10.68 3 6.44 7.26 3 12 3Z"
      />
    </svg>
  );
}

export function EmailMark({ className }: ChannelMarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 7.13L4.6 7h14.8L12 12.13ZM4 8.9V17h16V8.9l-7.4 5.13a1 1 0 0 1-1.2 0L4 8.9Z"
      />
    </svg>
  );
}
