// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The KaitenClient double the React suites run against.
//
// It used to be `class KaitenClient { constructor(_config: unknown) {} }` with
// argument-less stubs, duplicated in components.test.tsx and hooks.test.tsx.
// Every instance shared one implementation that answered the same fixture no
// matter who asked, so ~3,600 lines of assertions about *routing* — which
// provider, which mode, which customer, which instance — could not fail. A
// provider that sent every request to the wrong customer would have passed.
//
// This version keeps that convenience (set `state.snapshot` / `state.catalog`
// and every client answers it) but adds a scoped registry: register fixtures per
// (mode, apiUrl, token, customer, instance) and each client resolves its own.
// Unregistered scopes fall through to the flat state, which is why the existing
// suites needed no rewrite.
//
// The scope is derived where the real client derives it: the constructor config
// carries mode/apiUrl/token, while customer and instance only ever arrive as
// call arguments (kaiten-provider.tsx builds the client from the former and
// passes the latter to getLicensingSnapshot).

import { vi } from "vite-plus/test";

export type ClientMode = "public" | "authenticated";

/** What a client is, from the point of view of routing. */
export interface ClientScope {
  mode: ClientMode;
  apiUrl?: string | undefined;
  token?: string | undefined;
}

/** A snapshot/catalog pair pinned to one scope. */
export interface ScopedFixtures {
  snapshot?: unknown;
  catalog?: unknown;
}

export interface ScopeSelector extends Partial<ClientScope> {
  customerId?: string;
  instanceId?: string;
}

interface DoubleState {
  /** Flat fallback: what every unregistered scope resolves to. */
  snapshot: unknown;
  catalog: unknown;
  /** Fixtures registered for a specific scope, most specific key first. */
  scoped: Map<string, ScopedFixtures>;
  /** Every config a double was constructed with, in order. */
  constructions: ClientScope[];
}

const state: DoubleState = {
  snapshot: null,
  catalog: null,
  scoped: new Map(),
  constructions: [],
};

/**
 * A key that only includes what the caller pinned. Registering `{ customerId }`
 * matches any mode/apiUrl; registering the full tuple matches only that client.
 */
function keyOf(selector: ScopeSelector): string {
  return JSON.stringify({
    mode: selector.mode ?? null,
    apiUrl: selector.apiUrl ?? null,
    token: selector.token ?? null,
    customerId: selector.customerId ?? null,
    instanceId: selector.instanceId ?? null,
  });
}

// Resolution order: exact tuple, then progressively looser keys, then the flat
// state. Listing the fallbacks explicitly (rather than looping over subsets)
// keeps "which fixture answered" obvious when a test fails.
function candidateKeys(scope: ClientScope, customerId?: string, instanceId?: string): string[] {
  return [
    keyOf({ ...scope, customerId, instanceId }),
    keyOf({ ...scope, customerId }),
    keyOf({ customerId, instanceId }),
    keyOf({ customerId }),
    keyOf(scope),
    keyOf({ mode: scope.mode }),
  ];
}

function lookup(
  scope: ClientScope,
  customerId?: string,
  instanceId?: string,
): ScopedFixtures | null {
  for (const key of candidateKeys(scope, customerId, instanceId)) {
    const found = state.scoped.get(key);
    if (found) return found;
  }
  return null;
}

// The scope of the call in flight. The stubs are shared `vi.fn`s so that
// `toHaveBeenCalledWith` still sees the caller's real arguments; the scope
// therefore has to travel beside them rather than as an extra parameter.
let currentScope: ClientScope | null = null;
let currentCustomer: string | undefined;
let currentInstance: string | undefined;

function withScope<T>(
  scope: ClientScope,
  customerId: string | undefined,
  instanceId: string | undefined,
  run: () => T,
): T {
  const previous = [currentScope, currentCustomer, currentInstance] as const;
  currentScope = scope;
  currentCustomer = customerId;
  currentInstance = instanceId;
  try {
    return run();
  } finally {
    [currentScope, currentCustomer, currentInstance] = previous;
  }
}

function resolveSnapshot(): unknown {
  if (!currentScope) return state.snapshot;
  const scoped = lookup(currentScope, currentCustomer, currentInstance);
  return scoped && "snapshot" in scoped ? scoped.snapshot : state.snapshot;
}

function resolveCatalog(): unknown {
  if (!currentScope) return state.catalog;
  const scoped = lookup(currentScope, currentCustomer, currentInstance);
  return scoped && "catalog" in scoped ? scoped.catalog : state.catalog;
}

export const kaitenClientMock = {
  state,

  getCatalog: vi.fn(async () => resolveCatalog()),
  getLicensingSnapshot: vi.fn(async (_customerId?: string, _instanceId?: string) =>
    resolveSnapshot(),
  ),
  reportUsage: vi.fn(
    async (_instanceSlug: string, entitlementSlug: string, input: { value: unknown }) => ({
      entitlementId: "ent-api",
      entitlementSlug,
      licenseId: "lic-1",
      licenseSlug: "pro",
      value: input.value,
    }),
  ),

  /** Pin fixtures to a scope. Anything omitted from the selector is a wildcard. */
  register(selector: ScopeSelector, fixtures: ScopedFixtures): void {
    state.scoped.set(keyOf(selector), fixtures);
  },

  /** Drop scoped registrations and construction history; keeps the flat state. */
  resetScopes(): void {
    state.scoped.clear();
    state.constructions.length = 0;
  },

  /** The scope of the call currently in flight — for asserting inside a stub. */
  currentScope(): (ClientScope & { customerId?: string; instanceId?: string }) | null {
    return currentScope
      ? { ...currentScope, customerId: currentCustomer, instanceId: currentInstance }
      : null;
  },
};

interface DoubleConfig {
  apiUrl?: string;
  authScheme?: string;
  tokenProvider?: () => string | Promise<string>;
}

/**
 * Builds the class `vi.mock("@kaitencloud/client")` swaps in for `KaitenClient`.
 *
 * Call it from the mock factory; the stubs above are module-level, so the two
 * test files share one registry and a test file can still reach in with
 * `kaitenClientMock.getLicensingSnapshot.mockRejectedValueOnce(...)`.
 */
export function createKaitenClientDouble() {
  return class KaitenClient {
    readonly scope: ClientScope;

    constructor(config: DoubleConfig = {}) {
      const token = config.tokenProvider?.();
      this.scope = {
        mode: config.authScheme === "publishable" ? "public" : "authenticated",
        apiUrl: config.apiUrl,
        // A token provider may be async; only a synchronous value can key a
        // lookup, and every provider in these suites is synchronous.
        token: typeof token === "string" ? token : undefined,
      };
      state.constructions.push(this.scope);
    }

    getCatalog = () =>
      withScope(this.scope, undefined, undefined, () => kaitenClientMock.getCatalog());

    getLicensingSnapshot = (customerId?: string, instanceId?: string) =>
      withScope(this.scope, customerId, instanceId, () =>
        kaitenClientMock.getLicensingSnapshot(customerId, instanceId),
      );

    reportUsage = (instanceSlug: string, entitlementSlug: string, input: { value: unknown }) =>
      withScope(this.scope, undefined, instanceSlug, () =>
        kaitenClientMock.reportUsage(instanceSlug, entitlementSlug, input),
      );
  };
}
