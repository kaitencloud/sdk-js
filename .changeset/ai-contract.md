---
"@kaitencloud/client": minor
"@kaitencloud/server": minor
---

Regenerate REST and GraphQL snapshots from the KTN-201 Kaiten branch, expose AI
model/conversion-rule/inference reads, and replace the temporary hand-written AI
wire bridge with generated aliases. The numeric report helper rejects non-numeric
read-value variants locally; AI reports use the generated write-only union.
