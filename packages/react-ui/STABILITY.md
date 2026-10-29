<!--
  One document for both React packages; the copy of record lives in
  ../react/STABILITY.md and this is a pointer, not a fork.
-->

# Stability & versioning

`@kaitencloud/react-ui` and `@kaitencloud/react` share one versioning policy and
one statement of what is stable: see
[`packages/react/STABILITY.md`](../react/STABILITY.md).

The short form: everything in the headless core is the blessed path, and so is each
component's `unstyled` rendering. Everything else this package adds — the styled
components' default rendering, `KaitenStyleRoot`, the `appearance` theming API and
the prebuilt stylesheet — is `@experimental`: its shape may change in a minor
release.
