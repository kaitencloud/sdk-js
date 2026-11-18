---
"@kaitencloud/react": patch
"@kaitencloud/react-ui": patch
---

Documentation that contradicted the code now says what it does. No behaviour changes.

- `@kaitencloud/react`: `useKaitenBranding` and the provider's `hideBranding` no longer call the branding rule server-enforced. Kaiten reports whether the vendor's plan lets the "Powered by Kaiten" mark be removed, on the public catalogue and a customer session's portal, and the SDK applies that answer in the browser. The `branding.bypass_attempted` event goes to the provider's telemetry `transport` when the host set one, never to Kaiten. The `min` option of `usePaywallTrigger` loses a leftover placeholder in its comment.
- `@kaitencloud/react-ui`: the README's add-ons panel schedules a lower quantity or a removal for the renewal, as the portal's `pendingQuantity` says and the panel shows, where it said such a change took effect at once. It no longer promises a note on billing a higher quantity for the current period, which the portal does not render, since its payload does not carry the add-on family's policy. `VoucherEntry` is described as checking a code and applying it on a live subscription, where one sentence said it only checks one.
