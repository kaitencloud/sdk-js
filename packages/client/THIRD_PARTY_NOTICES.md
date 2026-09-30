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
