import * as React from "react";

import { useInvoices, useInvoiceSettlement } from "@kaitencloud/react/billing";
import { useLocalization, usePortal, type KaitenPortalBillingWords } from "@kaitencloud/react";
import type { SessionInvoice } from "@kaitencloud/react";
import { isHttpUrl, useTrackComponent } from "@kaitencloud/react/internal";

import { useMergedAppearance } from "../../../appearance/context.tsx";
import type { KaitenAppearance } from "../../../appearance/types.ts";
import { cn } from "../../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../../style-root/kaiten-style-root.tsx";
import { usePortalBillingWords } from "../../shared/billing-words.ts";
import { Action } from "../../shared/feedback.tsx";
import { KaitenBranding } from "../../shared/kaiten-branding.tsx";
import { SectionError } from "../../shared/section-error.tsx";
import { Badge } from "../../ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";

type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "outline";

/** What an invoice's status is called, and how loudly. An unknown status is said as the API wrote it. */
function statusOf(
  status: string,
  words: KaitenPortalBillingWords,
): { label: string; variant: BadgeVariant } {
  switch (status) {
    case "PAID":
      return { label: words.statusPaid, variant: "success" };
    case "PUSHED":
      return { label: words.statusPushed, variant: "secondary" };
    case "PAYMENT_FAILED":
      return { label: words.statusFailed, variant: "destructive" };
    case "MANUAL":
      return { label: words.statusManual, variant: "outline" };
    case "UNCOLLECTIBLE":
      return { label: words.statusUncollectible, variant: "outline" };
    case "VOID":
      return { label: words.statusVoid, variant: "outline" };
    default:
      return { label: status, variant: "outline" };
  }
}

function kindOf(kind: string, words: KaitenPortalBillingWords): string {
  switch (kind) {
    case "ACTIVATION":
      return words.kindActivation;
    case "RENEWAL":
      return words.kindRenewal;
    case "FINAL":
      return words.kindFinal;
    default:
      return kind;
  }
}

/**
 * Where a customer pays an invoice: the two that are open. An invoice waiting for the customer to
 * confirm a payment (3-D Secure) reads as a failed one in the list, and is paid at the same
 * address: nothing in the invoice tells them apart yet.
 */
const isPayable = (invoice: SessionInvoice) =>
  (invoice.status === "PUSHED" || invoice.status === "PAYMENT_FAILED") &&
  isHttpUrl(invoice.hostedInvoiceUrl);

/** What an invoice is called: the provider's number, else the vendor's own for one billed outside a provider. */
const referenceOf = (invoice: SessionInvoice) =>
  invoice.providerInvoiceNumber ?? invoice.externalReference;

export interface InvoiceListProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
  /** How many invoices a page holds. Default 20. */
  pageSize?: number;
}

// Memoized: guards against host-driven re-renders with unchanged props.
export const InvoiceList = /* @__PURE__ */ React.memo(InvoiceListImpl);

/**
 * The customer's invoices under `mode="customer-session"`, newest first as the API serves them:
 * the reference, what it covers, what it totals as the server computed it, its status, a link to
 * pay it while it is open and one to its PDF. Nothing under any other mode, and nothing when the
 * portal says the customer's invoices are not theirs to see (`capabilities.invoices`).
 *
 * Needs the first Kaiten release with billing.
 *
 * @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path.
 */
function InvoiceListImpl({ appearance, unstyled = false, pageSize }: InvoiceListProps) {
  useAssertWrappedByKaitenProvider("InvoiceList");
  useTrackComponent("InvoiceList");

  const merged = useMergedAppearance(appearance);
  const localization = useLocalization();
  const words = usePortalBillingWords();
  const portal = usePortal();
  const allowed = portal.data?.capabilities.invoices === true;
  const list = useInvoices({ limit: pageSize, enabled: allowed });

  // The customer who went to pay one is waited on: when it is paid, the list is read again.
  const [paying, setPaying] = React.useState<string | null>(null);
  useInvoiceSettlement({ invoiceId: paying, enabled: paying !== null });

  if (portal.isLoading || (allowed && list.isLoading)) {
    return (
      <Card className={cn(merged.elements?.card)} aria-busy="true">
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
        <KaitenBranding className="-mb-6" />
      </Card>
    );
  }
  if (!allowed) return null;
  if (list.error && list.invoices.length === 0) {
    return <SectionError onRetry={list.refetch} appearance={merged} unstyled={unstyled} />;
  }

  const money = (invoice: SessionInvoice) =>
    localization.formatMoney(invoice.total, invoice.currencyCode);

  if (unstyled) {
    return (
      <section data-slot="invoices" className="ktn-own">
        <h3>{words.invoices}</h3>
        {list.invoices.length === 0 ? (
          <p>{words.noInvoices}</p>
        ) : (
          <ul>
            {list.invoices.map((invoice) => {
              const reference = referenceOf(invoice);
              const title = reference ?? kindOf(invoice.kind, words);
              return (
                <li key={invoice.id} data-status={invoice.status}>
                  <span>{title}</span>{" "}
                  <span>{words.invoicePeriod(invoice.serviceFrom, invoice.serviceTo)}</span>{" "}
                  <span>{money(invoice)}</span> <span>{statusOf(invoice.status, words).label}</span>
                  {isPayable(invoice) ? (
                    <>
                      {" "}
                      <a
                        href={invoice.hostedInvoiceUrl ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${words.pay} ${title}`}
                        onClick={() => setPaying(invoice.id)}
                      >
                        {words.pay}
                      </a>
                    </>
                  ) : null}
                  {isHttpUrl(invoice.invoicePdfUrl) ? (
                    <>
                      {" "}
                      <a
                        href={invoice.invoicePdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${words.pdf} ${title}`}
                      >
                        {words.pdf}
                      </a>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {list.hasMore ? (
          <button type="button" disabled={list.isLoadingMore} onClick={list.loadMore}>
            {words.loadMore}
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <Card className={cn(merged.elements?.card)}>
      <CardHeader className={cn(merged.elements?.cardHeader)}>
        <CardTitle className={cn(merged.elements?.cardTitle)}>{words.invoices}</CardTitle>
      </CardHeader>
      <CardContent className={cn("flex flex-col gap-3", merged.elements?.cardContent)}>
        {list.invoices.length === 0 ? (
          <p className="text-sm text-ktn-muted-foreground">{words.noInvoices}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.invoices.map((invoice) => {
              const reference = referenceOf(invoice);
              const title = reference ?? kindOf(invoice.kind, words);
              const status = statusOf(invoice.status, words);
              return (
                <li
                  key={invoice.id}
                  data-slot="invoice"
                  data-status={invoice.status}
                  className="ktn-own flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-ktn-lg border border-ktn-border p-4"
                >
                  {/* The status is said beside the invoice it describes, and the actions stand
                      apart with the amount: next to "Pay", a filled "Payment failed" read as a
                      second, shorter button. */}
                  <div className="ktn-own flex min-w-0 flex-col gap-1">
                    <span className="ktn-own flex flex-wrap items-center gap-2">
                      <span className="ktn-own min-w-0 font-medium break-words">{title}</span>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </span>
                    <span className="ktn-own text-xs text-ktn-muted-foreground">
                      {reference ? `${kindOf(invoice.kind, words)} · ` : ""}
                      {words.invoicePeriod(invoice.serviceFrom, invoice.serviceTo)}
                    </span>
                  </div>
                  <div className="ktn-own flex flex-wrap items-center gap-2">
                    <span className="ktn-own text-sm font-medium">{money(invoice)}</span>
                    {isPayable(invoice) ? (
                      <Action
                        unstyled={false}
                        variant="default"
                        href={invoice.hostedInvoiceUrl ?? undefined}
                        external
                        size="sm"
                        label={`${words.pay} ${title}`}
                        onClick={() => setPaying(invoice.id)}
                      >
                        {words.pay}
                      </Action>
                    ) : null}
                    {isHttpUrl(invoice.invoicePdfUrl) ? (
                      <Action
                        unstyled={false}
                        variant="outline"
                        href={invoice.invoicePdfUrl}
                        external
                        size="sm"
                        label={`${words.pdf} ${title}`}
                      >
                        {words.pdf}
                      </Action>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {list.hasMore ? (
          <Action
            unstyled={false}
            variant="outline"
            size="sm"
            disabled={list.isLoadingMore}
            onClick={list.loadMore}
          >
            {words.loadMore}
          </Action>
        ) : null}
      </CardContent>
      <KaitenBranding className="-mb-6" />
    </Card>
  );
}
