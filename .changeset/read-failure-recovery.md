---
"@kaitencloud/react": minor
"@kaitencloud/react-ui": patch
---

A read that fails no longer shuts the gates of a customer whose data was read, and is made again on its own.

- `@kaitencloud/react`: one failed read used to be the last a tab made. SWR skips a polling tick while its cache holds an error and leaves it to its error retry to clear it, and the provider had that retry off, so the catalog, the snapshot and the portal were read again only on `refetch`, after a usage report or on a reload. Until then `Show`, `Gate` and `KaitenLoaded` answered as if nothing had ever been read, with the data of the last read still held.
  - A failed read is made again: after 5 seconds for an outage (no answer, a timeout, a 5xx, 408 or 429), then 10, 20, up to every 5 minutes; after 5 minutes for a refusal (any other 4xx), the pace of a poll; never sooner than a `Retry-After`. It is one read per provider and one wait at a time, each wait moved by up to a fifth. A hidden tab and an offline browser wait, and read at once when they are back. A provider that mounts on a read that had already failed, with `initialData` for instance, reads it again too.
  - While the data of an earlier read is held, `Show`, `Gate`, `usePaywallTrigger` and `KaitenLoaded` keep deciding on it, and `KaitenFailed` does not render. The failure is on `error` beside the decision: `GateState.error` and `PaywallTriggerResult.error` can be set without the reason `error`.
  - `staleIfErrorMs`, a new prop of `KaitenProvider` and `KaitenScopeProvider`, says for how long. Once reads have failed for longer, an hour by default, the gates apply `onError` and `KaitenFailed` renders, as when nothing was ever read. `0` applies it at the first failed read, which is what the gates did before; `Infinity` never does.
  - A read the provider makes on its own after a failure does not show as loading: `isLoading` stays `false`, so a `Gate` closed for want of data does not open for the length of each retry. `refetch` and the `retry` of `KaitenFailed` show as loading, as before.
- `@kaitencloud/react-ui`: `Paywall` follows, through `usePaywallTrigger`. It keeps the wall the last read decided, and its `onError` applies when there is no data to decide on.

The bundle-size budgets of the scenarios that hold the provider are raised by what this adds, about 0.7 KB gzip.
