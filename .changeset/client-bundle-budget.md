---
"@kaitencloud/client": patch
---

`KaitenClient` costs a host a little more in its bundle: 13.0 KB gzip when imported alone into a browser build, against 10.9 KB in 1.0.0. About 0.9 KB of the growth is the usage report keys, with their retry rule, their typed refusals and the response headers they read, and about 1.2 KB is the public catalog reads, with their options, the key-shape check and the major-unit conversion. The repository's budget for that import moves from 12 500 to 13 500 bytes gzip.
