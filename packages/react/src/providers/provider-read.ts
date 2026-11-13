// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// One read of the provider: the catalog, the snapshot or a customer session's
// portal. Its policy, what it does once a read has failed, and what it then
// tells the gates.

import * as React from "react";
import useSWR, { useSWRConfig } from "swr";

import { KaitenError } from "@kaitencloud/client";

import type { UseKaitenQueryResult } from "../hooks/use-kaiten-query.ts";

/** The wait after a first failed read, in milliseconds. It doubles with each failure that follows. */
export const READ_RETRY_FIRST_MS = 5_000;

/**
 * The longest wait between two reads while they fail: the default polling
 * interval, so a provider whose API is down asks no more often than one whose
 * API is up.
 */
export const READ_RETRY_SLOWEST_MS = 300_000;

/** How long what was last read keeps deciding once reads fail, when the host does not say: an hour. */
export const DEFAULT_STALE_IF_ERROR_MS = 3_600_000;

/**
 * How long to wait before reading again, after `failures` reads in a row
 * failed, the last one with `error`.
 *
 * An outage is asked about again soon, then less and less often: 5 seconds, 10,
 * 20, up to 5 minutes. A refusal is not an outage. The API answered, and asking
 * a rejected credential or a missing customer again every few seconds only
 * spends rate budget, so a refusal waits the 5 minutes from the first one: the
 * pace of a poll. Either way the wait is never shorter than the `Retry-After`
 * the API sent.
 *
 * The wait moves by up to a fifth either way, so that the tabs an outage failed
 * together do not all come back in the same second.
 */
export function readRetryDelay(failures: number, error: unknown, random = Math.random()): number {
  const answered = error instanceof KaitenError;
  const refused = answered && error.status < 500 && error.status !== 408 && error.status !== 429;
  const wait = refused
    ? READ_RETRY_SLOWEST_MS
    : Math.min(READ_RETRY_FIRST_MS * 2 ** (failures - 1), READ_RETRY_SLOWEST_MS);
  const asked = answered ? (error.retryAfterSeconds ?? 0) * 1000 : 0;
  return Math.max(Math.round(wait * (0.8 + random * 0.4)), asked);
}

/**
 * Calls `run` once `active` says the tab is shown and online, and returns what
 * cancels the wait.
 */
function whenActive(active: () => boolean, run: () => void): () => void {
  const check = () => {
    if (!active()) return;
    stop();
    run();
  };
  const stop = () => {
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("online", check);
  };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("online", check);
  return stop;
}

/** What a read keeps of its failures, between the renders. */
interface Recovery {
  /** The provider is mounted, and reads this key. */
  live: boolean;
  /** How many reads failed since the last one that succeeded. */
  failures: number;
  /** When the first of them failed, in milliseconds since the epoch. */
  since: number;
  /** Drops the wait for the next read, when one is pending. */
  cancel: (() => void) | null;
}

/** Starts the count over and drops the wait: a read succeeded, or nobody is left to read for. */
function forget(state: Recovery): void {
  state.failures = 0;
  state.cancel?.();
  state.cancel = null;
}

/** What SWR hands its error retry, as far as this one reads it. */
type ErrorRetry = (
  error: Error,
  key: string,
  config: unknown,
  /** Reads again, joining a read already in flight when `dedupe` says so. */
  revalidate: (options: { retryCount: number; dedupe: boolean }) => unknown,
) => void;

export interface ProviderReadOptions<T> {
  /** Server-fetched data to render before any read (`initialData`). */
  seed: T | undefined;
  /** The polling interval, `0` for none. */
  refreshInterval: number;
  /** See `staleIfErrorMs` on the provider. */
  staleIfErrorMs: number;
}

export interface ProviderRead<T> {
  /** What the hooks hand out: the data last read, and the error of the last read when it failed. */
  result: UseKaitenQueryResult<T>;
  /**
   * The read failed and holds nothing to decide on: it never succeeded, or reads
   * have been failing for longer than `staleIfErrorMs`. Short of that, a failed
   * read leaves `error` set beside the data it last had, and that data decides.
   */
  failed: boolean;
}

export function useProviderRead<T>(
  key: readonly [string, ...string[]] | null,
  read: () => Promise<T>,
  options: ProviderReadOptions<T>,
): ProviderRead<T> {
  const { seed, refreshInterval, staleIfErrorMs } = options;
  // What the read is of: a provider whose customer changes keeps this hook and reads another key.
  const id = key === null ? null : key.join("\n");

  const recovery = React.useRef<Recovery>({ live: false, failures: 0, since: 0, cancel: null });
  // The key whose reads have failed for longer than the host allows, if any.
  const [expiredId, setExpiredId] = React.useState<string | null>(null);
  const [refetching, setRefetching] = React.useState(false);
  // What "shown" and "online" mean is SWR's to say, and the host's through it.
  // Read when a wait ends, through a ref: a host that writes its `SWRConfig`
  // value inline hands over a new object at every render.
  const config = useSWRConfig();
  const swrConfig = React.useRef(config);
  swrConfig.current = config;

  // Waits as long as `error` asks, then reads again with `again`. One wait at a
  // time: a `refetch` that fails while one is pending adds none.
  const arm = React.useCallback((error: unknown, again: () => unknown) => {
    const state = recovery.current;
    if (state.cancel) return;

    const timer = setTimeout(
      () => {
        const read = () => {
          state.cancel = null;
          void again();
        };
        // A hidden tab and an offline browser are not polled, and are not read
        // for a retry either: the read waits for the tab to be shown and online,
        // and is made at once when it is.
        const active = () => swrConfig.current.isVisible() && swrConfig.current.isOnline();
        if (typeof document === "undefined" || active()) read();
        else state.cancel = whenActive(active, read);
      },
      readRetryDelay(Math.max(state.failures, 1), error),
    );
    state.cancel = () => clearTimeout(timer);
  }, []);

  // SWR calls the retry of the latest render, and only for a read of the key that
  // render reads: `id` and the delay are the ones in force when the read fails.
  const onErrorRetry = React.useCallback<ErrorRetry>(
    (error, _key, _config, revalidate) => {
      const state = recovery.current;
      // SWR also reports a read that settles after the provider is gone.
      if (!state.live) return;
      const now = Date.now();
      if (state.failures === 0) state.since = now;
      state.failures += 1;
      if (now - state.since >= staleIfErrorMs) setExpiredId(id);
      arm(error, () => revalidate({ retryCount: state.failures, dedupe: true }));
    },
    [arm, id, staleIfErrorMs],
  );

  const swr = useSWR<T, Error>(key, read, {
    // Render server-fetched data immediately. SWR doesn't count
    // fallbackData as "loaded" for `isLoading`, so also skip the mount
    // revalidation when seeded — the server data is fresh and polling still
    // refreshes it — otherwise `isLoading` stays true and components flash.
    fallbackData: seed,
    revalidateOnMount: seed ? false : undefined,
    refreshInterval,
    revalidateOnFocus: false,
    // A reconnect used to revalidate too (SWR's default), which made "no
    // request" impossible to promise: a page seeded with `initialData` and no
    // polling still fired one fetch the moment the browser came back online —
    // at the host's own origin when `apiUrl` was left at its default, so the
    // answer was a 404 and a `KaitenFailed` state. A read happens on mount, on
    // the polling schedule, on `refetch` and after a read that failed; nowhere
    // else.
    revalidateOnReconnect: false,
    // Don't poll a hidden tab or an offline browser (SWR defaults, made
    // explicit) — a backgrounded dashboard stops hammering the API.
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    // SWR skips a polling tick while its cache holds an error, and counts on
    // this retry to clear it: with the retry off, a read that failed was the
    // last one a tab made. It is one read per provider, not one per gate, on
    // the delays of `readRetryDelay`.
    shouldRetryOnError: true,
    onErrorRetry,
    dedupingInterval: 1_000,
  });
  const { data, error, isLoading, mutate } = swr;

  // The provider is gone, or reads something else: nothing is owed to the old key.
  React.useEffect(() => {
    const state = recovery.current;
    state.live = true;
    return () => {
      state.live = false;
      forget(state);
    };
  }, [id]);

  const errored = error !== undefined;
  const lastError = React.useRef(error);
  lastError.current = error;
  React.useEffect(() => {
    if (!errored) {
      // A read succeeded, whoever made it.
      forget(recovery.current);
      setExpiredId(null);
      return;
    }
    // The read stands failed, and this hook may not have seen it fail: it is the
    // cache of an earlier mount, or another provider of the same scope made the
    // read, and its retry goes with it when it unmounts. A read is owed all the
    // same, so one is armed unless one is pending: now, and every five minutes
    // for as long as the failure stands.
    const watch = () => arm(lastError.current, mutate);
    watch();
    const timer = setInterval(watch, READ_RETRY_SLOWEST_MS);
    return () => clearInterval(timer);
  }, [arm, errored, mutate]);

  const refetch = React.useCallback(() => {
    setRefetching(true);
    const done = () => setRefetching(false);
    // SWR's bound mutate resolves once the read has settled, failed or not.
    void mutate().then(done, done);
  }, [mutate]);

  const result = React.useMemo<UseKaitenQueryResult<T>>(
    () => ({
      data,
      // A read in flight with nothing read yet is loading the first time, and
      // when the host asked for it. The one the provider makes on its own after
      // a failure is not: `Gate` is open while loading, and would open for the
      // length of every retry of an outage.
      isLoading: isLoading && (error === undefined || refetching),
      error: error ?? null,
      refetch,
    }),
    [data, error, isLoading, refetching, refetch],
  );

  return { result, failed: errored && (data === undefined || expiredId === id) };
}
