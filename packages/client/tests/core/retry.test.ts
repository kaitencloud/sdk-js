import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { retry } from "../../src/core/runtime/retry.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("retry", () => {
  test("returns the result without retrying when the callback succeeds", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(retry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries until the callback resolves", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return "ok";
    });

    const promise = retry(fn, { jitter: false });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("rethrows immediately when shouldRetry returns false", async () => {
    const error = new Error("fatal");
    const fn = vi.fn(async () => {
      throw error;
    });
    const onBeforeRetry = vi.fn();

    await expect(retry(fn, { shouldRetry: () => false, onBeforeRetry })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onBeforeRetry).not.toHaveBeenCalled();
  });

  test("applies exponential backoff (initialDelay * factor^n) with jitter disabled", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw new Error("fail");
    });

    const promise = retry(fn, {
      jitter: false,
      retryImmediately: false,
      initialDelay: 100,
      factor: 2,
      shouldRetry: (_error, iteration) => iteration < 4,
    }).catch((error) => error);

    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100); // 100 * 2^0
    expect(fn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(200); // 100 * 2^1
    expect(fn).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(400); // 100 * 2^2
    expect(fn).toHaveBeenCalledTimes(4);

    await expect(promise).resolves.toBeInstanceOf(Error);
  });

  test("caps the backoff at maxDelayBetweenRetries", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw new Error("fail");
    });

    const promise = retry(fn, {
      jitter: false,
      retryImmediately: false,
      initialDelay: 100,
      factor: 10,
      maxDelayBetweenRetries: 150,
      shouldRetry: (_error, iteration) => iteration < 3,
    }).catch((error) => error);

    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100); // first delay: 100 (< cap)
    expect(fn).toHaveBeenCalledTimes(2);

    // Second delay would be 1000 (100 * 10), but is capped to 150.
    await vi.advanceTimersByTimeAsync(150);
    expect(fn).toHaveBeenCalledTimes(3);

    await expect(promise).resolves.toBeInstanceOf(Error);
  });

  test("retryImmediately shortcuts the first retry to a fixed short delay", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw new Error("fail");
    });

    const promise = retry(fn, {
      jitter: false,
      retryImmediately: true,
      initialDelay: 5000,
      shouldRetry: (_error, iteration) => iteration < 2,
    }).catch((error) => error);

    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);

    // The first retry uses the fixed ~100ms immediate delay, not initialDelay (5000ms).
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);

    await expect(promise).resolves.toBeInstanceOf(Error);
  });

  test("invokes onBeforeRetry with the iteration number before each retry", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return "ok";
    });
    const onBeforeRetry = vi.fn();

    const promise = retry(fn, { jitter: false, onBeforeRetry });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(onBeforeRetry).toHaveBeenCalledTimes(2);
    expect(onBeforeRetry).toHaveBeenNthCalledWith(1, 1);
    expect(onBeforeRetry).toHaveBeenNthCalledWith(2, 2);
  });
});
