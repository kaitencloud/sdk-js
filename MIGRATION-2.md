# 2.0 migration: OpenFeature owns flag evaluation

**BREAKING:** Kaiten SDKs manage licenses, entitlements, usage and flag definitions.
They do not evaluate flags. Use an OpenFeature SDK with its **official OFREP provider**
for every flag decision. This requires a major release of `@kaitencloud/client`,
`@kaitencloud/server`, `@kaitencloud/react` and `@kaitencloud/react-ui`.
Already-published 1.x packages, changelogs and historical consumer fixtures remain
unchanged; there are no deprecated methods or compatibility aliases in the current API.

## Removed APIs

- Client: `KaitenClient.evaluateFlag`, `KaitenClient.evaluateFlags`, `client.flags`
  (`evaluate`, `evaluateAll`), and evaluation members of `KaitenClientLike`.
- Client types/helpers: `KaitenFlagsModule`, `FeatureFlagEvaluation`,
  `BulkEvaluationResponse`, `EvaluationResult`, curated `EvaluationSuccess` /
  `EvaluationFailure`, `isEvaluationSuccess` and `isEvaluationFailure`.
- Generated client namespace: `KaitenApi.evaluateFlag`,
  `KaitenApi.evaluateFlagsBulk` and their operation-specific types.
- Generated server: `OfrepCore` (both `evaluateFlag` and `evaluateFlagsBulk`),
  and the `EvaluateFlag*` / `EvaluateFlagsBulk*` operation-specific types.
- React (including React UI's re-exports): `useFeatureFlag`, `useFeatureFlags`,
  evaluation helper/type re-exports, and `kaitenKeys.featureFlag`.
- React flag decision branches: `Show`'s `when="flag-enabled"` / `"flag-disabled"`,
  `Gate.flagKey`, `usePaywallTrigger`'s `flagKey`, and `Paywall.flagKey`.

`getLicensingSnapshot` and `components.getSnapshot` no longer make implicit OFREP
requests. Their `flags` display list is empty on both GraphQL and REST paths.
`ResolvedFeatureFlag`, host-supplied snapshot display data, `useFlags` and
`FlagsSummary` remain presentation-only; do not use them to decide access.
`Show`, `Gate` and `Paywall` still gate **entitlements**. Combine that separately
with an OpenFeature flag result in your application.

Flag CRUD, generated management exports, license/entitlement/usage APIs, caller-owned
fetch implementations, authentication callbacks, base URLs and customer/instance
ownership checks are unchanged. The OFREP protocol, server routes and OpenAPI
snapshot are not removed. Generator operation filters prevent SDK escape hatches;
regenerate with each package's `generate` script rather than editing generated code.

## Backend: official server SDK and provider

```sh
npm install @openfeature/server-sdk @openfeature/ofrep-provider
```

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { OFREPProvider } from "@openfeature/ofrep-provider";

// Once at process startup. Use your configured API URL, including its /api path
// and any gateway prefix. No host guessing or fallback to a different server.
await OpenFeature.setProviderAndWait(
  "kaiten",
  new OFREPProvider({
    baseUrl: process.env.KAITEN_API_URL!,
    headersFactory: async () => [["Authorization", `Bearer ${await loadServerToken()}`]],
  }),
);
const flags = OpenFeature.getClient("kaiten");

// Inside an authenticated request. Derive these from the authorized principal
// and an instance you have checked belongs to that customer, never a browser's
// arbitrary query/context or org header. The bearer token scopes the organization.
const details = await flags.getBooleanDetails("premium-feature", false, {
  targetingKey: principal.customerSlug,
  kaiten: { instanceSlug: authorizedInstance.slug },
});
if (details.errorCode || !details.value) {
  // Deny / use the safe default. Do not return auth or provider details to a browser.
  return unavailableFeature();
}
```

`loadServerToken`, `principal`, `authorizedInstance` and `unavailableFeature` above
are application responsibilities, not new Kaiten APIs. Keep the credential server-side
and read-only (`read:feature_flags`). Use the provider's `fetchImplementation` option
if the application owns HTTP policy; the Kaiten SDK never disposes or replaces it.
Use distinct OpenFeature domains/providers for distinct organizations and never
change a process-global context/token to follow individual requests. Server context
is passed **per evaluation**, so concurrent identities cannot contaminate each other.
Choose defaults for each flag explicitly, including non-boolean flags; OpenFeature
returns defaults on evaluation errors, so inspect detailed results for diagnostics.
The application owns provider startup/shutdown and sanitized telemetry/hooks.

The [Node example](examples/node/src/flags.ts) uses these official packages and has
an isolated loopback integration test. Its unauthenticated HTTP sample evaluates only
`anonymous`; it deliberately does not accept a query parameter to impersonate a customer.

## Browser and React

The official packages are:

- Browser: `@openfeature/web-sdk` + `@openfeature/ofrep-web-provider`
  (`OFREPWebProvider`).
- React: `@openfeature/react-sdk` + its peer `@openfeature/web-sdk` +
  `@openfeature/ofrep-web-provider` (`OFREPWebProvider`). The React SDK re-exports
  the OpenFeature Web API and provides `OpenFeatureProvider` and
  `useBooleanFlagDetails` / `useBooleanFlagValue`.

**Never put a Kaiten `ksh_` token in browser configuration, a bundle, localStorage or
an example environment file.** A publishable key or `kst_` customer session is not
an OFREP credential. Only connect a browser provider to an OFREP endpoint whose
browser-safe authentication, origin policy and identity/context authorization you
have explicitly configured. Otherwise evaluate on the backend using the server
SDK/provider; do not invent an HTTP evaluation wrapper or custom provider.

For an already-authorized browser-safe endpoint, initialize once outside React render:

```tsx
import { OpenFeature, OpenFeatureProvider, useBooleanFlagDetails } from "@openfeature/react-sdk";
import { OFREPWebProvider } from "@openfeature/ofrep-web-provider";

await OpenFeature.setProviderAndWait(
  "app",
  new OFREPWebProvider({
    baseUrl: browserSafeOfrepUrl,
    fetchImplementation: authorizedBrowserFetch,
  }),
);

function Feature() {
  const decision = useBooleanFlagDetails("premium-feature", false);
  return !decision.errorCode && decision.value ? <PremiumFeature /> : null;
}

function App() {
  return (
    <OpenFeatureProvider domain="app">
      <Feature />
    </OpenFeatureProvider>
  );
}
```

`browserSafeOfrepUrl` and `authorizedBrowserFetch` are application-owned, not Kaiten
credential helpers. The Web provider evaluates bulk context and may cache results;
use the official SDK's context reconciliation and a separate provider/domain for
identity scopes. UI flags are not authorization: enforce entitlement and flag access
again on the backend. This repository does not install browser OFREP packages or
claim that Kaiten's secret-authenticated endpoint is browser-safe.

Official references:
[server provider](https://github.com/open-feature/js-sdk-contrib/tree/main/libs/providers/ofrep),
[Web provider](https://github.com/open-feature/js-sdk-contrib/tree/main/libs/providers/ofrep-web),
[React SDK](https://github.com/open-feature/js-sdk/tree/main/packages/react).

## Verification and historical compatibility

Build before tests: `vp run -r build && vp check && vp test`.
Run both `generate` scripts and check regeneration is idempotent. Negative runtime
and TypeScript checks ensure direct evaluation cannot return, including generated
namespaces and mock clients. Management contract coverage excludes only the two
OFREP evaluation paths and asserts they still exist in the protocol snapshot.

`check:compat-1.0` still verifies the immutable historical consumer against the
immutable published 1.0.0 tarball. It now verifies a current **management** consumer
against this tree and permits only the named breaking policy removals. The checker
requires major-release metadata for all four affected packages. It must not restore
an evaluation alias to satisfy historical code, rewrite the historical consumer,
unpublish a package or release this as a patch/minor.
