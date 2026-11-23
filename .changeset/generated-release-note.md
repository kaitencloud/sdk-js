---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

A release carries an optional `releaseNote`, its release notes in markdown, as the API contract now does: `Release` and `ReleaseWritable` gain the member, and so does `ReleaseDelivered`, the payload of the release webhooks. It is set when the release is created (`KaitenApi.createRelease` in the client, `Releases.createRelease` in the server) and returned when a single release is read (`KaitenApi.getReleaseBySlug`, `DeploymentZones.getReleaseBySlug`); list responses omit it.
