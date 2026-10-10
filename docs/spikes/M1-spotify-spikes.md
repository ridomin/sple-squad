# M1 Spotify API spikes — verification status

**Status (2026-10-10): all four checks are unverified.** No live Spotify
requests were made for this report. Prior statements in the requirements and
ADRs are recorded below as prior claims, not as evidence reproduced in this
verification cycle. No requirements or ADR changes are warranted without
contradictory observed evidence. Rido has reviewed and signed off on this
report as written; that sign-off does not verify S1–S4 or approve the M1
implementation.

## Evidence boundary

This report records the current verification status and a safe retest plan; it
does not claim that any Spotify behavior was observed. In particular, the
previously documented dated resolutions for S1–S3 are not treated as verified
by this report: the referenced report was absent, and no live requests were
made now.

Retests are deferred until implementation and an authorized authenticated test
account and data are available. Do not include credentials, tokens, account or
playlist/track identifiers, ISRC values, account/person names or other personal
data, or raw request/response bodies in the report. Record only the sanitized
fields listed in the plans below; redact authorization headers and query
values that identify a person or resource.

## S1 ISRC search filter

**Status: unverified.** No live search request was made. S1 was explicitly
deferred until implementation.

**Prior claim:** Requirements §8 and §10 and ADR-0003 Amendment 1 state that
the `isrc:` search filter worked and set `isrcSearchMode` to `'filter'`.
Those statements remain historical, unverified claims here; this report does
not reproduce their reported observations.

**Retest plan:** Once search is implemented, use an authorized test app and a
small, approved test corpus. Compare an ISRC-filtered search with the expected
test outcome and inspect only whether the result includes the ISRC field.
Record the date, endpoint, filter mode, HTTP status, result count, and whether
the expected result/ISRC field was present. Do not record the actual ISRC,
query value, track metadata, identifiers, or response body.

## S2 Collaborator access to playlist items

**Status: unverified.** No live playlist request was made. Collaborator access
testing is explicitly deferred until implementation.

**Prior claim:** Requirements §8 and §10 and ADR-0003 Amendment 1 state that a
non-owner collaborator can read playlist items and describe access outcomes
for other playlist types. These remain historical, unverified claims; this
report does not reproduce them.

**Retest plan:** Once playlist reads are implemented, test with an authorized
Development Mode app and test playlists whose owners have consented to the
check. Include an owned control and a collaborator/non-owner case; test any
other access cases only when authorized data is available. Record the date,
endpoint, ownership relation as a boolean, collaboration flag as a boolean,
HTTP status, whether an `items` field was present, and item count if needed.
Do not record playlist IDs, owner/account identifiers, names, item metadata,
or response bodies.

## S3 Page-size limits

**Status: unverified.** No live pagination request was made. Retesting is
pending an authenticated test account and suitable test data.

**Prior claim:** Requirements §8 and §10 and ADR-0003 §5 and Amendment 1 state
page-size limits for playlist listing, liked tracks, and playlist items, as
well as search pagination constraints. These are prior claims only; their
limits and the associated performance conclusion have not been reproduced in
this verification cycle.

**Retest plan:** With an authorized authenticated account and suitable test
data, probe each relevant endpoint's accepted page-size boundary and verify
pagination behavior at and around that boundary. Record the date, endpoint,
requested limit, HTTP status, accepted/rejected outcome, returned item count,
and whether another page is indicated. For search, record the requested
limit/offset and accepted/rejected outcome. Do not record resource IDs, item
metadata, account details, or response bodies.

## S4 Premium detection unverified

**Status: unverified.** No login or API request for a non-Premium app owner was
made. Testing the non-Premium case is explicitly deferred.

**Prior claim:** Requirements §8 and §10 and ADR-0003 Amendment 1 already
label the exact non-Premium error as unverified and propose a fallback
classification based on a 403 message containing “premium”. This report
confirms no such behavior; the fallback is not validated evidence.

**Retest plan:** When a non-Premium test app owner and authorized test setup
are available, determine whether the failure occurs during login/token
exchange or on the first API call. Record only the stage, endpoint category,
HTTP status, sanitized provider error code/category if present, and whether a
case-insensitive Premium keyword was present (true/false). Do not record the
account's identity or subscription details, credentials, tokens, full error
text, or response body.

## Sign-off

Rido's review and sign-off on this report are complete. These unverified
checks must not be treated as reproduced evidence or as approval of the M1
implementation.
