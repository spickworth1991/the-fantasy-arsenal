# Value and projection archive

The daily updater stores one exact, gzip-compressed snapshot per source using:

`<source>_<YYYY-MM-DD>.json.gz`

Each day also has a `manifest_<YYYY-MM-DD>.json`. The machine-readable
`index.json` lists every available archive date for future trend views.

Bye-week data is intentionally excluded from this archive and the daily update.
