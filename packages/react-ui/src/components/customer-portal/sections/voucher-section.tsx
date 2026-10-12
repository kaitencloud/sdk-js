import * as React from "react";

import { useValidateVoucher } from "@kaitencloud/react/billing";
import { RateLimitedError, usePortal } from "@kaitencloud/react";
import { useTrackComponent } from "@kaitencloud/react/internal";

import { useMergedAppearance } from "../../../appearance/context.tsx";
import type { KaitenAppearance } from "../../../appearance/types.ts";
import { cn } from "../../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../../style-root/kaiten-style-root.tsx";
import { usePortalBillingWords } from "../../shared/billing-words.ts";
import { Action, Message } from "../../shared/feedback.tsx";
import { KaitenBranding } from "../../shared/kaiten-branding.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card.tsx";
import { Input } from "../../ui/input.tsx";

/** What the last check came to. Never the code: it is not kept. */
type Outcome =
  | { kind: "valid"; name: string }
  | { kind: "invalid" }
  | { kind: "limited"; seconds: number }
  | { kind: "failed" };

export interface VoucherEntryProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
}

// Memoized: guards against host-driven re-renders with unchanged props.
export const VoucherEntry = /* @__PURE__ */ React.memo(VoucherEntryImpl);

/**
 * A field where a customer checks a voucher code, under `mode="customer-session"`. It only checks:
 * a code is redeemed by the checkout that carries it, and what a valid one says is that it will be
 * applied there. Every refusal is one sentence, whatever the reason, because the server says none;
 * a check refused for coming too often says when to come back.
 *
 * The code is typed once. It is sent in the body of the check and emptied from the field at once:
 * it is not kept in the page, in an address, or anywhere a log could read it.
 *
 * @experimental Until Kaiten billing ships (see STABILITY.md).
 */
function VoucherEntryImpl({ appearance, unstyled = false }: VoucherEntryProps) {
  useAssertWrappedByKaitenProvider("VoucherEntry");
  useTrackComponent("VoucherEntry");

  const merged = useMergedAppearance(appearance);
  const words = usePortalBillingWords();
  const portal = usePortal();
  const validate = useValidateVoucher();
  const [draft, setDraft] = React.useState("");
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  // A check the API refused for coming too often is not sent again before it said it would take it.
  const [blockedUntil, setBlockedUntil] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const id = React.useId();
  const inputId = `${id}-code`;
  const messageId = `${id}-message`;

  React.useEffect(() => {
    if (blockedUntil <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), blockedUntil - now);
    return () => clearTimeout(timer);
  }, [blockedUntil, now]);

  // Only a session that can check a voucher shows the field.
  if (!portal.data) return null;

  const blocked = blockedUntil > now;
  const checking = validate.isPending;

  const check = async () => {
    const code = draft.trim();
    if (!code || checking || blocked) return;
    // Out of the field before the call: from here on the code is the request's alone.
    setDraft("");
    setOutcome(null);
    try {
      const result = await validate.mutateAsync({ code });
      setOutcome(result.valid ? { kind: "valid", name: result.voucher.name } : { kind: "invalid" });
    } catch (error) {
      if (error instanceof RateLimitedError) {
        // A wait the API gave, as the whole seconds a sentence can say: never less than one.
        const seconds = Math.max(1, Math.ceil(error.retryAfterSeconds));
        setBlockedUntil(Date.now() + seconds * 1000);
        setNow(Date.now());
        setOutcome({ kind: "limited", seconds });
      } else {
        setOutcome({ kind: "failed" });
      }
    }
  };

  const message =
    outcome === null
      ? null
      : outcome.kind === "valid"
        ? { tone: "success" as const, text: `${outcome.name} — ${words.voucherAtCheckout}` }
        : outcome.kind === "invalid"
          ? { tone: "error" as const, text: words.voucherInvalid }
          : outcome.kind === "limited"
            ? { tone: "error" as const, text: words.voucherWait(outcome.seconds) }
            : { tone: "error" as const, text: words.actionFailed };

  const field = (
    <>
      {unstyled ? (
        <>
          <label htmlFor={inputId}>{words.voucherLabel}</label>
          <input
            id={inputId}
            type="text"
            value={draft}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={outcome?.kind === "invalid" || undefined}
            aria-describedby={message ? messageId : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void check();
              }
            }}
          />
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-sm font-medium">
            {words.voucherLabel}
          </label>
          <div className="flex gap-2">
            <Input
              id={inputId}
              type="text"
              value={draft}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={outcome?.kind === "invalid" || undefined}
              aria-describedby={message ? messageId : undefined}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void check();
                }
              }}
            />
            <Action
              unstyled={false}
              variant="outline"
              busy={draft.trim() === "" || checking || blocked}
              onClick={() => void check()}
            >
              {words.voucherCheck}
            </Action>
          </div>
        </div>
      )}
      {unstyled ? (
        <button
          type="button"
          aria-disabled={draft.trim() === "" || checking || blocked || undefined}
          onClick={() => void check()}
        >
          {words.voucherCheck}
        </button>
      ) : null}
      <div id={messageId} data-slot="voucher-outcome" className="ktn-own">
        {message ? (
          <Message
            unstyled={unstyled}
            tone={message.tone}
            text={message.text}
            slot="voucher-entry-message"
          />
        ) : null}
      </div>
    </>
  );

  if (unstyled) {
    return (
      <section data-slot="voucher-entry" className="ktn-own">
        <h3>{words.vouchers}</h3>
        {field}
      </section>
    );
  }

  return (
    <Card className={cn(merged.elements?.card)}>
      <CardHeader className={cn(merged.elements?.cardHeader)}>
        <CardTitle className={cn(merged.elements?.cardTitle)}>{words.vouchers}</CardTitle>
      </CardHeader>
      <CardContent className={cn("flex flex-col gap-3", merged.elements?.cardContent)}>
        {field}
      </CardContent>
      <KaitenBranding className="-mb-6" />
    </Card>
  );
}
