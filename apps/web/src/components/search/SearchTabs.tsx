/**
 * Search Tabs Component
 *
 * Tab navigation for switching between All, Messages, and Contacts search.
 */

import { MessageSquare, Search, User } from "lucide-react";
import type { SearchTab } from "./types";

interface SearchTabsProps {
  activeTab: SearchTab;
  onTabChange: (tab: SearchTab) => void;
}

const tabs: { value: SearchTab; label: string; icon: React.ReactElement }[] = [
  { value: "all", label: "All", icon: <Search className="w-4 h-4" /> },
  {
    value: "messages",
    label: "Messages",
    icon: <MessageSquare className="w-4 h-4" />,
  },
  {
    value: "contacts",
    label: "Contacts",
    icon: <User className="w-4 h-4" />,
  },
];

export function SearchTabs({ activeTab, onTabChange }: SearchTabsProps) {
  return (
    <div className="flex border-b border-gray-200 dark:border-dark-border">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onTabChange(tab.value)}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === tab.value
              ? "text-whatsapp-green border-b-2 border-whatsapp-green bg-whatsapp-green/5 dark:bg-whatsapp-green/10"
              : "text-gray-600 dark:text-dark-text-secondary hover:text-gray-900 dark:hover:text-dark-text-primary hover:bg-gray-50 dark:hover:bg-dark-tertiary"
          }`}
          aria-selected={activeTab === tab.value}
          role="tab"
        >
          {tab.icon}
          <span className="hidden sm:inline">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
