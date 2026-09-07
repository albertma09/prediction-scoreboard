export class RateLimiter {
  private nextAvailableAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    const waitFor = Math.max(0, this.nextAvailableAt - now);
    this.nextAvailableAt = Math.max(now, this.nextAvailableAt) + this.minIntervalMs;
    if (waitFor > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitFor));
    }
  }
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

interface FetchOptions {
  limiter?: RateLimiter;
  headers?: Record<string, string>;
  attempts?: number;
  timeoutMs?: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 4;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.limiter) {
      await options.limiter.acquire();
    }

    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'prediction-scoreboard/0.1 (research)',
          ...options.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const error = new ProviderHttpError(
          `http ${response.status} ${response.statusText}`,
          response.status,
          url,
        );
        if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) {
          throw error;
        }
        lastError = error;
      } else {
        return (await response.json()) as T;
      }
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderHttpError && !RETRYABLE_STATUS.has(error.status ?? 0)) {
        throw error;
      }
      if (attempt === attempts) {
        break;
      }
    }

    const backoffMs = Math.min(8_000, 2 ** (attempt - 1) * 500) + Math.random() * 250;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  throw lastError instanceof Error
    ? lastError
    : new ProviderHttpError('fallo desconocido', null, url);
}
