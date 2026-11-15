// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useInvoices, useInvoiceSettlement } from "@kaitencloud/react/billing";
import { isHttpUrl } from "@kaitencloud/react/internal";
import { usePortalBillingWords } from "./billing-words.ts";
import { Action } from "./feedback.tsx";

/** Mounted only for INCOMPLETE with the invoice capability. The API supplies the payment page. */
export function PendingPayment({ unstyled, since }: { unstyled: boolean; since: string }) {
  const words = usePortalBillingWords();
  const list = useInvoices();
  const latest = list.invoices.find(
    (invoice) =>
      invoice.kind === "ACTIVATION" && Date.parse(invoice.serviceFrom) >= Date.parse(since),
  );
  const settlement = useInvoiceSettlement({
    invoiceId: latest?.id ?? null,
    activationSince: since,
  });
  const invoice = settlement.invoice ?? latest;
  const payable =
    invoice &&
    (invoice.status === "PUSHED" || invoice.status === "PAYMENT_FAILED") &&
    isHttpUrl(invoice.hostedInvoiceUrl);
  return payable ? (
    <div data-slot="pending-payment" className="ktn-own">
      <Action unstyled={unstyled} variant="default" href={invoice.hostedInvoiceUrl!} external>
        {words.pay}
      </Action>
    </div>
  ) : null;
}
