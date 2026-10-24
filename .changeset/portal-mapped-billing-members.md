---
"@kaitencloud/react": minor
"@kaitencloud/react-ui": minor
---

Show the public billing members the client maps in the customer portal, in English, French, Spanish and German, styled and unstyled:

- Add-on decreases and removals show the scheduled boundary while retaining the quantity held. The panel starts at the scheduled quantity and can replace it or cancel it by sending the held quantity. Older payloads without `pendingQuantity` get no scheduled-decrease promise.
- INCOMPLETE shows the current plan and the actual payable ACTIVATION invoice's hosted page, using the existing settlement polling. No expiry date or purchased-plan price is inferred.
- An ended subscription names the current plan and offers the host's subscription action when checkout is allowed. No fallback reason or free-plan status is guessed.
- Provenance uses `effectiveSource`, and its click/keyboard disclosure shows exception windows, supplied before/after figures and BOOLEAN/CONFIG boost values. Unlimited is not attributed to a voucher without evidence. Catalogue add-on grants show their supplied combination and overage allowance.
- Voucher checks retain and show composite discounts, BOOLEAN/CONFIG values, decimal modifiers and flag variants. A check does not redeem the code.
- Price timing is shown only when supplied; checkout choices follow `displayOrder` when all choices supply it, otherwise retaining the period order. Branding follows the portal's capability and the host's request.

Failed-payment wording no longer assumes that the bank declined a card: the public payment outcome does not expose that cause. Metered add-on rates are quoted separately per sale unit, without multiplying them by add-on quantity or summing them with the flat fee.

All new localization members are optional, with the UI's English fallback, so older custom language packs keep compiling. The public snapshot still has no pending selection, incomplete deadline, cancellation/fallback reason or family `increaseBilling` policy: the portal does not invent those or show a true-up policy.

`useInvoiceSettlement` gains optional `activationSince`: an INCOMPLETE portal uses its current period start to exclude an older, already paid ACTIVATION invoice while the new one is not listed yet. Without the option, existing callers behave as before.
An ACTIVATION becoming VOID also refreshes the actual portal, without declaring payment or inferring an expiry/fallback reason.

Measured after a dependency-order build: the French pack is 7,128 gzip bytes (previous budget 7,050), CustomerPortal with its provider/style root 67,266 (65,550), and react-ui's full import 114,586 (112,550). These three budgets become 7,500, 67,500 and 114,850 respectively, for the added customer-facing copy and public billing rendering/polling. Every other budget and the headless/unstyled dependency checks are retained.
