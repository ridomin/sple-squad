# M1 Spotify API spikes (S1–S4)

- **Status date:** 2026-10-13
- **Status:** S1–S4 are closed by **owner decisions and assumptions** (Rido), so M1 can complete without live spike verification.
- **No live results are claimed.** None of S1–S4 was run against the live Spotify API. Earlier text that recorded "Resolved 2026-10-02" results (5 of 5 ISRCs, 50 / 50 / 100 page sizes, collaborator access) had no evidence report behind it and is withdrawn. A 2026-10-10 pass confirmed nothing was reproduced.
- **Sign-off:** owner decisions given by Rido on 2026-10-13.

Recorded in requirements §8/§10 and [ADR-0003 Amendment 3](../adr/0003-provider-interface-and-capabilities.md).

## S1: ISRC search filter

<a id="s1-isrc-search-filter"></a>

- **Owner decision (2026-10-13):** ISRC search is dropped. Do not rely on `q=isrc:`. Spotify `isrcSearchMode` is `'none'` (no ISRC filter). Matching must not depend on Spotify ISRC search: the chain is known ref → metadata for Spotify targets.
- **Still allowed:** reading `external_ids.isrc` from track objects and exporting it when the API returns it (optional field). Whether the API returns it is not verified.
- **Affected:** FR-SEARCH-3 (no `isrc:` filter), FR-MIG-2, ADR-0003, ADR-0005, ADR-0009.
- **Status:** decision, not live-verified.

## S2: Collaborator access to playlist items

<a id="s2-collaborator-access-to-playlist-items"></a>

- **Decision (2026-10-13):** testing collaborative-playlist read access is **deferred**; the behavior is **untested**.
- **Conservative behavior:** owned playlists are readable. For any other playlist, a 403/404 from `/playlists/{id}/items` means not readable (`itemsReadable: false`, `AccessRestrictedError('not-owned')`). Do not rely on the `collaborative` flag.
- **Retest later (optional):** with a playlist shared with a test account as collaborator, request `GET /v1/playlists/{playlist_id}/items` with a small `limit`; record only status and item count, no IDs or titles.

## S3: Page-size limits

<a id="s3-page-size-limits"></a>

- **Decision (2026-10-13):** use a default page size of **50** for `GET /v1/me/playlists`, `GET /v1/me/tracks` and `GET /v1/playlists/{playlist_id}/items`, without verifying maximum limits. This is a decision, **not a measurement**.
- Search keeps `limit` ≤ 10 and `limit + offset <= 1000` per the February 2026 changelog (not live-verified).

## S4: Premium detection

<a id="s4-premium-detection-unverified"></a>

- **Assumption (2026-10-13):** all users have Premium. No special Premium-detection error handling is required beyond generic 403 handling. The error for a non-Premium app owner was never observed.
- A `/premium/i` 403 mapping to `premium-required` (ADR-0010) is optional, best-effort only.

## Closing note

Any future live observation that contradicts these decisions should update requirements §8/§10 and ADR-0003 only where it differs. Record only dates, endpoint templates, HTTP status and counts; never tokens, IDs or response bodies.
