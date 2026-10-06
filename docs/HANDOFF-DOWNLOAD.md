# Private handoff downloads

`/api/handoff-agent` is a bounded export upload route behind owner-private Sites dispatch. Browser identities still need the administrator session and same-origin mutation checks. POST accepts one actual ZIP-signature file up to 8 MiB, writes it to R2 and saves only export metadata. GET returns metadata; GET `?download=1` lets the authenticated owner service verify the stored bytes. Neither path changes original drafts, schedules, statistics, XP or runtime secrets.

The visitor link is `/download/handoff`. The normal administrator login is required before it serves the R2 object with `Content-Disposition: attachment` and `application/zip`. Administrator settings also show a download link once an export has been saved. Keep the Site owner-private. On a different host, add equivalent service authentication before exposing any agent route.

The handoff ZIP is uploaded as owner data, not committed or embedded in source: it may contain the owner's private planning details. The bundle excludes API keys, `.env`, browser profiles, D1 records and R2 uploads. It contains the current source and requirements documents. R2 file size and checksum must be checked by downloading the saved object before telling the user it is ready.
