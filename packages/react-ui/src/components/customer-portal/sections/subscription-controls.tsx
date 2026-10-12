import * as React from "react";

import { useCancelSubscription, useReactivateSubscription } from "@kaitencloud/react/billing";
import { BoundaryPendingError, ProviderUnavailableError } from "@kaitencloud/react";

import { usePortalBillingWords } from "../../shared/billing-words.ts";
import { Action, Message } from "../../shared/feedback.tsx";
import { useFocusScope } from "../../shared/focus.ts";
import type { SubscriptionState } from "../../shared/subscription-state.ts";

/**
 * What a customer can do to their subscription by themselves: cancel it at the end of its period,
 * and withdraw that cancellation until the period is over. Both are the session's own calls, and
 * the portal is read again before either is said to be done.
 *
 * Cancelling asks first, and says what happens: the date it ends on and that nothing is lost until
 * then; a customer in their trial is told it ends now, since a trial has no period to run out.
 * Which of the two is offered is the portal's say (`capabilities.unsubscribe`, and a cancellation
 * that is scheduled): nothing here guesses it from the status.
 */
export function SubscriptionControls({
  state,
  unstyled,
}: {
  state: SubscriptionState;
  unstyled: boolean;
}) {
  const words = usePortalBillingWords();
  const cancel = useCancelSubscription();
  const reactivate = useReactivateSubscription();
  const [confirming, setConfirming] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const scope = useFocusScope();
  const { subscription } = state;
  if (!subscription) return null;

  const canCancel = state.capabilities.unsubscribe;
  const canReactivate = state.ending;
  if (!canCancel && !canReactivate) return null;

  const busy = cancel.isPending || reactivate.isPending;
  const waiting = cancel.retryAt !== null || reactivate.retryAt !== null;

  // `after` is where the keyboard goes when the change is made: what it was on is gone.
  const run = async (action: () => Promise<unknown>, after: string[]) => {
    setFailure(null);
    try {
      await action();
      setConfirming(false);
      scope.focus(...after);
    } catch (error) {
      setFailure(
        error instanceof BoundaryPendingError
          ? words.stillClosing
          : error instanceof ProviderUnavailableError
            ? words.unavailable
            : words.actionFailed,
      );
    }
  };

  const prompt =
    state.kind === "trial"
      ? words.cancelTrialPrompt
      : words.cancelPrompt(subscription.currentPeriodEnd);

  return (
    <div
      ref={scope.ref}
      tabIndex={-1}
      data-slot="subscription-controls"
      className={unstyled ? undefined : "ktn-own flex flex-col gap-3 outline-none"}
    >
      {canCancel && confirming ? (
        <div
          role="group"
          aria-label={words.cancel}
          className={
            unstyled ? undefined : "ktn-own flex flex-col gap-3 rounded-lg border bg-secondary p-3"
          }
        >
          <p
            data-focus="cancel-prompt"
            tabIndex={-1}
            className={unstyled ? undefined : "ktn-own text-sm"}
          >
            {prompt}
          </p>
          <div className={unstyled ? undefined : "ktn-own flex flex-wrap gap-2"}>
            <Action
              unstyled={unstyled}
              variant="destructive"
              size="sm"
              busy={busy}
              onClick={() => void run(() => cancel.mutateAsync(), ["reactivate", "cancel-trigger"])}
            >
              {words.cancelConfirm}
            </Action>
            <Action
              unstyled={unstyled}
              variant="outline"
              size="sm"
              busy={busy}
              onClick={() => {
                setConfirming(false);
                scope.focus("cancel-trigger");
              }}
            >
              {words.cancelKeep}
            </Action>
          </div>
        </div>
      ) : canCancel ? (
        <div className={unstyled ? undefined : "ktn-own flex"}>
          <Action
            unstyled={unstyled}
            variant="outline"
            size="sm"
            busy={busy}
            focusKey="cancel-trigger"
            onClick={() => {
              setFailure(null);
              setConfirming(true);
              scope.focus("cancel-prompt");
            }}
          >
            {words.cancel}
          </Action>
        </div>
      ) : null}
      {canReactivate ? (
        <div className={unstyled ? undefined : "ktn-own flex"}>
          <Action
            unstyled={unstyled}
            variant="default"
            size="sm"
            busy={busy}
            focusKey="reactivate"
            onClick={() => void run(() => reactivate.mutateAsync(), ["cancel-trigger"])}
          >
            {words.reactivate}
          </Action>
        </div>
      ) : null}
      {waiting ? <Message unstyled={unstyled} tone="info" text={words.closingPeriod} busy /> : null}
      {failure ? <Message unstyled={unstyled} tone="error" text={failure} /> : null}
    </div>
  );
}
