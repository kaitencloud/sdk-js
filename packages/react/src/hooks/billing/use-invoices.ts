import * as React from "react";
import { useSWRConfig } from "swr";

import type { KaitenPage, SessionInvoice } from "@kaitencloud/client";

import { useKaitenContext } from "../../providers/kaiten-provider.tsx";
import { useTrackHook } from "../../telemetry/context.tsx";
import { useKaitenQuery } from "../use-kaiten-query.ts";
import { invalidateInvoices, invalidatePortal, invoicesKey } from "./invalidate.ts";

export interface UseInvoicesOptions {
  /** How many invoices a page holds. Default 20. */
  limit?: number;
  /** `false` reads nothing. Default `true`. */
  enabled?: boolean;
}

export interface UseInvoicesResult {
  /** The invoices read so far, newest first: the first page, then every page `loadMore` brought. */
  invoices: SessionInvoice[];
  /** Whether there are older invoices than the ones in `invoices`. */
  hasMore: boolean;
  /** `true` while the first page is read. */
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  /** Reads the next page, after the last invoice held. Nothing when there is none. */
  loadMore: () => void;
  /** Reads the first page again, and drops the others: what a change just made is in it. */
  refetch: () => void;
}

/**
 * The customer's issued invoices, newest first, paged, under `mode="customer-session"`.
 *
 * Their amounts are the server's: nothing here adds an invoice up. Where a customer pays one
 * is `hostedInvoiceUrl`, and its PDF `invoicePdfUrl`. Under any other mode there is no
 * session to read with, and the list stays empty and not loading.
 *
 * @experimental Until Kaiten billing ships (see STABILITY.md).
 */
export function useInvoices(options: UseInvoicesOptions = {}): UseInvoicesResult {
  useTrackHook("useInvoices");

  const { sessionClient, scopeKey } = useKaitenContext();
  const limit = options.limit ?? 20;
  const first = useKaitenQuery<KaitenPage<SessionInvoice>>({
    queryKey: invoicesKey(scopeKey, limit),
    queryFn: () => sessionClient!.listInvoices({ limit }),
    enabled: sessionClient !== null && (options.enabled ?? true),
    // Read on mount, and again when something changes them: not on the portal's schedule.
    refetchInterval: 0,
  });

  // The pages after the first, which a revalidation of the first does not know about. They
  // are dropped when the first page's content changed under them, and kept when it did not.
  const [later, setLater] = React.useState<{
    signature: string;
    items: SessionInvoice[];
    next: string | undefined;
  } | null>(null);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [moreError, setMoreError] = React.useState<Error | null>(null);

  const page = first.data;
  const signature = page
    ? page.items.map((invoice) => `${invoice.id}:${invoice.status}`).join()
    : "";
  const current = later !== null && later.signature === signature ? later : null;

  const invoices = React.useMemo(() => {
    if (!page) return [];
    const seen = new Set(page.items.map((invoice) => invoice.id));
    return [...page.items, ...(current?.items ?? []).filter((invoice) => !seen.has(invoice.id))];
  }, [page, current]);

  const nextCursor = current ? current.next : page?.hasMore ? page.nextCursor : undefined;
  const hasMore = nextCursor !== undefined;

  const loadMore = React.useCallback(() => {
    if (!sessionClient || nextCursor === undefined || isLoadingMore) return;
    setIsLoadingMore(true);
    setMoreError(null);
    sessionClient.listInvoices({ cursor: nextCursor, limit }).then(
      (next) => {
        setLater((previous) => ({
          signature,
          items: [...(previous?.signature === signature ? previous.items : []), ...next.items],
          next: next.hasMore ? next.nextCursor : undefined,
        }));
        setIsLoadingMore(false);
      },
      (error: unknown) => {
        setMoreError(error instanceof Error ? error : new Error(String(error)));
        setIsLoadingMore(false);
      },
    );
  }, [sessionClient, nextCursor, isLoadingMore, limit, signature]);

  const { refetch } = first;
  const reload = React.useCallback(() => {
    setLater(null);
    refetch();
  }, [refetch]);

  return {
    invoices,
    hasMore,
    isLoading: first.isLoading,
    isLoadingMore,
    error: first.error ?? moreError,
    loadMore,
    refetch: reload,
  };
}

/** How many pages of invoices a wait reads to find its invoice: the 20 newest by default, five times over. */
const SETTLEMENT_MAX_PAGES = 5;

/** Every 5 seconds, and for 10 minutes: what a checkout that did not settle waits on. */
export const DEFAULT_SETTLEMENT_INTERVAL_MS = 5_000;
export const DEFAULT_SETTLEMENT_GIVE_UP_MS = 10 * 60_000;

export interface UseInvoiceSettlementOptions {
  /**
   * The invoice to wait on: the activation invoice of a checkout. Without it, the newest
   * activation invoice of the customer.
   */
  invoiceId?: string | null;
  /** `false` waits on nothing. Default `true`. */
  enabled?: boolean;
  /** Pause between two reads. Default 5 seconds. */
  intervalMs?: number;
  /** When to stop reading on a schedule. Default 10 minutes. */
  giveUpAfterMs?: number;
  /**
   * Stops reading when the invoice turns `PAYMENT_FAILED`, and says so with the status
   * `failed`. For a payment that was not known to have failed when the wait began; a
   * payment that needs the customer sits in that state until they act, and keeps being read.
   * Default `false`.
   */
  stopOnFailure?: boolean;
}

export interface InvoiceSettlement {
  /**
   * `idle` when there is nothing to wait on, `polling` while the invoice is read on a
   * schedule, `paid` once it is, `failed` when its payment failed (only with `stopOnFailure`),
   * and `gave_up` when the schedule ran out first: the invoice is then read once more each
   * time the window takes focus.
   */
  status: "idle" | "polling" | "paid" | "failed" | "gave_up";
  /** The invoice as last read, `null` before the first read finds it. */
  invoice: SessionInvoice | null;
  /** Reads the invoices once now, whatever the schedule says. */
  check: () => void;
}

/**
 * Waits for an invoice to be paid, for a payment that did not settle in the checkout's
 * answer: a customer who had to confirm it on the provider's page (`requires_action`), or a
 * payment whose outcome is not known yet (`processing`). The provider's hosted invoice page
 * brings nobody back, so the invoices are read every 5 seconds until the invoice is `PAID`,
 * for 10 minutes, and then once each time the window takes focus.
 *
 * Each read refreshes the invoice from the provider on the API's side, so the first one
 * after the customer paid sees it. When it is paid, the portal and the invoices every other
 * hook holds are read again.
 *
 * @experimental Until Kaiten billing ships (see STABILITY.md).
 */
export function useInvoiceSettlement(options: UseInvoiceSettlementOptions = {}): InvoiceSettlement {
  useTrackHook("useInvoiceSettlement");

  const {
    invoiceId = null,
    enabled = true,
    intervalMs = DEFAULT_SETTLEMENT_INTERVAL_MS,
    giveUpAfterMs = DEFAULT_SETTLEMENT_GIVE_UP_MS,
    stopOnFailure = false,
  } = options;
  const { sessionClient, scopeKey } = useKaitenContext();
  const { mutate } = useSWRConfig();
  const [state, setState] = React.useState<Pick<InvoiceSettlement, "status" | "invoice">>({
    status: "idle",
    invoice: null,
  });
  const active = enabled && sessionClient !== null;
  const reading = React.useRef(false);

  /** One read. Resolves to whether the wait is over: paid, or failed when that ends it. A read that fails is a read that found nothing. */
  const read = React.useCallback(async (): Promise<boolean> => {
    if (!sessionClient || reading.current) return false;
    reading.current = true;
    try {
      // The newest first, so a recent invoice is on the first page; an older one the customer
      // pays from the list is a few pages down, and is looked for there.
      let invoice: SessionInvoice | null = null;
      let cursor: string | undefined;
      for (let pages = 0; pages < SETTLEMENT_MAX_PAGES && invoice === null; pages++) {
        const page: KaitenPage<SessionInvoice> =
          cursor === undefined
            ? await sessionClient.listInvoices()
            : await sessionClient.listInvoices({ cursor });
        invoice =
          (invoiceId === null
            ? page.items.find((candidate) => candidate.kind === "ACTIVATION")
            : page.items.find((candidate) => candidate.id === invoiceId)) ?? null;
        if (!page.hasMore || page.nextCursor === undefined) break;
        cursor = page.nextCursor;
      }
      if (invoice) {
        const paid = invoice.status === "PAID";
        const failed = stopOnFailure && invoice.status === "PAYMENT_FAILED";
        setState((previous) => ({
          status: paid ? "paid" : failed ? "failed" : previous.status,
          invoice,
        }));
        if (paid || failed) {
          void invalidatePortal(mutate, scopeKey);
          void invalidateInvoices(mutate, scopeKey);
        }
        return paid || failed;
      }
      return false;
    } catch {
      return false;
    } finally {
      reading.current = false;
    }
  }, [sessionClient, invoiceId, stopOnFailure, mutate, scopeKey]);

  React.useEffect(() => {
    if (!active) {
      setState((previous) =>
        previous.status === "idle" && previous.invoice === null
          ? previous
          : { status: "idle", invoice: null },
      );
      return;
    }
    setState({ status: "polling", invoice: null });
    const startedAt = Date.now();
    let stopped = false;
    const timer = setInterval(() => {
      void read().then((over) => {
        if (stopped || over) {
          if (over) clearInterval(timer);
          return;
        }
        if (Date.now() - startedAt >= giveUpAfterMs) {
          clearInterval(timer);
          setState((previous) =>
            previous.status === "polling" ? { ...previous, status: "gave_up" } : previous,
          );
        }
      });
    }, intervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, read, intervalMs, giveUpAfterMs]);

  // Past the schedule, a customer who comes back to the window probably just paid.
  const gaveUp = state.status === "gave_up";
  React.useEffect(() => {
    if (!gaveUp) return;
    const onFocus = () => void read();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [gaveUp, read]);

  const check = React.useCallback(() => void read(), [read]);
  return { ...state, check };
}
