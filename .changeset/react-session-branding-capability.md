---
"@kaitencloud/react": patch
---

Use the customer portal's branding capability in its licensing snapshot, falling back to the public catalogue only when the portal omits it. An explicit `removable: false` on the portal takes precedence over a catalogue that allows removal.
