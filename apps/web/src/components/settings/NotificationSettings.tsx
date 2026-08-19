import {
  Bell,
  BellOff,
  Cloud,
  Loader2,
  Moon,
  TestTube2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNotifications } from "@/hooks/notification";
import { NOTIFICATION_SOUNDS } from "@/lib/notifications";
import { useTranslation } from "react-i18next";

export function NotificationSettings() {
  const { t } = useTranslation();

  const {
    settings,
    permission,
    isSupported,
    isLoading,
    isSyncing,
    updateSettings,
    requestPermission,
    testNotification,
  } = useNotifications();

  if (!isSupported) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-tertiary p-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-dark-text-secondary">
          <BellOff className="h-5 w-5" />
          <p className="text-sm">
            {t(
              "notifications.unsupported",
              "Browser notifications are not supported in this browser.",
            )}
          </p>
        </div>
      </div>
    );
  }

  const handleEnableChange = async (enabled: boolean) => {
    if (enabled && permission !== "granted") {
      const newPermission = await requestPermission();
      if (newPermission !== "granted") {
        return;
      }
    }
    updateSettings({ enabled });
  };

  return (
    <div className="space-y-6">
      {/* Sync status indicator */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-dark-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            {t("notifications.loadingPreferences", "Loading preferences...")}
          </span>
        </div>
      )}
      {isSyncing && (
        <div className="flex items-center gap-2 text-sm text-blue-500">
          <Cloud className="h-4 w-4" />
          <span>{t("notifications.syncing", "Syncing...")}</span>
        </div>
      )}

      {/* Permission banner */}
      {permission === "denied" && (
        <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/30 p-4">
          <div className="flex items-start gap-3">
            <BellOff className="h-5 w-5 text-orange-500 dark:text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-orange-800 dark:text-orange-400">
                {t("notifications.blocked", "Notifications blocked")}
              </p>
              <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                {t(
                  "notifications.blockedHint",
                  "You have blocked notifications for this site. To enable them, click the lock icon in your browser's address bar and allow notifications.",
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {permission === "default" && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 p-4">
          <div className="flex items-start gap-3">
            <Bell className="h-5 w-5 text-blue-500 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-blue-800 dark:text-blue-400">
                {t("notifications.enablePrompt", "Enable notifications")}
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                {t(
                  "notifications.enablePromptHint",
                  "Get notified when you receive new messages.",
                )}
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={async () => {
                  if ((await requestPermission()) === "granted") {
                    updateSettings({ enabled: true });
                  }
                }}
              >
                {t("notifications.enableAction", "Enable Notifications")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delivery preferences */}
      <section className="divide-y divide-[#e8ece9] overflow-hidden rounded-2xl border border-[#dce3de] bg-white shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:divide-dark-border dark:border-dark-border dark:bg-dark-elevated">
        <header className="p-5 sm:p-6">
          <h3 className="font-semibold">
            {t("notifications.deliveryPreferences", "Delivery preferences")}
          </h3>
          <p className="mt-1 text-sm leading-6 text-[#65736d] dark:text-dark-text-secondary">
            {t(
              "notifications.deliveryPreferencesHint",
              "Choose how and when this browser should alert you.",
            )}
          </p>
        </header>

        {/* Enable/disable */}
        <div className="flex items-center justify-between gap-4 p-5 sm:px-6">
          <div className="flex items-center gap-3">
            {settings.enabled ? (
              <Bell className="h-5 w-5 text-gray-600 dark:text-dark-text-secondary" />
            ) : (
              <BellOff className="h-5 w-5 text-gray-400 dark:text-dark-text-tertiary" />
            )}
            <div>
              <Label className="font-medium">
                {t("notifications.desktop", "Desktop notifications")}
              </Label>
              <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
                {t(
                  "notifications.desktopHint",
                  "Show notifications for new messages",
                )}
              </p>
            </div>
          </div>
          <Checkbox
            checked={settings.enabled}
            onCheckedChange={handleEnableChange}
            disabled={permission === "denied"}
          />
        </div>

        {/* Sound settings */}
        <div className="flex items-center justify-between gap-4 p-5 sm:px-6">
          <div className="flex items-center gap-3">
            {settings.soundEnabled ? (
              <Volume2 className="h-5 w-5 text-gray-600 dark:text-dark-text-secondary" />
            ) : (
              <VolumeX className="h-5 w-5 text-gray-400 dark:text-dark-text-tertiary" />
            )}
            <div>
              <Label className="font-medium">
                {t("notifications.sound", "Notification sound")}
              </Label>
              <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
                {t(
                  "notifications.soundHint",
                  "Play a sound when receiving notifications",
                )}
              </p>
            </div>
          </div>
          <Checkbox
            checked={settings.soundEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ soundEnabled: !!checked })
            }
          />
        </div>

        {/* Sound choice */}
        {settings.soundEnabled && (
          <div className="p-5 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Label className="font-medium">
                {t("notifications.soundChoice", "Sound")}
              </Label>
              <Select
                value={settings.soundChoice}
                onValueChange={(value) =>
                  updateSettings({ soundChoice: value })
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(NOTIFICATION_SOUNDS).map((sound) => (
                    <SelectItem key={sound} value={sound}>
                      {sound.charAt(0).toUpperCase() + sound.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Quiet hours */}
        <div className="p-5 sm:px-6">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Moon className="h-5 w-5 text-gray-600 dark:text-dark-text-secondary" />
              <div>
                <Label className="font-medium">
                  {t("notifications.quietHours", "Quiet hours")}
                </Label>
                <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
                  {t(
                    "notifications.quietHoursHint",
                    "Pause notifications during specific hours",
                  )}
                </p>
              </div>
            </div>
            <Checkbox
              checked={settings.quietHoursEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ quietHoursEnabled: !!checked })
              }
            />
          </div>

          {settings.quietHoursEnabled && (
            <div className="ml-0 mt-4 grid gap-3 sm:ml-8 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-2 sm:justify-start">
                <Label
                  htmlFor="quiet-hours-start"
                  className="text-sm text-gray-500 dark:text-dark-text-secondary"
                >
                  {t("notifications.from", "From")}
                </Label>
                <input
                  id="quiet-hours-start"
                  type="time"
                  value={settings.quietHoursStart}
                  onChange={(e) =>
                    updateSettings({ quietHoursStart: e.target.value })
                  }
                  className="px-2 py-1 border border-gray-200 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary rounded text-sm"
                />
              </div>
              <div className="flex items-center justify-between gap-2 sm:justify-start">
                <Label
                  htmlFor="quiet-hours-end"
                  className="text-sm text-gray-500 dark:text-dark-text-secondary"
                >
                  {t("notifications.to", "To")}
                </Label>
                <input
                  id="quiet-hours-end"
                  type="time"
                  value={settings.quietHoursEnd}
                  onChange={(e) =>
                    updateSettings({ quietHoursEnd: e.target.value })
                  }
                  className="px-2 py-1 border border-gray-200 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary rounded text-sm"
                />
              </div>
            </div>
          )}
        </div>
        {permission === "granted" && settings.enabled && (
          <footer className="flex flex-col gap-3 bg-[#fbfcfb] p-5 dark:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs text-[#65736d] dark:text-dark-text-secondary">
              {t(
                "notifications.testHint",
                "Confirm that notifications work on this device.",
              )}
            </p>
            <Button
              variant="outline"
              onClick={testNotification}
              className="gap-2 self-start sm:self-auto"
            >
              <TestTube2 className="h-4 w-4" />
              {t("notifications.sendTest", "Send test notification")}
            </Button>
          </footer>
        )}
      </section>
    </div>
  );
}

export default NotificationSettings;
