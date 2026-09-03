import type * as React from "react";
import { useIsMobile, useIsTablet } from "@/hooks/ui";
import { cn } from "@/lib/utils";
import { RIGHT_PANEL_TITLE_ID, RightPanelSurfaceContext } from "./right-panel";
import { ResizableSidebar } from "./resizable-sidebar";

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
        // Safe-area insets belong to the app shell (top bar above, floating
        // navigation below); repeating them here double-padded every edge.
        "flex h-full w-full overflow-hidden bg-gray-200 dark:bg-dark-primary",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "mx-auto flex h-full w-full shadow-xl scroll-mt-4",
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
  /** Content for the fixed desktop navigation rail */
  desktopRail?: React.ReactNode;
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
  desktopRail,
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
      {desktopRail}
      <ResizableSidebar>{sidebar}</ResizableSidebar>
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

/**
 * Mobile and tablet host for the right panel.
 *
 * The panel content is authored for the desktop third column, which is hidden
 * below `lg`; rendering it untouched inside the drawer produced an empty
 * drawer. The surface context switches it to fill this drawer instead, and the
 * drawer defers its own header to the panel's, which knows whether it is
 * showing a contact or a group.
 */
function TouchRightPanel({
  children,
  isOpen,
  onClose,
}: {
  children: React.ReactNode;
  isOpen: boolean;
  onClose?: () => void;
}) {
  return (
    <MobileSlideInPanel
      isOpen={isOpen}
      onClose={onClose}
      titleId={RIGHT_PANEL_TITLE_ID}
      position="right"
    >
      <RightPanelSurfaceContext.Provider value="embedded">
        {children}
      </RightPanelSurfaceContext.Provider>
    </MobileSlideInPanel>
  );
}

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
      selectedChatId={selectedChatId}
      onChatSelect={onChatSelect}
    >
      <MobileLayout>
        {/* Chat List View */}
        <MobileViewContainer view="chat-list">{sidebar}</MobileViewContainer>

        {/* Message Thread View */}
        <MobileViewContainer view="message-thread">{main}</MobileViewContainer>

        {/* Contact Info Panel - Slide in from right */}
        {rightPanel && (
          <TouchRightPanel
            isOpen={isRightPanelOpen}
            onClose={onRightPanelClose}
          >
            {rightPanel}
          </TouchRightPanel>
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

      {/* Main content - takes remaining space. This has to be a flex column:
          `MainContent` sizes itself with `flex-1`, which needs a flex parent
          with a definite height, or the thread and composer collapse to their
          content height instead of filling the tablet column. `min-w-0` lets
          long unbroken message text shrink rather than widen the column. */}
      <div className="relative flex min-w-0 flex-1 flex-col">{main}</div>

      {/* Right panel as overlay on tablet */}
      {rightPanel && (
        <TouchRightPanel isOpen={isRightPanelOpen} onClose={onRightPanelClose}>
          {rightPanel}
        </TouchRightPanel>
      )}
    </>
  );
}
