---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

Resync the OpenAPI snapshot to Kaiten's billing contract at `57283b6f5dcfcc8bdabe139ec0ff097f0733b556` and regenerate both REST clients (343 operation declarations, including webhook payloads).

The public portal now describes entitlement exceptions and the value of boolean/config voucher boosts; voucher validation also exposes flag grants. The vendor gains three entitlement-exception operations, generated on the server's resource classes. No pending subscription selection, cancellation reason or add-on increase-billing policy is added to the public payloads by this sync.
