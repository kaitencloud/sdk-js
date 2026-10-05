# Third-Party Notices

This file is reserved for attribution notices that must accompany third-party
materials distributed with Kaiten.

Do not add every dependency automatically.

Add an entry here when Kaiten directly distributes, copies, embeds, or vendors
third-party material whose license requires preservation of an attribution,
notice, copyright statement, or similar information.

For each applicable item, record:

- component or material name;
- source/project;
- version or commit where useful;
- copyright holder(s);
- applicable license;
- required attribution or notice;
- location of the corresponding license text.

Third-party license obligations must also be reflected in distributed artifacts
where required by the applicable license.

## Notices

### HTTP client runtime of `@hey-api/openapi-ts`

- **Material:** the `client/` and `core/` directories that `@hey-api/openapi-ts`
  writes next to the generated code, in `packages/client/src/core/generated/` and
  `packages/server/src/generated/`.
- **Distributed in:** `@kaitencloud/client` and `@kaitencloud/server`, bundled into
  their `dist/`.
- **Source:** https://github.com/hey-api/hey-api, at the version `pnpm-lock.yaml`
  pins.
- **Copyright:** Copyright (c) Hey API
- **License:** MIT, reproduced below.

```text
MIT License

Copyright (c) Hey API

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### `TypedDocumentString` of GraphQL Code Generator

- **Material:** the `TypedDocumentString` class that the GraphQL Code Generator
  client preset writes into `packages/client/src/graphql/generated/graphql.ts`.
- **Distributed in:** `@kaitencloud/client`, bundled into its `dist/`.
- **Source:** https://github.com/dotansimha/graphql-code-generator, at the version
  `pnpm-lock.yaml` pins.
- **Copyright:** Copyright (c) 2016 Dotan Simha
- **License:** MIT, reproduced below.

```text
The MIT License (MIT)

Copyright (c) 2016 Dotan Simha

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### shadcn/ui components

- **Material:** the component templates that `packages/react-ui/src/components/ui/`
  (`Badge`, `Button`, `Card`, `Dialog`, `Input`, `Separator`, `Skeleton`, `Table`)
  is derived from, with changes.
- **Distributed in:** `@kaitencloud/react-ui`, bundled into its `dist/`.
- **Source:** https://github.com/shadcn-ui/ui
- **Copyright:** Copyright (c) 2023 shadcn
- **License:** MIT, reproduced below.

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Lucide icons

- **Material:** the SVG shapes of the `check`, `x`, `triangle-alert`, `lock`,
  `arrow-up-right`, `arrow-right`, `credit-card`, `plus`, `zap`, `shield`,
  `chevron-right`, `loader-circle` and `infinity` icons, copied into
  `packages/react-ui/src/components/shared/icons.tsx`. Of these, `check`, `x`,
  `triangle-alert`, `lock`, `arrow-up-right`, `arrow-right`, `plus` and
  `chevron-right` derive from the Feather project.
- **Distributed in:** `@kaitencloud/react-ui`, bundled into its `dist/`.
- **Source:** https://github.com/lucide-icons/lucide
- **Copyright:** Copyright (c) 2026 Lucide Icons and Contributors; for the icons
  derived from Feather, Copyright (c) 2013-present Cole Bemis
- **License:** ISC, and MIT for the icons derived from Feather, both reproduced
  below.

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

```text
The MIT License (MIT)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Tailwind CSS

- **Material:** the CSS that Tailwind CSS generates into react-ui's stylesheet:
  its preflight base styles, theme variables and utilities.
- **Distributed in:** `@kaitencloud/react-ui`, in `dist/kaiten.css`.
- **Source:** https://github.com/tailwindlabs/tailwindcss, at the version
  `pnpm-lock.yaml` pins.
- **Copyright:** Copyright (c) Tailwind Labs, Inc.
- **License:** MIT, reproduced below.

```text
MIT License

Copyright (c) Tailwind Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
