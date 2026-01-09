import type * as React from "react";
import { useIsMobile, useIsTablet } from "@/hooks/ui";
import { cn } from "@/lib/utils";

export interface AppLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Main application layout component
 * Provides responsive container for the three-column chat interface
 *
 * Desktop (1024px+): Full three-column layout
 * Tablet (768px-1023px): Two-column layout (sidebar + content)
 * Mobile (<768px): Single-column with navigation
 */
export function AppLayout({ className, children, ...props }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  return (
    <div
      className={cn(
        "flex h-screen w-screen overflow-hidden bg-gray-200 dark:bg-dark-primary",
        // Safe area insets for mobile devices (notch, home indicator)
        "safe-area-inset",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "mx-auto flex h-full w-full shadow-xl",
          // Responsive max-width
          !isMobile && "max-w-[1600px]",
          // On tablet, hide right panel by default (handled in children)
          isTablet && !isMobile && "max-w-[1200px]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export interface ResponsiveLayoutProps {
  /** Content for the left sidebar (chat list) */
  sidebar: React.ReactNode;
  /** Content for the main area (message thread) */
  main: React.ReactNode;
  /** Content for the right panel (contact info) - optional */
  rightPanel?: React.ReactNode;
  /** Whether the right panel is open */
  isRightPanelOpen?: boolean;
  /** Callback when right panel should close */
  onRightPanelClose?: () => void;
  /** Currently selected chat ID */
  selectedChatId?: string | null;
  /** Callback when chat selection changes */
  onChatSelect?: (chatId: string | null) => void;
}

/**
 * Responsive wrapper that handles layout switching between
 * desktop (3 columns), tablet (2 columns), and mobile (1 column with navigation)
 */
export function ResponsiveLayout({
  sidebar,
  main,
  rightPanel,
  isRightPanelOpen = false,
  onRightPanelClose,
  selectedChatId,
  onChatSelect,
}: ResponsiveLayoutProps) {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  // Mobile layout - single column with view switching
  if (isMobile) {
    return (
      <MobileResponsiveLayout
        sidebar={sidebar}
        main={main}
        rightPanel={rightPanel}
        isRightPanelOpen={isRightPanelOpen}
        onRightPanelClose={onRightPanelClose}
        selectedChatId={selectedChatId}
        onChatSelect={onChatSelect}
      />
    );
  }

  // Tablet layout - two columns, right panel as overlay
  if (isTablet) {
    return (
      <TabletResponsiveLayout
        sidebar={sidebar}
        main={main}
        rightPanel={rightPanel}
        isRightPanelOpen={isRightPanelOpen}
        onRightPanelClose={onRightPanelClose}
      />
    );
  }

  // Desktop layout - three columns
  return (
    <>
      {sidebar}
      {main}
      {rightPanel}
    </>
  );
}

// Import mobile layout components
import {
  MobileLayout,
  MobileLayoutProvider,
  MobileSlideInPanel,
  MobileViewContainer,
} from "./MobileLayout";

interface MobileResponsiveLayoutProps {
  sidebar: React.ReactNode;
  main: React.ReactNode;
  rightPanel?: React.ReactNode;
  isRightPanelOpen?: boolean;
  onRightPanelClose?: () => void;
  selectedChatId?: string | null;
  onChatSelect?: (chatId: string | null) => void;
}

function MobileResponsiveLayout({
  sidebar,
  main,
  rightPanel,
  isRightPanelOpen = false,
  onRightPanelClose,
  selectedChatId,
  onChatSelect,
}: MobileResponsiveLayoutProps) {
  return (
    <MobileLayoutProvider
      initialChatId={selectedChatId}
      onChatSelect={onChatSelect}
    >
      <MobileLayout>
        {/* Chat List View */}
        <MobileViewContainer view="chat-list">{sidebar}</MobileViewContainer>

        {/* Message Thread View */}
        <MobileViewContainer view="message-thread">{main}</MobileViewContainer>

        {/* Contact Info Panel - Slide in from right */}
        {rightPanel && (
          <MobileSlideInPanel
            isOpen={isRightPanelOpen}
            onClose={onRightPanelClose}
            title="Contact info"
            position="right"
          >
            {rightPanel}
          </MobileSlideInPanel>
        )}
      </MobileLayout>
    </MobileLayoutProvider>
  );
}

interface TabletResponsiveLayoutProps {
  sidebar: React.ReactNode;
  main: React.ReactNode;
  rightPanel?: React.ReactNode;
  isRightPanelOpen?: boolean;
  onRightPanelClose?: () => void;
}

function TabletResponsiveLayout({
  sidebar,
  main,
  rightPanel,
  isRightPanelOpen = false,
  onRightPanelClose,
}: TabletResponsiveLayoutProps) {
  return (
    <>
      {/* Sidebar - narrower on tablet */}
      <div className="w-[320px] flex-shrink-0">{sidebar}</div>

      {/* Main content - takes remaining space */}
      <div className="flex-1 relative">{main}</div>

      {/* Right panel as overlay on tablet */}
      {rightPanel && (
        <MobileSlideInPanel
          isOpen={isRightPanelOpen}
          onClose={onRightPanelClose}
          title="Contact info"
          position="right"
        >
          {rightPanel}
        </MobileSlideInPanel>
      )}
    </>
  );
}
