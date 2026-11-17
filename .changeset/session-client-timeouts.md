---
"@kaitencloud/client": patch
---

`timeoutMs: 0` means no deadline for every client, and a session write that goes through the payment provider waits 30 seconds.

- `KaitenSessionClient` and `KaitenAnonymousCheckoutClient` read `timeoutMs: 0` as a deadline of zero and aborted every call at once with a `KaitenNetworkError`, where `KaitenClient` reads it as no deadline. All three now read it as `KaitenClient` does.
- When the host sets no `timeoutMs`, the session client's calls that go through the payment provider before they answer wait 30 seconds instead of 10: `checkout` (a `dryRun` preview still waits 10), `cancelSubscription`, `createPortalSession`, `createPaymentMethodSession` and `completePaymentMethodSession`. A slow payment used to time out in the browser while it could still go through on the server, and the customer saw a network error for a subscription that existed. These are the 30 seconds `confirmCheckout` of the anonymous checkout client already waited. A `timeoutMs` the host sets still applies to every call alike.
