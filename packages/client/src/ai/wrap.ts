// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { AiRequestStatus, AiUsage } from "./contract.ts";
import type { AiMeter, AiMeterBeginInput, AiMeteredCall } from "./meter.ts";
import { classifyProviderError } from "./module.ts";

// Provider-agnostic pieces of a provider-client wrapper: delegation to the
// client, a promise that keeps the Stainless `withResponse()` surface, and
// stream metering. The OpenAI and Anthropic SDKs are both Stainless-generated,
// so their resources, promises and streams share these shapes.

type AnyFunction = (...args: unknown[]) => unknown;

/** Every dotted prefix of the allow-list: the objects the proxy descends into. */
function prefixesOf(methods: readonly string[]): Set<string> {
  const prefixes = new Set<string>();
  for (const method of methods) {
    const parts = method.split(".");
    for (let i = 1; i < parts.length; i += 1) prefixes.add(parts.slice(0, i).join("."));
  }
  return prefixes;
}

/**
 * Wraps `target` by delegation. An allow-listed method (a dotted path such as
 * `chat.completions.create`) is replaced by what `wrap` returns; an object on
 * the way to one is proxied in turn; anything else is the target's own value.
 * Functions are bound to the real object, because the provider clients keep
 * `#private` state that a Proxy receiver cannot reach. Nothing is written to
 * the target.
 */
export function wrapByDelegation<T extends object>(
  target: T,
  methods: readonly string[],
  wrap: (method: string, fn: AnyFunction, owner: object) => AnyFunction,
): T {
  const prefixes = prefixesOf(methods);
  const allowed = new Set(methods);

  const proxy = (object: object, path: string): object => {
    // Keyed by property, checked against the value it was built from, so a
    // reassigned property is never served stale.
    const cache = new Map<string, { source: unknown; out: unknown }>();
    return new Proxy(object, {
      get(own, property) {
        const value: unknown = Reflect.get(own, property, own);
        if (typeof property !== "string") return value;
        const hit = cache.get(property);
        if (hit && hit.source === value) return hit.out;

        const full = path ? `${path}.${property}` : property;
        let out: unknown;
        if (typeof value === "function") {
          out = allowed.has(full)
            ? wrap(full, value as AnyFunction, own)
            : (value as AnyFunction).bind(own);
        } else if (value && typeof value === "object" && prefixes.has(full)) {
          out = proxy(value, full);
        } else {
          return value;
        }
        cache.set(property, { source: value, out });
        return out;
      },
    });
  };
  return proxy(target, "") as T;
}

export interface WithResponse<T> {
  data: T;
  response: Response;
  request_id?: string | null;
}

/**
 * What a wrapped method returns: a promise of the data that keeps the
 * provider's `withResponse()` and `asResponse()`, so code relying on them, and
 * the SDKs' own helpers (`messages.stream()` calls `create().withResponse()`),
 * keep working.
 */
export interface MeteredPromise<T> extends Promise<T> {
  withResponse(): Promise<WithResponse<T>>;
  asResponse(): Promise<Response>;
}

function meteredPromise<T>(inner: Promise<WithResponse<T>>): MeteredPromise<T> {
  // Marked handled: a caller that only uses `withResponse()` must not see an
  // unhandled rejection from a data promise it never asked for.
  inner.catch(() => {});
  const data = (): Promise<T> => inner.then((result) => result.data);
  return {
    // Stainless APIPromise compatibility requires an intentionally awaitable object.
    // oxlint-disable-next-line unicorn/no-thenable
    then: (onFulfilled, onRejected) => data().then(onFulfilled, onRejected),
    catch: (onRejected) => data().catch(onRejected),
    finally: (onFinally) => data().finally(onFinally),
    withResponse: () => inner,
    asResponse: () => inner.then((result) => result.response),
    [Symbol.toStringTag]: "Promise",
  } as MeteredPromise<T>;
}

/**
 * Runs one provider call through the meter: reserve (or go unmetered when
 * `begin` is undefined), invoke, then `settleWith` the data. A call that
 * throws commits with {@link classifyProviderError}'s status.
 */
export function meterCall<T>(
  meter: AiMeter,
  begin: AiMeterBeginInput | undefined,
  invoke: () => unknown,
  settleWith: (data: T, call: AiMeteredCall) => Promise<T>,
): MeteredPromise<T> {
  return meteredPromise(
    (async () => {
      const call = begin
        ? await meter.begin(begin)
        : meter.unmetered("the call names no model to reserve on");
      let result: WithResponse<T>;
      try {
        const pending = invoke() as Promise<T> & { withResponse?: () => Promise<WithResponse<T>> };
        result =
          typeof pending.withResponse === "function"
            ? await pending.withResponse()
            : { data: await pending, response: undefined as unknown as Response };
      } catch (error) {
        await call.settle(classifyProviderError(error));
        throw error;
      }
      return { ...result, data: await settleWith(result.data, call) };
    })(),
  );
}

export interface ProviderStream {
  controller?: AbortController;
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
}

export function isProviderStream(value: unknown): value is ProviderStream {
  return !!value && typeof value === "object" && Symbol.asyncIterator in value;
}

export interface MeterStreamOptions {
  /** The usage an event carries, merged over what came before. */
  usageOf: (event: unknown, sofar: AiUsage | undefined) => AiUsage | undefined;
  /** Events the caller did not ask for, kept from it (the forced usage chunk). */
  hide?: (event: unknown) => boolean;
  /** The model an event names, when it differs from the reservation's. */
  modelOf?: (event: unknown) => string | undefined;
}

/**
 * Meters a provider stream and hands back one of the same class, built with
 * the provider's own constructor, so `tee()`, `toReadableStream()` and
 * `controller` keep working. The commit fires when the stream ends: `SUCCESS`
 * with the usage seen; abandoned by the caller, `CUSTOMER_ERROR` with the usage
 * so far, or `NOT_SENT` when nothing arrived.
 */
export function meterStream<S extends ProviderStream>(
  stream: S,
  call: AiMeteredCall,
  options: MeterStreamOptions,
): S {
  async function* metered(): AsyncGenerator<unknown> {
    let usage: AiUsage | undefined;
    let received = false;
    let status: AiRequestStatus | undefined;
    try {
      for await (const event of stream) {
        received = true;
        usage = options.usageOf(event, usage) ?? usage;
        if (!options.hide?.(event)) yield event;
      }
      // Stainless streams can finish iteration normally after controller.abort().
      status = stream.controller?.signal.aborted ? "CUSTOMER_ERROR" : "SUCCESS";
    } catch (error) {
      // The provider answered, so an error mid-stream is never NOT_SENT.
      status =
        stream.controller?.signal.aborted || classifyProviderError(error) === "CUSTOMER_ERROR"
          ? "CUSTOMER_ERROR"
          : "PROVIDER_ERROR";
      throw error;
    } finally {
      // No status: the caller stopped reading (a `break`, a `return()`).
      status ??= "CUSTOMER_ERROR";
      if (status !== "SUCCESS" && !received) status = "NOT_SENT";
      await call.settle(status, usage);
    }
  }

  const Stream = stream.constructor as new (
    iterator: () => AsyncIterator<unknown>,
    controller: AbortController,
  ) => S;
  if (typeof Stream === "function" && stream.constructor !== Object && stream.controller) {
    try {
      return new Stream(metered, stream.controller);
    } catch {
      // A stream class with another constructor: fall through to a plain iterable.
    }
  }
  return { controller: stream.controller, [Symbol.asyncIterator]: metered } as unknown as S;
}
