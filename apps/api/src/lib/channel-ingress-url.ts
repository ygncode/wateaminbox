import { env } from "./env.js";

/**
 * The base a provider calls back on.
 *
 * Separate from `APP_URL` because the two answer different questions: a
 * webhook needs a publicly routable HTTPS address, while `APP_URL` is where a
 * person opens the app - in local development a tunnel and localhost
 * respectively. Sending invite or OAuth links to the tunnel would be wrong,
 * and pointing a webhook at localhost simply never arrives.
 */
export function channelIngressBaseUrl(): string {
  return (env.CHANNEL_INGRESS_PUBLIC_URL || env.APP_URL).replace(/\/$/, "");
}

/** Every Telegram webhook this server registers starts with this. */
export function telegramIngressUrlPrefix(): string {
  return `${channelIngressBaseUrl()}/api/channel-ingress/telegram_bot/`;
}
