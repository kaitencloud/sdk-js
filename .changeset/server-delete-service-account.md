---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

`ServiceAccounts.deleteServiceAccount` in the server, and `KaitenApi.deleteServiceAccount` in the client, delete a service account of the organization, as the API contract now does with `DELETE /service-accounts/{serviceAccountSlug}`. Every token the account still holds is revoked with it and stops authenticating at once; what the account wrote keeps it as its author, and its slug can be given to a new account. A slug the organization holds no account under throws a `KaitenError` with the code `ServiceAccount.NotFound`.

- The generated error types carry two refusals the contract now documents: a 409 on `createServiceAccount`, `CreateServiceAccount.EntitlementLimitReached`, when the organization already holds as many service accounts as its license allows, and a 409 on `activateConnector` and `updateConnectorSettings`, `ActivateConnector.EntitlementLimitReached`, when it already has as many active connectors as its license allows. `updateConnectorSettings` can also answer a 503 with a `Retry-After`.
- It needs a Kaiten release that serves `DELETE /service-accounts/{serviceAccountSlug}`.
