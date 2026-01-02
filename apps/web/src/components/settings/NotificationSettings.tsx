import { useNotifications } from "@/hooks/useNotifications";
import { Button, Label, Checkbox } from "@/components/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { Bell, BellOff, Volume2, VolumeX, Moon, TestTube2 } from "lucide-react";
import { NOTIFICATION_SOUNDS } from "@/lib/notifications";

export function NotificationSettings() {
  const {
    settings,
    permission,
    isSupported,
    updateSettings,
    requestPermission,
    testNotification,
  } = useNotifications();

  if (!isSupported) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center gap-2 text-gray-500">
          <BellOff className="h-5 w-5" />
          <p className="text-sm">
            Browser notifications are not supported in this browser.
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
      {/* Permission banner */}
      {permission === "denied" && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
          <div className="flex items-start gap-3">
            <BellOff className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-orange-800">
                Notifications blocked
              </p>
              <p className="text-sm text-orange-700 mt-1">
                You have blocked notifications for this site. To enable them,
                click the lock icon in your browser's address bar and allow
                notifications.
              </p>
            </div>
          </div>
        </div>
      )}

      {permission === "default" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-start gap-3">
            <Bell className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-blue-800">Enable notifications</p>
              <p className="text-sm text-blue-700 mt-1">
                Get notified when you receive new messages.
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => requestPermission()}
              >
                Enable Notifications
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main settings */}
      <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
        {/* Enable/disable */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {settings.enabled ? (
              <Bell className="h-5 w-5 text-gray-600" />
            ) : (
              <BellOff className="h-5 w-5 text-gray-400" />
            )}
            <div>
              <Label className="font-medium">Desktop Notifications</Label>
              <p className="text-sm text-gray-500">
                Show notifications for new messages
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
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {settings.soundEnabled ? (
              <Volume2 className="h-5 w-5 text-gray-600" />
            ) : (
              <VolumeX className="h-5 w-5 text-gray-400" />
            )}
            <div>
              <Label className="font-medium">Notification Sound</Label>
              <p className="text-sm text-gray-500">
                Play a sound when receiving notifications
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
          <div className="p-4">
            <div className="flex items-center justify-between">
              <Label className="font-medium">Sound</Label>
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
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Moon className="h-5 w-5 text-gray-600" />
              <div>
                <Label className="font-medium">Quiet Hours</Label>
                <p className="text-sm text-gray-500">
                  Pause notifications during specific hours
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
            <div className="flex items-center gap-4 ml-8 mt-3">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-gray-500">From</Label>
                <input
                  type="time"
                  value={settings.quietHoursStart}
                  onChange={(e) =>
                    updateSettings({ quietHoursStart: e.target.value })
                  }
                  className="px-2 py-1 border border-gray-200 rounded text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-gray-500">To</Label>
                <input
                  type="time"
                  value={settings.quietHoursEnd}
                  onChange={(e) =>
                    updateSettings({ quietHoursEnd: e.target.value })
                  }
                  className="px-2 py-1 border border-gray-200 rounded text-sm"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Test notification button */}
      {permission === "granted" && settings.enabled && (
        <Button variant="outline" onClick={testNotification} className="gap-2">
          <TestTube2 className="h-4 w-4" />
          Send Test Notification
        </Button>
      )}
    </div>
  );
}

export default NotificationSettings;
