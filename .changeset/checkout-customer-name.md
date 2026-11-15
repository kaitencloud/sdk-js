---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
"@kaitencloud/react": minor
"@kaitencloud/react-ui": patch
---

An anonymous checkout names the customer after the buyer's company.

- `@kaitencloud/client`: `startCheckout` takes an optional `customerName`, at most 255 characters, which the completion names the new customer and its instance after. Kaiten trims it, and names both after the `email` when it is left out. `getCheckoutSession` and `confirmCheckout` read it back as `customerName`, `null` when the start gave none. The mock client does the same.
- `@kaitencloud/server`: the generated types carry `customerName` on the checkout session draft and on both session reads.
- `@kaitencloud/react`: `useAnonymousCheckout` sends `selection.company`, trimmed, as the `customerName`; with no company, `selection.name`; with neither, nothing. It used to keep both in the tab and send neither, so every customer was named after an e-mail address.
- `@kaitencloud/react-ui`: `collectCompany` and `collectName` say that the company, else the name, names the customer.
