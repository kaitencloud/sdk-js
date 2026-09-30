type Milliseconds = number;

export interface RetryOptions {
  initialDelay?: Milliseconds;
  maxDelayBetweenRetries?: Milliseconds;
  factor?: number;
  shouldRetry?: (error: unknown, iteration: number) => boolean;
  retryImmediately?: boolean;
  jitter?: boolean;
  onBeforeRetry?: (iteration: number) => void | Promise<void>;
}

const defaultOptions: Required<Omit<RetryOptions, "onBeforeRetry">> = {
  initialDelay: 125,
  maxDelayBetweenRetries: 0,
  factor: 2,
  shouldRetry: (_error: unknown, iteration: number) => iteration < 3,
  retryImmediately: false,
  jitter: true,
};

const RETRY_IMMEDIATELY_DELAY = 100;

function sleep(ms: Milliseconds): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyJitter(delay: Milliseconds, jitter: boolean): Milliseconds {
  return jitter ? delay * (1 + Math.random()) : delay;
}

function createExponentialDelay(options: {
  initialDelay: Milliseconds;
  maxDelayBetweenRetries: Milliseconds;
  factor: number;
  jitter: boolean;
}) {
  let timesCalled = 0;

  return async (): Promise<void> => {
    let delay = options.initialDelay * Math.pow(options.factor, timesCalled);
    delay = applyJitter(delay, options.jitter);
    if (options.maxDelayBetweenRetries > 0) {
      delay = Math.min(delay, options.maxDelayBetweenRetries);
    }

    timesCalled += 1;
    await sleep(delay);
  };
}

export async function retry<T>(
  callback: () => T | Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  let iterations = 0;
  const resolved = { ...defaultOptions, ...options };
  const delay = createExponentialDelay(resolved);

  while (true) {
    try {
      return await callback();
    } catch (error) {
      iterations += 1;

      if (!resolved.shouldRetry(error, iterations)) {
        throw error;
      }

      await options.onBeforeRetry?.(iterations);

      if (resolved.retryImmediately && iterations === 1) {
        await sleep(applyJitter(RETRY_IMMEDIATELY_DELAY, resolved.jitter));
      } else {
        await delay();
      }
    }
  }
}
