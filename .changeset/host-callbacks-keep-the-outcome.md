---
"@kaitencloud/react": patch
---

A callback of the host that throws no longer changes what it was told about.

- `useCheckout`: an `onSubscribed` that threw reported the subscribed checkout as failed, and sent the customer back to choosing a plan they had just bought. The checkout now stays `subscribed`.
- `useAnonymousCheckout`: an `onStarted` that threw left the visitor choosing, with the error of the page's callback as the checkout's. An `onSubscribed` that threw was raised from a React effect, so it reached the nearest error boundary and took the completed checkout off the page. The checkout now stays started, and completed.
- `useReportUsage`, `useCancelSubscription`, `useReactivateSubscription`, `useSetAddonQuantity` and `useValidateVoucher`: an `onSuccess` that threw turned a call that succeeded into a rejection with the host's error, and an `onError` that threw rejected with the host's error in place of the API's. The call now resolves, or rejects with its own error.

What these callbacks throw is reported with `console.error` and goes no further. So is what `useRedeemVoucher`'s `onApplied` throws, which left the voucher applied but was dropped without a word.

The `core · everything` bundle budget rises from 33 850 to 34 150 bytes gzip (measured at 33 869, up from 33 799).
