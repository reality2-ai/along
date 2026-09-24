# QR generator provenance

`qrcode.mjs` is the unmodified ES module from qrcode-generator 2.0.4 by
Kazuhiko Arase, upstream commit `83b7e8fe3fddd3b0368dbafd6ce56995bd25e3c8`:

https://github.com/kazuhikoarase/qrcode-generator/blob/83b7e8fe3fddd3b0368dbafd6ce56995bd25e3c8/js/dist/qrcode.mjs

MIT license: see `qrcode.LICENSE`, copied from the same revision. The original
copyright header is retained. Source SHA-256:
`ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0`.

Along's wrapper selects UTF-8 bytes and draws modules into a local SVG using DOM
methods. There is no CDN, QR service, dynamic remote script or network request.
This library is confined to the experimental pairing code, outside the public app.
It is the same library family used by the inspected Notekeeper UI, not a claim of
Notekeeper protocol interoperability.
