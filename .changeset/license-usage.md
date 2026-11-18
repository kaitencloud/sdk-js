---
"@kaitencloud/react-ui": minor
---

Add `LicenseUsage`, a block for a page of its own that shows the licence a customer holds and every numeric quota of it, with what each has used: a capped quota has its figures, its window and a bar that follows the usage rule of the Kaiten console, and a quota nothing caps (every licence Kaiten sells today) has what is used out of "Unlimited", which `UsageMeters` leaves out. It works under `mode="authenticated"` and `mode="customer-session"` (named there by the plan the portal names, with no term, since the portal carries none), says a trial with a badge, draws nothing where there is no snapshot to read, and has its words in every language pack. It is experimental, like the other styled components, and adds about 1 KB gzip to an app that imports everything.
