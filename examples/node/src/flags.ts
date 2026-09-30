import { OFREPProvider } from "@openfeature/ofrep-provider";
import { OpenFeature } from "@openfeature/server-sdk";

/**
 * Registers Kaiten as this process's OpenFeature provider. Call it once, at startup.
 *
 * Kaiten implements OFREP, so OpenFeature's generic OFREP provider evaluates its flags.
 * `apiUrl` keeps its `/api`: the provider appends `/ofrep/v1/...` to it.
 */
export async function configureFlags(
  apiUrl: string,
  token: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  await OpenFeature.setProviderAndWait(
    new OFREPProvider({
      baseUrl: apiUrl,
      headers: [["Authorization", `Bearer ${token}`]],
      ...(fetchImpl ? { fetchImplementation: fetchImpl } : {}),
    }),
  );
}

/** One flag, for one user. On the server, each call is one remote evaluation. */
export async function isEnabled(flagKey: string, targetingKey: string): Promise<boolean> {
  return OpenFeature.getClient().getBooleanValue(flagKey, false, { targetingKey });
}
