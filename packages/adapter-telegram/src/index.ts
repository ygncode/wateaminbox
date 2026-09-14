// Telegram Bot API channel adapter.
//
// Bot API knowledge only: webhook verification, update normalization, outbound
// method mapping, and capabilities. Credential storage, tenant database
// access, and media storage are injected by the host application.

export * from "./adapter.js";
export * from "./api.js";
export * from "./normalize.js";
export * from "./transport.js";
