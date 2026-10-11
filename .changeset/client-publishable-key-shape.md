---
"@kaitencloud/client": minor
---

`isPublishableKeyShape(key)` and `assertPublishableKeyShape(key)` check a publishable key against the shape Kaiten issues it in: `pk_` and 43 base64url characters. They catch a key cut short by a paste, or wrapped in quotes or a space, where `assertPublishableKey` only reads the prefix. `assertPublishableKey` and `isPublishableKey` do not change: any string that starts with `pk_` still passes them, as it did in 1.0, and the client's own requests keep that check.
