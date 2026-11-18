---
"@kaitencloud/client": patch
---

An `onAuthError` that throws no longer replaces the API's error.

`KaitenClient`, `KaitenSessionClient` and `KaitenAnonymousCheckoutClient` called `onAuthError` without guarding it, so what the host's callback threw was what the call rejected with: a 401 or 403 reached the caller as the host's error, without its status or code. The call now rejects with the API's `KaitenError`, as when the callback returns.

What `onAuthError` and `onDegraded` throw is reported with `console.error` and goes no further. `onDegraded` already could not fail the read it reports on; what it threw used to be dropped without a word.
