---
"@kaitencloud/client": patch
---

`KaitenSessionClient` no longer sends a `X-Kaiten-Publishable-Key` that the host's `defaultHeaders` holds to the `/public/session/*` routes, as `KaitenAnonymousCheckoutClient` already kept both credentials off the routes they do not belong to: a publishable key goes to the catalogue and the start of an anonymous checkout only, and a session's `Authorization` is the one of the call. Both public clients build their headers in one place.
