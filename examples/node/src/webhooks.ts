import type { IncomingHttpHeaders } from "node:http";

import { verifyKaitenWebhook } from "@kaitencloud/server";

export interface WebhookResult {
  status: number;
  body: string;
}

/**
 * Verifies a webhook before acting on it. Until its signature is checked, the
 * endpoint is unauthenticated, and it drives licences and usage. The payload must
 * be the raw request body: JSON that was parsed and serialised again no longer
 * matches the signature.
 */
export async function handleWebhook(
  payload: string,
  headers: IncomingHttpHeaders,
  secret: string,
): Promise<WebhookResult> {
  try {
    const event = await verifyKaitenWebhook({ payload, headers, secret });
    // A real handler switches on `event.type` here and updates its own records.
    return { status: 200, body: event.type };
  } catch {
    return { status: 401, body: "invalid signature" };
  }
}
