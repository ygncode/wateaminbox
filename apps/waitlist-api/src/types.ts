export interface Env extends Pick<CloudflareBindings, "DB" | "EMAIL"> {
  ADMIN_PASSWORD_HASH: string;
  ADMIN_SESSION_SECRET: string;
  ALLOWED_ORIGINS: string;
  ENVIRONMENT: string;
  MARKETING_ORIGIN: string;
  PUBLIC_API_ORIGIN: string;
  TURNSTILE_SECRET_KEY?: string;
  WAITLIST_FROM_EMAIL: string;
  WAITLIST_TOKEN_SECRET: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    corsOrigin?: string;
    requestId: string;
  };
};
