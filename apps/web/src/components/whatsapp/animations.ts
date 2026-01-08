/**
 * Animation styles for WhatsApp connection components
 * Injected into document head to avoid duplicate declarations
 */
export const animationStyles = `
  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes pulse-ring {
    0% {
      transform: scale(0.95);
      opacity: 0.5;
    }
    50% {
      transform: scale(1);
      opacity: 0.3;
    }
    100% {
      transform: scale(0.95);
      opacity: 0.5;
    }
  }

  @keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
  }

  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  .animate-slide-down {
    animation: slideDown 0.3s ease-out forwards;
  }

  .animate-fade-in {
    animation: fadeIn 0.2s ease-out forwards;
  }

  .animate-pulse-ring {
    animation: pulse-ring 2s ease-in-out infinite;
  }

  .animate-float {
    animation: float 3s ease-in-out infinite;
  }

  .animate-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
  }
`;

const STYLE_ID = "whatsapp-connection-panel-styles";

/**
 * Inject animation styles into document head
 * Safe to call multiple times - prevents duplicate injection
 */
export function injectAnimationStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;

  const styleEl = document.createElement("style");
  styleEl.id = STYLE_ID;
  styleEl.textContent = animationStyles;
  document.head.appendChild(styleEl);
}

/**
 * Remove animation styles from document head
 */
export function removeAnimationStyles(): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(STYLE_ID);
  if (existing) existing.remove();
}
