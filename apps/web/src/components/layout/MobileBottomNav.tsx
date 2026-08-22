import {
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  User,
  Users,
} from "lucide-react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  formatInboxUnreadCount,
  getInboxNavigationLabel,
} from "./inbox-unread";
import type {
  MobileNavKey,
  MobileNavLink,
  MobileNavLinkKey,
} from "./mobile-navigation";

const ICONS: Record<MobileNavLinkKey, typeof MessageSquare> = {
  chat: MessageSquare,
  groups: Users,
  dashboard: LayoutDashboard,
  broadcasts: Megaphone,
};

const itemClass =
  "group relative flex h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-dark-secondary";
const activeClass = "bg-[#dcefe7] text-[#075c41]";
const inactiveClass =
  "text-[#65736d] hover:bg-black/[0.04] dark:text-dark-text-secondary dark:hover:bg-white/[0.06]";

export interface MobileBottomNavProps {
  links: MobileNavLink[];
  activeKey: MobileNavKey | null;
  /** Unread conversations, badged on the Chat destination. */
  unreadCount: number;
  onOpenProfile: () => void;
}

/**
 * Floating bottom navigation for phones and tablets.
 *
 * Rendered outside the document flow so it reads as a floating pill, with the
 * matching bottom padding reserved by the shell - a composer or table row
 * sitting underneath an opaque bar would otherwise be unreachable.
 */
export function MobileBottomNav({
  links,
  activeKey,
  unreadCount,
  onOpenProfile,
}: MobileBottomNavProps) {
  const { t } = useTranslation();

  return (
    // z-30 keeps the bar under every modal scrim in the app (contact drawer,
    // notification sheet, dialogs) while staying above the page content.
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] lg:hidden">
      <nav
        className="pointer-events-auto flex w-full max-w-md items-stretch gap-1 rounded-[1.75rem] border border-[#d7e0da] bg-white p-1.5 shadow-[0_10px_30px_-8px_rgba(16,44,36,0.45),0_2px_8px_-4px_rgba(16,44,36,0.25)] dark:border-white/10 dark:bg-dark-secondary dark:shadow-[0_12px_32px_-10px_rgba(0,0,0,0.85)]"
        aria-label={t("nav.mobile", "Mobile navigation")}
      >
        {links.map((link) => {
          const Icon = ICONS[link.key];
          const isActive = activeKey === link.key;
          const badgeCount = link.key === "chat" ? unreadCount : 0;
          const label = t(link.labelKey, link.label);

          return (
            // Plain `Link`, not `NavLink`: Chat and Groups resolve to the same
            // pathname, so NavLink would mark both of them aria-current.
            <Link
              key={link.key}
              to={link.path}
              aria-current={isActive ? "page" : undefined}
              aria-label={getInboxNavigationLabel(label, badgeCount, t)}
              className={cn(itemClass, isActive ? activeClass : inactiveClass)}
            >
              <span className="relative">
                <Icon className="h-5 w-5" aria-hidden="true" />
                {badgeCount > 0 && (
                  <span
                    className="absolute -top-1.5 left-2.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#25d366] px-1 text-[10px] font-bold leading-none text-[#073b2a] tabular-nums shadow-sm"
                    aria-hidden="true"
                    data-testid="inbox-unread-badge"
                  >
                    {formatInboxUnreadCount(badgeCount)}
                  </span>
                )}
              </span>
              <span className="max-w-full truncate">{label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onOpenProfile}
          aria-haspopup="dialog"
          aria-current={activeKey === "profile" ? "page" : undefined}
          className={cn(
            itemClass,
            activeKey === "profile" ? activeClass : inactiveClass,
          )}
        >
          <User className="h-5 w-5" aria-hidden="true" />
          <span className="max-w-full truncate">
            {t("nav.profile", "Profile")}
          </span>
        </button>
      </nav>
    </div>
  );
}

export default MobileBottomNav;
