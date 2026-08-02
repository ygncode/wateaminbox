export class HttpError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 409 | 413 | 415 | 429 | 500 | 503,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
  }
}
