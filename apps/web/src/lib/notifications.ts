/**
 * Browser Notifications Service
 * Handles notification permissions, sounds, and quiet hours
 */

// Notification types
export type NotificationType = "message" | "mention" | "assignment" | "system";

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  data?: Record<string, unknown>;
  silent?: boolean;
  onClick?: () => void;
}

export interface NotificationSettings {
  enabled: boolean;
  soundEnabled: boolean;
  soundChoice: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // HH:MM format
  quietHoursEnd: string; // HH:MM format
  mutedContacts: string[]; // JIDs of muted contacts
}

// Default settings
const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  soundEnabled: true,
  soundChoice: "default",
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  mutedContacts: [],
};

const SETTINGS_KEY = "notification_settings";

// Available notification sound types
export const NOTIFICATION_SOUNDS: Record<string, string> = {
  default: "default",
  chime: "chime",
  bell: "bell",
  pop: "pop",
  none: "",
};

// Audio context for Web Audio API
let audioContext: AudioContext | null = null;

/**
 * Get or create AudioContext for Web Audio API
 */
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  // Resume context if suspended (browsers require user interaction)
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
  return audioContext;
}

/**
 * Sound generator configurations
 */
interface SoundConfig {
  frequencies: number[];
  durations: number[];
  type: OscillatorType;
  gainStart: number;
  gainEnd: number;
}

const SOUND_CONFIGS: Record<string, SoundConfig> = {
  default: {
    frequencies: [880, 1108.73], // A5 to C#6
    durations: [0.1, 0.15],
    type: "sine",
    gainStart: 0.3,
    gainEnd: 0,
  },
  chime: {
    frequencies: [523.25, 659.25, 783.99], // C5-E5-G5 (C major chord)
    durations: [0.15, 0.15, 0.2],
    type: "sine",
    gainStart: 0.25,
    gainEnd: 0,
  },
  bell: {
    frequencies: [1046.5, 1318.5], // C6-E6
    durations: [0.08, 0.25],
    type: "triangle",
    gainStart: 0.35,
    gainEnd: 0,
  },
  pop: {
    frequencies: [600, 900],
    durations: [0.05, 0.08],
    type: "sine",
    gainStart: 0.4,
    gainEnd: 0,
  },
};

/**
 * Play a synthesized notification sound using Web Audio API
 */
async function playSynthSound(soundType: string): Promise<void> {
  const config = SOUND_CONFIGS[soundType] || SOUND_CONFIGS.default;
  const ctx = getAudioContext();

  let currentTime = ctx.currentTime;

  for (let i = 0; i < config.frequencies.length; i++) {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = config.type;
    oscillator.frequency.setValueAtTime(config.frequencies[i], currentTime);

    gainNode.gain.setValueAtTime(config.gainStart, currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.001,
      currentTime + config.durations[i],
    );

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(currentTime);
    oscillator.stop(currentTime + config.durations[i]);

    currentTime += config.durations[i] * 0.7; // Slight overlap for smoother sound
  }
}

/**
 * Get notification settings from localStorage
 */
export function getNotificationSettings(): NotificationSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_SETTINGS;
}

/**
 * Save notification settings to localStorage
 */
export function saveNotificationSettings(
  settings: Partial<NotificationSettings>,
): NotificationSettings {
  const current = getNotificationSettings();
  const updated = { ...current, ...settings };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
  return updated;
}

/**
 * Check if browser supports notifications
 */
export function isNotificationSupported(): boolean {
  return "Notification" in window;
}

/**
 * Get current notification permission status
 */
export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) {
    return "denied";
  }
  return Notification.permission;
}

/**
 * Request notification permission
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) {
    return "denied";
  }

  if (Notification.permission === "granted") {
    return "granted";
  }

  if (Notification.permission === "denied") {
    return "denied";
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch {
    return "denied";
  }
}

/**
 * Check if currently in quiet hours
 */
export function isQuietHours(): boolean {
  const settings = getNotificationSettings();

  if (!settings.quietHoursEnabled) {
    return false;
  }

  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  const [startHour, startMin] = settings.quietHoursStart.split(":").map(Number);
  const [endHour, endMin] = settings.quietHoursEnd.split(":").map(Number);

  const startTime = startHour * 60 + startMin;
  const endTime = endHour * 60 + endMin;

  // Handle overnight quiet hours (e.g., 22:00 - 07:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime < endTime;
  }

  return currentTime >= startTime && currentTime < endTime;
}

/**
 * Check if a contact is muted
 */
export function isContactMuted(jid: string): boolean {
  const settings = getNotificationSettings();
  return settings.mutedContacts.includes(jid);
}

/**
 * Mute a contact
 */
export function muteContact(jid: string): void {
  const settings = getNotificationSettings();
  if (!settings.mutedContacts.includes(jid)) {
    saveNotificationSettings({
      mutedContacts: [...settings.mutedContacts, jid],
    });
  }
}

/**
 * Unmute a contact
 */
export function unmuteContact(jid: string): void {
  const settings = getNotificationSettings();
  saveNotificationSettings({
    mutedContacts: settings.mutedContacts.filter((id) => id !== jid),
  });
}

/**
 * Play notification sound using Web Audio API
 */
export async function playNotificationSound(): Promise<void> {
  const settings = getNotificationSettings();

  if (!settings.soundEnabled || isQuietHours()) {
    return;
  }

  const soundType =
    NOTIFICATION_SOUNDS[settings.soundChoice] || NOTIFICATION_SOUNDS.default;

  if (!soundType) {
    return;
  }

  try {
    await playSynthSound(soundType);
  } catch (error) {
    // Audio play may be blocked by browser autoplay policies
    console.warn("[Notifications] Failed to play sound:", error);
  }
}

/**
 * Show a browser notification
 */
export async function showNotification(
  options: NotificationOptions,
): Promise<Notification | null> {
  const settings = getNotificationSettings();

  // Check if notifications are enabled
  if (!settings.enabled) {
    return null;
  }

  // Check quiet hours
  if (isQuietHours()) {
    return null;
  }

  // Check permission
  const permission = getNotificationPermission();
  if (permission !== "granted") {
    return null;
  }

  try {
    const notification = new Notification(options.title, {
      body: options.body,
      icon: options.icon || "/icons/notification-icon.png",
      tag: options.tag,
      data: options.data,
      silent: options.silent ?? !settings.soundEnabled,
    });

    // Play sound if not silent
    if (!options.silent && settings.soundEnabled) {
      playNotificationSound();
    }

    // Handle click
    if (options.onClick) {
      notification.onclick = () => {
        window.focus();
        options.onClick?.();
        notification.close();
      };
    }

    return notification;
  } catch (error) {
    console.error("[Notifications] Failed to show notification:", error);
    return null;
  }
}

/**
 * Show a message notification
 */
export async function showMessageNotification(
  senderName: string,
  messagePreview: string,
  senderJid: string,
  conversationId: string,
  options?: {
    avatarUrl?: string;
    onClick?: () => void;
  },
): Promise<Notification | null> {
  // Check if contact is muted
  if (isContactMuted(senderJid)) {
    return null;
  }

  return showNotification({
    title: senderName,
    body: messagePreview,
    icon: options?.avatarUrl,
    tag: `message-${conversationId}`,
    data: { conversationId, senderJid },
    onClick: options?.onClick,
  });
}

/**
 * Test notification - useful for settings UI
 */
export async function sendTestNotification(): Promise<boolean> {
  const permission = await requestNotificationPermission();

  if (permission !== "granted") {
    return false;
  }

  const notification = await showNotification({
    title: "Test Notification",
    body: "Notifications are working correctly!",
    tag: "test-notification",
  });

  return notification !== null;
}
export default {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  getNotificationSettings,
  saveNotificationSettings,
  showNotification,
  showMessageNotification,
  playNotificationSound,
  isQuietHours,
  isContactMuted,
  muteContact,
  unmuteContact,
  sendTestNotification,
};
