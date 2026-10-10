---
"@kaitencloud/client": patch
---

`KaitenClient` costs a host a little more in its bundle: 11.8 KB gzip when imported alone into a browser build, against 10.9 KB in 1.0.0. The growth is the usage report keys, with their retry rule, their typed refusals and the response headers they read. The repository's budget for that import moves from 12 500 to 13 500 bytes gzip, which also leaves room for the public catalog reads that ship in the same release (12.6 KB measured with them).
