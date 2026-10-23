// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { useRedeemVoucher, useValidateVoucher } from "@kaitencloud/react/billing";
import {
  RateLimitedError,
  usePortal,
  type KaitenPortalBillingWords,
  type PortalVoucher,
} from "@kaitencloud/react";
import { useTrackComponent } from "@kaitencloud/react/internal";

import { useMergedAppearance } from "../../../appearance/context.tsx";
import type { KaitenAppearance } from "../../../appearance/types.ts";
import { cn } from "../../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../../style-root/kaiten-style-root.tsx";
import { usePortalBillingWords } from "../../shared/billing-words.ts";
import { Action, Message } from "../../shared/feedback.tsx";
import { useFocusScope } from "../../shared/focus.ts";
import { KaitenBranding } from "../../shared/kaiten-branding.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card.tsx";
import { Input } from "../../ui/input.tsx";

export interface VoucherEntryProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
}

// Memoized: guards against host-driven re-renders with unchanged props.
export const VoucherEntry = /* @__PURE__ */ React.memo(VoucherEntryImpl);

/** Whether a subscription status is one a code can be redeemed on: it is running. */
const LIVE = new Set(["TRIAL", "ACTIVE", "PAST_DUE"]);

/**
 * Where a customer enters a voucher code, under `mode="customer-session"`, and what it does depends
 * on the subscription the portal names.
 *
 * - **A live subscription** (in its trial, active or past due): the code is checked with a dry run,
 *   which says what it would give (a discount from the next invoice, for how many invoices; a boost
 *   or a flag grant that takes effect now, and until when), and the customer applies it or leaves it.
 *   Nothing is redeemed before they say so.
 * - **A subscription that waits for its first payment**: no field. The checkout's own selection is
 *   still pending, and the portal says a code can be added once the plan has started.
 * - **No subscription**: the code is only checked, and what a valid one says is that it will be
 *   applied by the checkout that carries it.
 *
 * The redemptions in force are listed under the field, never with their codes. Every refusal of a
 * code is one sentence, whatever the reason, because the server says none; a check refused for
 * coming too often says when to come back.
 *
 * The code is typed once. It is sent in the body of the check and emptied from the field at once:
 * it is not kept in the page, in an address, or anywhere a log could read it. Between the check and
 * the apply it is held in memory by the hook and nowhere else.
 *
 * Needs the first Kaiten release with billing.
 *
 * @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path.
 */
function VoucherEntryImpl({ appearance, unstyled = false }: VoucherEntryProps) {
  useAssertWrappedByKaitenProvider("VoucherEntry");
  useTrackComponent("VoucherEntry");

  const merged = useMergedAppearance(appearance);
  const words = usePortalBillingWords();
  const portal = usePortal();

  // Only a session that can check a voucher shows the field.
  if (!portal.data) return null;

  const status = portal.data.subscription?.status;
  const flow =
    status === "INCOMPLETE" ? "incomplete" : status && LIVE.has(status) ? "redeem" : "validate";
  const redemptions = portal.data.vouchers.filter((voucher) => voucher.status === "ACTIVE");

  const body = (
    <>
      {flow === "redeem" ? (
        <RedeemFlow unstyled={unstyled} />
      ) : flow === "validate" ? (
        <ValidateFlow unstyled={unstyled} />
      ) : (
        <p data-slot="voucher-incomplete" className="ktn-own text-sm text-ktn-muted-foreground">
          {words.voucherIncomplete}
        </p>
      )}
      <RedemptionList redemptions={redemptions} unstyled={unstyled} />
    </>
  );

  if (unstyled) {
    return (
      <section data-slot="voucher-entry" className="ktn-own">
        <h3>{words.vouchers}</h3>
        {body}
      </section>
    );
  }

  return (
    <Card className={cn(merged.elements?.card)}>
      <CardHeader className={cn(merged.elements?.cardHeader)}>
        <CardTitle className={cn(merged.elements?.cardTitle)}>{words.vouchers}</CardTitle>
      </CardHeader>
      <CardContent className={cn("flex flex-col gap-3", merged.elements?.cardContent)}>
        {body}
      </CardContent>
      <KaitenBranding className="-mb-6" />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// What a code gives, said
// ---------------------------------------------------------------------------

/** Whether a redemption has a price part, which discounts invoices. */
const hasPricePart = (redemption: PortalVoucher) =>
  redemption.voucherType === "PRICE" || redemption.voucherType === "COMPOSITE";

/** Whether a redemption has a part that takes effect at once, for a window. */
const hasGrantPart = (redemption: PortalVoucher) => redemption.voucherType !== "PRICE";

/**
 * What a redemption does, in sentences. `offered` is a code about to be applied or just applied:
 * its discount starts with the next invoice and its grants take effect now. Otherwise it is in
 * force already, and says how far along it is.
 */
export function describeRedemption(
  redemption: PortalVoucher,
  words: KaitenPortalBillingWords,
  offered: boolean,
): string[] {
  const notes: string[] = [];
  const { appliesFromInvoice, applicationsCount, applicationsMax } = redemption;
  if (hasPricePart(redemption)) {
    if (appliesFromInvoice === "next") {
      notes.push(words.voucherFromNextInvoice);
      if (typeof applicationsMax === "number")
        notes.push(words.voucherForInvoices(applicationsMax));
    } else if (typeof applicationsCount === "number" && !offered) {
      notes.push(words.voucherUsedOf(applicationsCount, applicationsMax ?? null));
    }
  }
  if (hasGrantPart(redemption)) {
    if (offered) notes.push(words.voucherTakesEffect);
    if (redemption.effectiveExpiresAt)
      notes.push(words.voucherUntil(redemption.effectiveExpiresAt));
    else if (!offered) notes.push(words.voucherActiveNow);
  }
  return notes;
}

/** The redemptions in force, never their codes. */
function RedemptionList({
  redemptions,
  unstyled,
}: {
  redemptions: PortalVoucher[];
  unstyled: boolean;
}) {
  const words = usePortalBillingWords();
  if (redemptions.length === 0) return null;
  return (
    <div data-slot="voucher-active" className={cn("ktn-own", !unstyled && "flex flex-col gap-2")}>
      {unstyled ? (
        <h4>{words.voucherActive}</h4>
      ) : (
        <h4 className="ktn-own text-sm font-medium">{words.voucherActive}</h4>
      )}
      <ul className={cn("ktn-own", !unstyled && "flex flex-col gap-2")}>
        {redemptions.map((redemption) => {
          const note = describeRedemption(redemption, words, false).join(" ");
          return (
            <li
              key={`${redemption.name}-${redemption.effectiveStartsAt}`}
              data-slot="voucher-redemption"
              className={cn("ktn-own", !unstyled && "flex flex-col text-sm")}
            >
              <span className={cn("ktn-own", !unstyled && "font-medium break-words")}>
                {redemption.name}
              </span>
              {note ? (
                <span className={cn("ktn-own", !unstyled && "text-ktn-muted-foreground")}>
                  {note}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/** True until `until` (milliseconds since the epoch) has passed, and re-renders when it does. */
function useBefore(until: number | null): boolean {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (until === null || until <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), until - now);
    return () => clearTimeout(timer);
  }, [until, now]);
  return until !== null && until > now;
}

/** The whole seconds a wait is said in: never less than one. */
const wholeSeconds = (seconds: number) => Math.max(1, Math.ceil(seconds));

/** A labelled field for a code and the button that sends it. */
function CodeField({
  unstyled,
  inputId,
  label,
  button,
  draft,
  onDraft,
  onSubmit,
  unavailable,
  invalid,
  describedBy,
}: {
  unstyled: boolean;
  inputId: string;
  label: string;
  button: string;
  draft: string;
  onDraft: (value: string) => void;
  onSubmit: () => void;
  /** The button waits: nothing to send, a check under way, or a wait to respect. It keeps the keyboard's place. */
  unavailable: boolean;
  invalid: boolean;
  describedBy: string | undefined;
}) {
  const inputProps = {
    id: inputId,
    type: "text",
    value: draft,
    autoComplete: "off",
    autoCapitalize: "characters",
    spellCheck: false,
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
    "data-focus": "code",
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onDraft(event.target.value),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onSubmit();
      }
    },
  } as const;

  return unstyled ? (
    <>
      <label htmlFor={inputId}>{label}</label>
      <input {...inputProps} />
      <button
        type="button"
        aria-disabled={unavailable || undefined}
        onClick={() => {
          if (!unavailable) onSubmit();
        }}
      >
        {button}
      </button>
    </>
  ) : (
    <div className="ktn-own flex flex-col gap-2">
      <label htmlFor={inputId} className="ktn-own text-sm font-medium">
        {label}
      </label>
      <div className="ktn-own flex gap-2">
        <Input {...inputProps} />
        <Action
          unstyled={false}
          variant="outline"
          busy={unavailable}
          onClick={() => {
            if (!unavailable) onSubmit();
          }}
        >
          {button}
        </Action>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A code on a live subscription: what it gives, then apply it
// ---------------------------------------------------------------------------

function RedeemFlow({ unstyled }: { unstyled: boolean }) {
  const words = usePortalBillingWords();
  const redeem = useRedeemVoucher();
  const [draft, setDraft] = React.useState("");
  const scope = useFocusScope();
  const id = React.useId();
  const inputId = `${id}-code`;
  const messageId = `${id}-message`;
  const blocked = useBefore(redeem.retryAt);
  const working = redeem.status === "checking" || redeem.status === "applying";

  const check = async () => {
    const code = draft.trim();
    if (!code || working || blocked) return;
    // Out of the field before the call: from here on the code is the hook's alone.
    setDraft("");
    await redeem.check(code);
    // The preview's Apply when there is one, else back to the field.
    scope.focus("apply", "code");
  };

  const message = (() => {
    switch (redeem.status) {
      case "applied":
        return redeem.redemption
          ? {
              tone: "success" as const,
              text: [
                words.voucherRedeemed(redeem.redemption.name),
                ...describeRedemption(redeem.redemption, words, true),
              ].join(" "),
            }
          : null;
      case "refused": {
        const problem = redeem.problem;
        const text =
          problem?.kind === "voucher_invalid"
            ? words.voucherInvalid
            : problem?.kind === "subscription_incomplete"
              ? words.voucherIncomplete
              : problem?.kind === "no_subscription"
                ? words.voucherNoSubscription
                : problem?.kind === "rate_limited"
                  ? words.voucherWait(wholeSeconds(problem.retryAfterSeconds))
                  : problem?.kind === "unavailable"
                    ? words.unavailable
                    : words.actionFailed;
        return { tone: "error" as const, text };
      }
      default:
        return null;
    }
  })();

  if (redeem.status === "preview" || redeem.status === "applying") {
    const offered = redeem.redemption;
    return (
      <div
        ref={scope.ref}
        role="group"
        aria-label={words.vouchers}
        data-slot="voucher-offer"
        className={cn("ktn-own", !unstyled && "flex flex-col gap-3 rounded-lg border bg-card p-3")}
      >
        {offered ? (
          <Message
            unstyled={unstyled}
            tone="info"
            slot="voucher-entry-message"
            text={[offered.name, describeRedemption(offered, words, true).join(" ")]
              .filter(Boolean)
              .join(" — ")}
          />
        ) : null}
        <div className={cn("ktn-own", !unstyled && "flex flex-wrap gap-2")}>
          <Action
            unstyled={unstyled}
            variant="default"
            size="sm"
            busy={redeem.status === "applying"}
            focusKey="apply"
            onClick={() => {
              void redeem.apply().then(() => scope.focus("code"));
            }}
          >
            {words.voucherRedeem}
          </Action>
          <Action
            unstyled={unstyled}
            variant="outline"
            size="sm"
            busy={redeem.status === "applying"}
            onClick={() => {
              redeem.reset();
              scope.focus("code");
            }}
          >
            {words.voucherDismiss}
          </Action>
        </div>
      </div>
    );
  }

  return (
    <div ref={scope.ref} className={cn("ktn-own", !unstyled && "flex flex-col gap-2")}>
      <CodeField
        unstyled={unstyled}
        inputId={inputId}
        label={words.voucherLabel}
        button={words.voucherCheck}
        draft={draft}
        onDraft={setDraft}
        onSubmit={() => void check()}
        unavailable={draft.trim() === "" || working || blocked}
        invalid={redeem.problem?.kind === "voucher_invalid"}
        describedBy={message ? messageId : undefined}
      />
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// A code before a subscription: only checked, applied by the checkout that carries it
// ---------------------------------------------------------------------------

/** What the last check came to. Never the code: it is not kept. */
type Outcome =
  | { kind: "valid"; name: string }
  | { kind: "invalid" }
  | { kind: "limited"; seconds: number }
  | { kind: "failed" };

function ValidateFlow({ unstyled }: { unstyled: boolean }) {
  const words = usePortalBillingWords();
  const validate = useValidateVoucher();
  const [draft, setDraft] = React.useState("");
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  // A check the API refused for coming too often is not sent again before it said it would take it.
  const [blockedUntil, setBlockedUntil] = React.useState<number | null>(null);
  const id = React.useId();
  const inputId = `${id}-code`;
  const messageId = `${id}-message`;
  const blocked = useBefore(blockedUntil);
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
        // A wait the API gave, as the whole seconds a sentence can say.
        const seconds = wholeSeconds(error.retryAfterSeconds);
        setBlockedUntil(Date.now() + seconds * 1000);
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

  return (
    <div className={cn("ktn-own", !unstyled && "flex flex-col gap-2")}>
      <CodeField
        unstyled={unstyled}
        inputId={inputId}
        label={words.voucherLabel}
        button={words.voucherCheck}
        draft={draft}
        onDraft={setDraft}
        onSubmit={() => void check()}
        unavailable={draft.trim() === "" || checking || blocked}
        invalid={outcome?.kind === "invalid"}
        describedBy={message ? messageId : undefined}
      />
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
    </div>
  );
}
