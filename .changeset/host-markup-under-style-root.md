---
"@kaitencloud/react-ui": minor
---

The stylesheet no longer restyles a host's own markup placed inside a style root.

Only the preflight was limited to the elements the SDK renders. The utilities applied to anything under `.kaiten`, so an app that runs Tailwind or shadcn, and has the same class names (`bg-primary`, `rounded-lg`, `text-sm`, `p-4`), saw its own elements take Kaiten's tokens under a `KaitenStyleRoot` and behind a `Paywall`. The root also declared Tailwind's theme variables, a text colour and a `code` font, which that markup inherited.

- Every utility applies only to elements the SDK rendered, as the preflight does. Its specificity is unchanged, so what the README says about which side wins on Kaiten's elements still holds.
- The style root declares the `--ktn-*` tokens, `position: relative` and `width: 100%`, and nothing else. Tailwind's theme variables (`--spacing`, `--text-*`, …) are inlined into the SDK's utilities, so a host's own utilities read the host's theme inside a root.
- The SDK's text colour is declared on the outermost element of each component, not on the root. Host text inside a root keeps the colour of the host's page. A component set in a section that has its own text colour no longer inherits it: it reads `--ktn-foreground`. Give such a section a style root of its own, or set `--ktn-foreground` on it.
- The rule that gave every `<code>` under a root the SDK's mono font is gone. The SDK's own `code` keeps that font.
- An SDK component placed in the content of a `Paywall` keeps its reset and its styling behind the wall.
- `<KaitenBranding unstyled />` rendered by itself is reset like the other components: its link loses the browser's underline.

When upgrading, look at your own markup inside a style root. An element that had taken Kaiten's colours, radii or sizes goes back to yours, and one that relied on the SDK's stylesheet for a class your own CSS does not define loses that styling.

The `ktn-host` class is no longer rendered: the root of a `Paywall` carries `ktn-shell`. The style root no longer carries the `w-full` class.
