import * as React from "react";
import useSWR from "swr";

import { KaitenClient } from "@kaitencloud/client";
import type {
  AuthenticatedKaitenProviderConfig,
  KaitenClientLike,
  KaitenPollingConfig,
  KaitenPortal,
  KaitenProviderConfig,
  KaitenSessionClientLike,
  PublicKaitenProviderConfig,
} from "@kaitencloud/client";
import { assertPublishableKey } from "@kaitencloud/client";
import { LocalizationProvider } from "../localization/context.tsx";
import type { KaitenLocalizationOverrides } from "../localization/types.ts";
import { TelemetryProvider } from "../telemetry/context.tsx";
import type { KaitenTelemetryOptions } from "../telemetry/types.ts";
import type {
  KaitenBrandingCapability,
  KaitenCatalog,
  LicensingSnapshot,
  SessionSnapshotMembers,
} from "../types.ts";
import { kaitenKeys } from "../hooks/query-keys.ts";
import type { UseKaitenQueryResult } from "../hooks/use-kaiten-query.ts";
import { snapshotFromPortal } from "../lib/portal-snapshot.ts";
import { createOfflineKaitenClient } from "./static-client.ts";

const DEFAULT_API_URL = "/api";
const DEFAULT_BRANDING: KaitenBrandingCapability = { removable: false };
const NOOP = () => {};

export type KaitenProviderMode = "public" | "authenticated" | "static" | "customer-session";

interface KaitenContextValue {
  /**
   * Identity of this provider's data scope (mode + apiUrl + key/customer). Used
   * to decide whether a nested `<KaitenProvider>` is a redundant duplicate
   * (same scope → reuse) or an intentional second scope (different → own Root).
   */
  scopeKey: string;
  // `KaitenClientLike`, not `KaitenClient`: a host-supplied client (a fixture
  // double, a custom transport) flows through here, and only the five methods
  // of the interface are ever called below. Internal type — this context is not
  // exported.
  client: KaitenClientLike;
  /** The customer-session client, under `mode="customer-session"` only. */
  sessionClient: KaitenSessionClientLike | null;
  mode: KaitenProviderMode;
  apiUrl: string;
  customerId: string | null;
  instanceId: string | null;
  hideBranding: boolean;
  polling: { enabled: boolean; interval: number };
}

interface KaitenDataContextValue {
  catalog: UseKaitenQueryResult<KaitenCatalog>;
  snapshot: UseKaitenQueryResult<LicensingSnapshot & SessionSnapshotMembers>;
  portal: UseKaitenQueryResult<KaitenPortal>;
  branding: KaitenBrandingCapability;
  isLoading: boolean;
  isLoaded: boolean;
  error: Error | null;
  refetch: () => void;
}

const KaitenContext = /* @__PURE__ */ React.createContext<KaitenContextValue | null>(null);
const KaitenDataContext = /* @__PURE__ */ React.createContext<KaitenDataContextValue | null>(null);

function isProduction(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "production";
}

function createDisabledQueryResult<T>(): UseKaitenQueryResult<T> {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    refetch: () => {},
  };
}

// Takes the SWR primitives (not the per-render SWR object) so callers can
// memoize on stable values — see the `catalog`/`snapshot` useMemos.
function toQueryResult<T>(
  data: T | undefined,
  isLoading: boolean,
  error: Error | undefined,
  // SWR's bound mutate returns a Promise; we fire-and-forget it in `refetch`.
  mutate: () => unknown,
): UseKaitenQueryResult<T> {
  return {
    data,
    isLoading,
    error: error ?? null,
    refetch: () => {
      void mutate();
    },
  };
}

/**
 * The policy of every read the provider makes: the catalog, the snapshot and a
 * customer session's portal.
 */
function readOptions<T>(seed: T | undefined, refreshInterval: number) {
  return {
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
    // the polling schedule and on `refetch`; nowhere else.
    revalidateOnReconnect: false,
    // Don't poll a hidden tab or an offline browser (SWR defaults, made
    // explicit) — a backgrounded dashboard stops hammering the API.
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    shouldRetryOnError: false,
    dedupingInterval: 1_000,
  };
}

export function useKaitenContext(): KaitenContextValue {
  const ctx = React.useContext(KaitenContext);
  if (!ctx) {
    throw new Error(
      "useKaitenContext must be used within a <KaitenProvider>. Wrap your component tree with <KaitenProvider>.",
    );
  }
  return ctx;
}

/**
 * The scope of the nearest provider: the same string for every component under it, and for a
 * nested provider of the same scope. `null` outside any provider. For state that the components of
 * one scope share, such as which entry point opened a panel.
 */
export function useKaitenScopeKey(): string | null {
  return React.useContext(KaitenContext)?.scopeKey ?? null;
}

export function useKaitenDataContext(): KaitenDataContextValue {
  const ctx = React.useContext(KaitenDataContext);
  if (!ctx) {
    throw new Error(
      "Kaiten data is unavailable outside <KaitenProvider>. Wrap your component tree with <KaitenProvider>.",
    );
  }

  return ctx;
}

/**
 * Throws when no `<KaitenProvider>` is mounted above the caller.
 *
 * The control primitives (`Show`, `KaitenLoaded`…) call this so a subtree
 * rendered bare fails with the component's own name rather than with the
 * context hook's. Whether the styled components have a `KaitenStyleRoot` above
 * them is `@kaitencloud/react-ui`'s question, asked there.
 */
export function useAssertWrappedByKaitenProvider(componentName: string): void {
  const ctx = React.useContext(KaitenContext);
  if (!ctx) {
    throw new Error(
      `<${componentName}> must be used within a <KaitenProvider>. Wrap your component tree with <KaitenProvider>.`,
    );
  }
}

/**
 * Whether a `<KaitenProvider>` is mounted above this component.
 *
 * Every other hook throws without one — a deliberate choice, since silently
 * returning "not entitled" would gate features by accident. But that makes
 * *conditional* mounting hard: an app rolling Kaiten out behind a flag, a
 * self-hosted edition with no Kaiten account, or a test that renders a subtree
 * bare, all have call sites that must work either way. Branch on this before
 * rendering anything that calls a Kaiten hook:
 *
 * ```tsx
 * function NewProjectButton() {
 *   // Hooks can't be called conditionally, so the branch picks a component.
 *   return useKaitenAvailable() ? <GatedButton /> : <PlainButton />;
 * }
 * ```
 *
 * `Gate` already does this internally, so gating call sites need no fallback.
 */
export function useKaitenAvailable(): boolean {
  return React.useContext(KaitenContext) !== null;
}

/**
 * The catalog, and nothing else.
 *
 * A marketing site has no customer and carries no credential — today because
 * no backend serves a publishable key yet (`mode="public"` ships with billing),
 * and after that because a pricing page fetched server-side or generated at
 * build time needs no browser round-trip at all. This variant takes the
 * `KaitenCatalog` the host already holds and renders it: no key, no client, no
 * request, no polling, and the data is there on the first render — on the
 * server too, since nothing is asynchronous.
 *
 * Swapping it for `mode="public"` when that endpoint exists is a change of
 * config block, not of components: every hook and component reads the same
 * catalog shape either way, and `KaitenScopeProvider` accepts either as its
 * `publicConfig`.
 */
export interface StaticKaitenProviderConfig {
  mode: "static";
  /**
   * What `KaitenClient.getCatalog()` would have returned. Plain data, so it
   * crosses a server/client boundary as a prop. Hoist it out of render — a
   * literal written inline is a new object every render, and every consumer of
   * the provider re-renders with it.
   */
  catalog: KaitenCatalog;
}

/**
 * One customer, signed in to the host's application, through a customer
 * session (`kst_`): their portal — subscription, effective entitlements with
 * their provenance, add-ons, payment method — read from
 * `/public/session/portal`, for a customer portal, a checkout and paywalls.
 *
 * The session comes from the host's backend, which mints it with
 * `createCustomerSession` of `@kaitencloud/server`; the browser never holds a
 * secret. The provider takes the client that carries it rather than building
 * one, so a host that never offers a portal does not ship its code:
 *
 * ```tsx
 * import { KaitenSessionClient } from "@kaitencloud/client";
 *
 * // Once, outside render: the provider's scope follows this object.
 * const sessionClient = new KaitenSessionClient({
 *   apiUrl: "https://kaiten.example.com/api",
 *   getCustomerSession: () => fetch("/billing/session", { method: "POST" }).then((r) => r.json()),
 * });
 *
 * <KaitenProvider mode="customer-session" sessionClient={sessionClient} publishableKey="pk_…">
 * ```
 *
 * The licensing snapshot is built from the portal: `entitlements`, `addOns`
 * and `capabilities` are the portal's, `plans` the catalog's. The portal
 * names the customer, the instance and the licence, but carries none of the
 * ids, audit fields and dates of the SDK's `Customer`, `Instance` and
 * `License`, so `useCustomer`, `useInstance` and `useLicense` answer nothing
 * here and `usePortal` answers what the portal says. Flags and usage reports
 * are not on the session's routes: the snapshot has no flags, and
 * `useReportUsage` refuses before sending anything.
 *
 * Needs the first Kaiten release with billing (see STABILITY.md).
 */
export interface CustomerSessionKaitenProviderConfig {
  mode: "customer-session";
  /**
   * The customer-session client: a `KaitenSessionClient` of
   * `@kaitencloud/client`, or a double implementing `KaitenSessionClientLike`.
   * Create it once, outside render: a new object is a new scope, with its own
   * cache and its own reads.
   */
  sessionClient: KaitenSessionClientLike;
  /**
   * A publishable key, to read the public catalog beside the portal: the plans
   * `usePlans`, `useUpgradeOptions` and a pricing table show. Without it, the
   * scope has no catalog and those answer nothing.
   */
  publishableKey?: string;
  /** Where the catalog is read, with `publishableKey`. Default `/api`. */
  apiUrl?: string;
  /** Polls the portal (on by default, every five minutes) and the catalog (off). */
  polling?: KaitenPollingConfig;
}

/**
 * What every mode takes. Nothing here draws: the provider renders no element of
 * its own, so it can sit at an app's root without joining its layout. The
 * styled components in `@kaitencloud/react-ui` get their scope element, tokens
 * and `appearance` from `KaitenStyleRoot`, mounted where they are.
 */
interface KaitenProviderSharedProps {
  /**
   * The language: a pack from `@kaitencloud/react/locales` (`fr`, `es`, `de`),
   * merged over the English defaults and under `localization`.
   *
   * A pack rather than a name, so the provider carries no language it was not
   * handed — a `locales` map resolved from `"fr"` put every pack in every
   * bundle, English-only hosts included.
   */
  locale?: KaitenLocalizationOverrides;
  /**
   * The host's own strings, on top of the language. Deep: one string of one
   * section is enough, the rest of the section keeps the language's value.
   */
  localization?: KaitenLocalizationOverrides;
  telemetry?: KaitenTelemetryOptions;
  /**
   * Request that the "Powered by Kaiten" branding be hidden.
   *
   * Server-enforced: the branding is hidden only when the active Kaiten license
   * sets `branding.removable === true`. If the license does not allow removal,
   * the branding stays visible regardless of this prop and a
   * `branding.bypass_attempted` telemetry event is emitted.
   */
  hideBranding?: boolean;
  children: React.ReactNode;
}

/** What only a provider that reads from an API can take. Static mode has neither. */
interface KaitenProviderNetworkProps {
  /**
   * Supply your own client instead of having the provider construct one from
   * `apiUrl`/keys — fixture data in tests and Storybook, or a custom
   * transport/cache/SSR arrangement.
   *
   * Typed as `KaitenClientLike` (the five methods a UI consumes) rather than the
   * `KaitenClient` class: the class has a private field, so TypeScript types it
   * nominally and no object could ever satisfy it structurally. Every fake had to
   * end in `as unknown as KaitenClient` — a cast that turns a swapped-in double
   * into an unchecked one. A real `KaitenClient` still fits, since it implements
   * the interface.
   *
   * `@kaitencloud/client/testing` provides a ready-made one.
   */
  client?: KaitenClientLike;
  /**
   * Server-fetched data to render immediately, avoiding a client-side refetch
   * + skeleton flash on first paint. Wire the snapshot/catalog you fetched
   * server-side (e.g. a Next.js Server Component or `getServerSideProps`) here —
   * it seeds SWR's `fallbackData`, then SWR revalidates on the polling schedule.
   *
   * For a catalog that should never be re-read, `mode="static"` is the shorter
   * spelling: no key, no client, and no request under any circumstances.
   */
  initialData?: {
    snapshot?: LicensingSnapshot;
    catalog?: KaitenCatalog;
    /** Under `mode="customer-session"`: the portal your server read with the same session. */
    portal?: KaitenPortal;
  };
}

export type KaitenProviderProps =
  | (KaitenProviderConfig & KaitenProviderSharedProps & KaitenProviderNetworkProps)
  | (CustomerSessionKaitenProviderConfig & KaitenProviderSharedProps & KaitenProviderNetworkProps)
  | (StaticKaitenProviderConfig & KaitenProviderSharedProps);

export type KaitenScopeProviderProps = Pick<
  KaitenProviderProps,
  "locale" | "localization" | "telemetry" | "hideBranding" | "children"
> & {
  /**
   * Configuration used before the host application's user signs in: a public
   * catalog read, or a static catalog the host already holds.
   */
  publicConfig: PublicKaitenProviderConfig | StaticKaitenProviderConfig;
  /**
   * Configuration used once the host application's user has signed in: a
   * customer session, for a vendor's own customers, or the host's own
   * credential (`authenticated`), for an application whose users are members
   * of the organization.
   *
   * Pass `null` or `undefined` to keep rendering the public scope. When it becomes defined,
   * the SDK scope is remounted so SWR data, clients, and portals switch together.
   */
  authenticatedConfig?:
    | AuthenticatedKaitenProviderConfig
    | CustomerSessionKaitenProviderConfig
    | null;
};

// A session client has no identity a string could carry, so each one gets a
// number the first time a scope key is built for it.
const sessionClientIds = new WeakMap<KaitenSessionClientLike, number>();
let nextSessionClientId = 0;

function getProviderScopeKey(
  config: KaitenProviderConfig | CustomerSessionKaitenProviderConfig | StaticKaitenProviderConfig,
): string {
  if (config.mode === "static") {
    // The plans' slugs, in order. Stable across renders for the same data — a
    // catalog literal written inline is a new object every render, and a key
    // built on identity would remount `KaitenScopeProvider` on each one — and
    // different for a different catalog, which is what a nested provider needs
    // to tell a redundant wrapper from a second, intentional scope.
    return `static:${config.catalog.plans.map((plan) => plan.slug).join(",")}`;
  }

  const apiUrl = config.apiUrl ?? DEFAULT_API_URL;

  if (config.mode === "public") {
    return `public:${apiUrl}:${config.publishableKey}`;
  }

  if (config.mode === "customer-session") {
    let id = sessionClientIds.get(config.sessionClient);
    if (id === undefined) sessionClientIds.set(config.sessionClient, (id = nextSessionClientId++));
    return `customer-session:${apiUrl}:${config.publishableKey ?? ""}:${id}`;
  }

  return `authenticated:${apiUrl}:${config.customerId}:${config.instanceId ?? ""}`;
}

export function KaitenProvider(props: KaitenProviderProps) {
  const outerContext = React.useContext(KaitenContext);
  // Multi-scope: a nested provider with the SAME scope is redundant — reuse
  // the outer scope (and warn in dev). A nested provider with a DIFFERENT scope is
  // intentional (admin "my org vs prospect", reseller/B2B2B) — render its own
  // independent Root so SWR data, client and portals are isolated. React context
  // nesting means the nearest provider wins for every consumer below it.
  if (outerContext !== null && outerContext.scopeKey === getProviderScopeKey(props)) {
    return <KaitenProviderPassthrough outerContext={outerContext} {...props} />;
  }
  return <KaitenProviderRoot {...props} />;
}

/**
 * One top-level SDK scope whose config follows the host application's own
 * sign-in: `publicConfig` while nobody is signed in, `authenticatedConfig` once
 * someone is. The scope is remounted when the config changes, so the client and
 * the SWR cache move together and state above the provider is kept.
 *
 * It is named for the scope it switches, not for a session: a customer session
 * (`kst_`) is a credential, and `mode="customer-session"` is how a provider reads
 * with one. A customer session is one of the two things `authenticatedConfig` takes.
 */
export function KaitenScopeProvider({
  publicConfig,
  authenticatedConfig,
  children,
  ...sharedProps
}: KaitenScopeProviderProps) {
  const activeConfig = authenticatedConfig ?? publicConfig;

  return (
    <KaitenProvider key={getProviderScopeKey(activeConfig)} {...activeConfig} {...sharedProps}>
      {children}
    </KaitenProvider>
  );
}

function KaitenProviderPassthrough({
  children,
}: KaitenProviderProps & { outerContext: KaitenContextValue }) {
  // Only reached when the nested provider's scope is IDENTICAL to the outer one
  // (same mode + apiUrl + key/customer) — i.e. a redundant double-wrap. Reuse the
  // outer scope and warn in dev. A *different* config renders its own Root instead
  // (see KaitenProvider), so intentional multi-scope is supported.
  React.useEffect(() => {
    if (isProduction()) return;
    console.warn(
      "[@kaitencloud/react] Redundant nested <KaitenProvider> with an identical config detected — the inner one is a no-op. Remove it. (Two providers with *different* configs each get their own scope.)",
    );
  }, []);

  return <>{children}</>;
}

function KaitenProviderRoot(props: KaitenProviderProps) {
  const { children, locale, localization, telemetry, hideBranding = false } = props;
  const mode: KaitenProviderMode = props.mode;

  // Static mode has no API: nothing to resolve a URL against, no auth scheme,
  // no token, no host client, no seed. Each is read below only where a client
  // has to be built or a read has to be seeded, which static mode never does.
  const staticCatalog = props.mode === "static" ? props.catalog : undefined;
  const hostClient = props.mode === "static" ? undefined : props.client;
  const initialData = props.mode === "static" ? undefined : props.initialData;
  const apiUrl = props.mode === "static" ? "" : (props.apiUrl ?? DEFAULT_API_URL);
  const sessionProps = props.mode === "customer-session" ? props : null;
  const sessionClient = sessionProps?.sessionClient ?? null;
  // A customer-session scope reads its catalog the way a public one does: with
  // a publishable key, from `/public/catalog`.
  const authScheme =
    props.mode === "authenticated" ? ("bearer" as const) : ("publishable" as const);
  const authToken =
    props.mode === "public" || props.mode === "customer-session"
      ? props.publishableKey
      : props.mode === "authenticated"
        ? props.accessToken
        : undefined;
  const onAuthError = props.mode === "authenticated" ? props.onAuthError : undefined;
  const onDegraded =
    props.mode === "public" || props.mode === "authenticated" ? props.onDegraded : undefined;

  // `accessToken` may be a function, and hosts will pass an inline arrow. Reading
  // the latest one through a ref keeps the client — and therefore the SWR cache
  // and every in-flight request — stable across renders; memoizing on the
  // function identity instead would rebuild the client every render and refetch
  // forever. `authTokenKey` is what the memo actually depends on: the string when
  // one was given, a constant when a provider function was.
  const authTokenRef = React.useRef(authToken);
  authTokenRef.current = authToken;
  const onAuthErrorRef = React.useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;
  // Same ref treatment as `onAuthError`, for the same reason: hosts pass an
  // inline arrow, and depending on its identity would rebuild the client — and
  // with it the SWR cache and every in-flight request — on every render.
  const onDegradedRef = React.useRef(onDegraded);
  onDegradedRef.current = onDegraded;
  const authTokenKey = typeof authToken === "function" ? "\0token-provider" : authToken;

  const client = React.useMemo<KaitenClientLike>(() => {
    if (staticCatalog) {
      // Given the catalog, the provider owes nothing to the network. The client
      // it hands the hooks answers the catalog and rejects every live read,
      // naming the mode — see static-client.ts.
      return createOfflineKaitenClient("static", staticCatalog);
    }

    if (hostClient) {
      return hostClient;
    }

    if (sessionClient && authTokenKey === undefined) {
      // A customer session with no publishable key has no catalog to read, and
      // its session reaches no other route.
      return createOfflineKaitenClient("customer-session");
    }

    if (authScheme === "publishable") {
      // Public mode takes a literal key: a publishable key is static by design,
      // and the guard has to see the value to reject an `sk_` in the browser.
      assertPublishableKey(authTokenRef.current as string);
    }

    return new KaitenClient({
      apiUrl,
      tokenProvider: () => {
        const token = authTokenRef.current;
        // Only ever `undefined` in static mode, which never reaches this client.
        return typeof token === "function" ? token() : (token ?? "");
      },
      authScheme,
      onAuthError: (info) => onAuthErrorRef.current?.(info),
      onDegraded: (info) => onDegradedRef.current?.(info),
    });
  }, [staticCatalog, hostClient, sessionClient, apiUrl, authScheme, authTokenKey]);

  const authenticatedProps = props.mode === "authenticated" ? props : null;
  // The catalog is read in public mode, and beside the portal when a customer
  // session was given a key (or a client) to read it with.
  const readsCatalog =
    props.mode === "public" ||
    (sessionProps !== null && (authTokenKey !== undefined || !!hostClient));

  // Declared before the reads below: it prefixes every SWR key, which is what
  // keeps two providers on different customers out of each other's cache.
  const scopeKey = getProviderScopeKey(props);

  const pollingEnabled = props.mode === "static" ? undefined : props.polling?.enabled;
  const pollingInterval = props.mode === "static" ? undefined : props.polling?.interval;
  const pollingConfig = React.useMemo(
    () => ({
      // On by default only where there is usage to watch. The snapshot carries a
      // customer's consumption, which other actors move — a report from the
      // host's backend, a plan change in the console. The catalog is the plans
      // on offer, which change on a release: a public pricing page re-fetching
      // it every five minutes per open tab bought a request and nothing else.
      // Static mode has no request to make at all.
      enabled: pollingEnabled ?? (mode === "authenticated" || mode === "customer-session"),
      // Licensing data is near-static (limits/plans change rarely; local usage
      // reports refresh immediately via the mutation→revalidate path), and each
      // poll re-runs the whole composed snapshot — so default to a conservative
      // 5min. Apps that need faster cross-actor usage refresh pass a smaller
      // `interval` (a demo may opt into a few seconds).
      interval: pollingInterval ?? 300_000,
    }),
    [mode, pollingEnabled, pollingInterval],
  );

  const refreshInterval = pollingConfig.enabled ? pollingConfig.interval : 0;
  const catalogSWR = useSWR<KaitenCatalog, Error>(
    readsCatalog ? kaitenKeys.components.catalog(scopeKey) : null,
    () => client.getCatalog(),
    // A customer session polls its portal; the catalog beside it does not move
    // with the customer's usage.
    readOptions(initialData?.catalog, sessionClient ? 0 : refreshInterval),
  );

  const snapshotSWR = useSWR<LicensingSnapshot, Error>(
    authenticatedProps ? kaitenKeys.components.snapshot(scopeKey) : null,
    () =>
      client.getLicensingSnapshot(authenticatedProps!.customerId, authenticatedProps!.instanceId),
    readOptions(initialData?.snapshot, refreshInterval),
  );

  // A customer session's one read, in place of the snapshot.
  const portalSWR = useSWR<KaitenPortal, Error>(
    sessionClient ? kaitenKeys.components.portal(scopeKey) : null,
    () => sessionClient!.getPortal(),
    readOptions(initialData?.portal, refreshInterval),
  );

  // Stabilize the query-result wrappers: useSWR returns a fresh object
  // every render, so building `catalog`/`snapshot` inline gave them a new
  // identity each render — defeating the `dataValue` useMemo below and
  // re-rendering every consumer on every poll tick. Memoize on the SWR
  // primitives instead, so the context value only changes when data actually does.
  const {
    data: catalogData,
    isLoading: catalogIsLoading,
    error: catalogError,
    mutate: catalogMutate,
  } = catalogSWR;
  const catalog = React.useMemo<UseKaitenQueryResult<KaitenCatalog>>(() => {
    if (staticCatalog) {
      // Known before the first render, so it is never loading and cannot fail,
      // and `refetch` has nothing to re-read. The server renders the same answer.
      return { data: staticCatalog, isLoading: false, error: null, refetch: NOOP };
    }
    return readsCatalog
      ? toQueryResult(catalogData, catalogIsLoading, catalogError, catalogMutate)
      : createDisabledQueryResult<KaitenCatalog>();
  }, [readsCatalog, staticCatalog, catalogData, catalogError, catalogIsLoading, catalogMutate]);

  const {
    data: portalData,
    isLoading: portalIsLoading,
    error: portalError,
    mutate: portalMutate,
  } = portalSWR;
  const portal = React.useMemo<UseKaitenQueryResult<KaitenPortal>>(
    () =>
      sessionClient
        ? toQueryResult(portalData, portalIsLoading, portalError, portalMutate)
        : createDisabledQueryResult<KaitenPortal>(),
    [sessionClient, portalData, portalError, portalIsLoading, portalMutate],
  );

  const {
    data: snapshotData,
    isLoading: snapshotIsLoading,
    error: snapshotError,
    mutate: snapshotMutate,
  } = snapshotSWR;
  const snapshot = React.useMemo<
    UseKaitenQueryResult<LicensingSnapshot & SessionSnapshotMembers>
  >(() => {
    if (sessionClient) {
      // A customer session's snapshot is its portal, read once, with the plans
      // of the catalog beside it.
      return {
        ...portal,
        data: portalData && snapshotFromPortal(portalData, catalogData),
      };
    }
    return mode === "authenticated"
      ? toQueryResult(snapshotData, snapshotIsLoading, snapshotError, snapshotMutate)
      : createDisabledQueryResult<LicensingSnapshot>();
  }, [
    mode,
    sessionClient,
    portal,
    portalData,
    catalogData,
    snapshotData,
    snapshotError,
    snapshotIsLoading,
    snapshotMutate,
  ]);

  // The read this scope lives on: the snapshot for a customer — read, or built
  // from a customer session's portal — the catalog for everyone else: fetched
  // in public mode, given in static mode.
  const active = mode === "authenticated" || sessionClient ? snapshot : catalog;
  const activeData = active.data;
  const activeError = active.error;
  const activeLoading = active.isLoading;

  const ctxValue = React.useMemo<KaitenContextValue>(
    () => ({
      scopeKey,
      client,
      sessionClient,
      mode,
      apiUrl,
      customerId: authenticatedProps?.customerId ?? null,
      instanceId: authenticatedProps?.instanceId ?? null,
      hideBranding,
      polling: pollingConfig,
    }),
    [
      apiUrl,
      authenticatedProps?.customerId,
      authenticatedProps?.instanceId,
      client,
      hideBranding,
      mode,
      pollingConfig,
      scopeKey,
      sessionClient,
    ],
  );

  const dataValue = React.useMemo<KaitenDataContextValue>(
    () => ({
      catalog,
      snapshot,
      portal,
      branding: activeData?.branding ?? DEFAULT_BRANDING,
      isLoading: activeLoading,
      isLoaded: !activeLoading && !activeError && activeData !== undefined,
      error: activeError,
      refetch: active.refetch,
    }),
    [active.refetch, activeData, activeError, activeLoading, catalog, snapshot, portal],
  );

  // Context only. The element every SDK style is scoped to — `<div class="kaiten">`
  // with the `--ktn-*` tokens — is `KaitenStyleRoot` in `@kaitencloud/react-ui`,
  // mounted by the host around the subtree that draws. A host that gates its own
  // UI with hooks and `Gate` never renders one, and pays no DOM for the provider.
  return (
    <KaitenContext.Provider value={ctxValue}>
      <KaitenDataContext.Provider value={dataValue}>
        <LocalizationProvider locale={locale} localization={localization}>
          <TelemetryProvider telemetry={telemetry}>{children}</TelemetryProvider>
        </LocalizationProvider>
      </KaitenDataContext.Provider>
    </KaitenContext.Provider>
  );
}
