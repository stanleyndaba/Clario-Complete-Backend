export interface RetryOptions {
  retries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  factor?: number; // exponential backoff factor
  jitter?: boolean;
  shouldRetry?: (error: any, attempt: number) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    minDelayMs = 300,
    maxDelayMs = 3000,
    factor = 2,
    jitter = true,
    shouldRetry = (error: any) => {
      const status = error?.response?.status;
      // Retry on network errors and 5xx
      return status === undefined || (status >= 500 && status < 600);
    }
  } = opts;

  let attempt = 0;
  let delay = minDelayMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > retries || !shouldRetry(error, attempt)) {
        throw error;
      }
      const sleepMs = jitter ? Math.min(maxDelayMs, Math.random() * delay) : Math.min(maxDelayMs, delay);
      await new Promise(res => setTimeout(res, sleepMs));
      delay = Math.min(maxDelayMs, delay * factor);
    }
  }
}

// legacy simple retry removed to avoid duplicate exports


