import { KaitenClient } from "@kaitencloud/client";
import type { KaitenCatalog, KaitenClientLike } from "@kaitencloud/client";

/**
 * A client that reads the catalog with a read-only `ksh_` token. It runs here, on
 * the server: outside a browser the transport accepts a bearer credential, and the
 * token never reaches the page.
 */
export function createCatalogClient(apiUrl: string, token: string): KaitenClientLike {
  return new KaitenClient({ apiUrl, authScheme: "bearer", tokenProvider: () => token });
}

/**
 * The catalog a pricing page renders, as plain data the page can embed as it is.
 */
export async function readCatalog(
  client: Pick<KaitenClientLike, "getCatalog">,
): Promise<KaitenCatalog> {
  return client.getCatalog();
}
