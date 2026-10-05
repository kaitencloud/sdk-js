import { useKaitenContext } from "../providers/kaiten-provider.tsx";
import { useTrackHook } from "../telemetry/context.tsx";

/**
 * The identity of the nearest provider's data scope.
 *
 * Every key in {@link kaitenKeys} begins with it, so this is what a host needs
 * to address the SDK's cache entries — `mutate(kaitenKeys.components.snapshot(
 * useKaitenScopeKey()))` to force a refresh after its own checkout, for
 * instance. Without it `kaitenKeys` would be exported but unusable.
 *
 * Treat the value as opaque: it is an identity to pass along, not a format to
 * parse. Today it is `public:apiUrl:publishableKey`,
 * `authenticated:apiUrl:customerId:instanceId` or `static:<plan slugs>`; that
 * is an implementation detail.
 */
export function useKaitenScopeKey(): string {
  useTrackHook("useKaitenScopeKey");
  return useKaitenContext().scopeKey;
}
