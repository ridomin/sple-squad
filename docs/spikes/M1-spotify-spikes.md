# M1 Spotify API spikes (S1–S4)

- **Verification date:** 2026-10-10
- **Verification status:** S1–S4 were not reproduced against the live Spotify API in this pass.
- **Reason:** no Spotify Development Mode app, authorized Spotify test account, or safe live-test setup was provided. No Spotify credentials were sought in files, and no live Spotify request was made.
- **Sign-off:** pending Rido's review. This report does not constitute human sign-off.

The results recorded in requirements §8/§10 and ADR-0003 Amendment 1 are prior claims dated 2026-10-02. Their linked evidence report was absent when this verification began. This pass neither reproduces nor contradicts those claims; treat them as unverified for M1 until the retest below is completed and Rido signs off.

For a safe retest, use a user-controlled Development Mode app and authorized test accounts. Keep the app secret and access/refresh tokens in local secure configuration only. Record only the date, endpoint template and query parameters, HTTP status, result/page counts, and Boolean observations listed below. Do not retain authorization headers, token data, IDs, names, emails, or raw response bodies.

## S1: ISRC search filter

<a id="s1-isrc-search-filter"></a>

- **Prior claim:** `q=isrc:<ISRC>` works in Development Mode; five of five test ISRCs returned the expected track and `external_ids.isrc` was present. The recorded capability is `isrcSearchMode: 'filter'`.
- **This pass:** **Unverified**; no live request was made.
- **Safe retest:** With an authorized Development Mode app and a non-sensitive, known test ISRC, request `GET /v1/search` with `type=track`, `q=isrc:<ISRC>`, and a small `limit`. Record the HTTP status, result count, whether the expected ISRC matched, and whether the result's `external_ids.isrc` field was present. Do not retain track names, IDs, or response bodies.

## S2: Collaborator access to playlist items

<a id="s2-collaborator-access-to-playlist-items"></a>

- **Prior claim:** a user who collaborates on but does not own a playlist can read its items; the recorded access mode is `owned-or-collaborator`. Prior notes also report 403 for a followed non-collaborative playlist and 404 for an editorial playlist.
- **This pass:** **Unverified**; no live request was made.
- **Safe retest:** Using a playlist deliberately shared with a test account as a collaborator (not its owner), request `GET /v1/playlists/{playlist_id}/items` with a small `limit`. Record only status and item count. If practical, separately test a followed non-collaborative playlist to check the recorded 403 behavior. Do not record playlist IDs, titles, owners, collaborators, or item metadata.

## S3: Page-size limits

<a id="s3-page-size-limits"></a>

- **Prior claim:** maximum read page sizes are 50 for `GET /v1/me/playlists`, 50 for `GET /v1/me/tracks`, and 100 for `GET /v1/playlists/{playlist_id}/items`. Requirements also record search `limit` 10 and `limit + offset <= 1000`; those search constraints are outside this S3 page-size check.
- **This pass:** **Unverified**; no live request was made.
- **Safe retest:** On the same authorized account, request each read endpoint with a `limit` above its claimed maximum. Use test data with enough records to distinguish server caps from a short collection (at least 51 playlists, 51 liked tracks, and 101 playlist items, as applicable). Record the requested limit, HTTP status, returned item count, and whether the response indicated another page. Do not retain the returned IDs or metadata. A smaller collection cannot establish an endpoint maximum.

## S4: Premium detection (unverified)

<a id="s4-premium-detection-unverified"></a>

- **Prior claim:** the precise error for an app owner without Premium has not been observed. ADR-0003/0010 record a fallback that treats HTTP 403 as Premium-required only when the error message matches `/premium/i`.
- **This pass:** **Unverified**, consistent with the prior status; no non-Premium app-owner test was available and no live request was made.
- **Safe retest:** In a user-controlled test setup where the Spotify Development Mode app owner does not have Premium, run the OAuth flow and the first authenticated identity call (`GET /v1/me`). Record only the endpoint template, HTTP status, a sanitized provider error code if present, and whether the error message matches `/premium/i` (yes/no). Do not retain the message, account identity, plan details, headers, or response body. Do not infer the error from a different account's access failure.

## Evidence needed to close verification

Rido's review needs the safe observations above from an authorized live run. For S1–S3, that requires a user-controlled Development Mode app and suitable test account/data; S2 additionally requires a collaborator test playlist. S4 requires the app owner to be non-Premium during the test. If those conditions cannot be arranged, leave the affected spike unverified rather than infer an outcome. Once results are available, compare them with the prior claims and update requirements §8/§10 and ADR-0003 only where observations contradict them.
