---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

`PatchInstanceBody` gains `metadata`, as the API contract now does: `Instances.patchInstance` in the server, and `KaitenApi.patchInstance` in the client, can change individual metadata keys of an instance without reading it first. The keys sent are merged at the first level into the stored metadata: a key present is set, its value replacing the stored one whole; a key whose value is `null` is removed; keys not named are kept. The merged result is validated against the organization's declared metadata fields, and a refusal throws a `KaitenError` with the code `MetadataValidation.Failed`.

- It needs a Kaiten release that carries the metadata merge on `PATCH /instances/{instanceSlug}`. An earlier one refuses the `metadata` key with a 422.
