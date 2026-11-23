---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

`PatchInstanceBody` gains an optional `metadata` member, as the API contract now does: `KaitenApi.patchInstance` in the client and `Instances.patchInstance` in the server can change individual metadata keys of an instance without reading it first. The keys sent are merged at the first level into the stored metadata: a key present is set, its value replacing the stored one whole; a key whose value is `null` is removed; keys not named are kept. The merged result is validated against the organization's declared instance metadata fields, as on `PUT`.

- A Kaiten server that predates the metadata merge refuses the `metadata` key with a 422.
