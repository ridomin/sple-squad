# M1 (Spotify MVP) — manual verification checklist

- **Branch:** `squad/m1-integration`
- **Tester:** ____________  **Date:** ____________  **Commit SHA under test:** ____________
- **Node version:** ____________  **OS:** ____________

> **⚠️ NOTHING in M1 has been verified against live Spotify.**
> Spikes **S1–S4 are unverified** (ISRC search filter, collaborator access to
> playlist items, page-size limits, Premium detection). See
> [`docs/spikes/M1-spotify-spikes.md`](spikes/M1-spotify-spikes.md). Every
> Spotify-facing expectation below is an *expectation to confirm*, not a known
> fact. Where reality differs, record the exact observation; do not assume the
> code or the docs are right.
>
> Do **not** paste tokens, client secrets, account names, playlist/track IDs or
> ISRC values into notes or bug reports. Redact them.

## Known gaps (not in this branch)

- Pending revisions on **#16** and **#19** are **not** included in this branch;
  failures in those areas may already be known.
- **#21 (playlist edit)** is **not** included. There is no `playlist add`,
  `playlist edit`, `rename`, etc. Do not test them.
- The CLI has no `playlist search` / `playlist export` verbs: use top-level
  `sple search` and `sple export`.
- The fake provider is in-memory and starts empty (`playlist list` prints
  `No playlists.`); state does not persist between commands, so it is useful
  for flag/format/exit-code checks only.
- S1–S4 unverified (see note above).

Legend: `[ ]` = not run, mark `[x]` when passed. Write the result in the
**Notes** line (actual output, exit code, anything surprising). Mark a failed
step `[!]`.

## 0. Setup

- [ ] 0.1 `npm ci && npm run build && npm run lint && npm test` — build and lint clean; tests: **378 pass, 0 fail**.
  - Notes: 
- [ ] 0.2 `alias sple='node dist/cli/index.js'` (use `shopt -s expand_aliases` in scripts, or substitute the command).
  - Notes: 
- [ ] 0.3 `sple --help` lists `export`, `auth login|status|logout`, `search`, `playlist list|show|create|remove` and global flags `--provider --json --quiet --verbose --debug --yes`.
  - Notes: 
- [ ] 0.4 `sple --version` prints `sple v0.0.0` (version not yet bumped).
  - Notes: 
- [ ] 0.5 `sple <cmd> --help` works for each command (e.g. `sple playlist create --help`).
  - Notes: 

## 1. Offline, fake provider (no network)

Setup: `export SPLE_ENABLE_FAKE_PROVIDER=1` and use `--provider fake` on every command. Run from a scratch directory.

- [ ] 1.1 `sple --provider fake playlist list` → exit 0, prints `No playlists.`
  - Notes: 
- [ ] 1.2 `sple --provider fake playlist list --json | jq .` parses; has `playlists` array and `total`.
  - Notes: 
- [ ] 1.3 `sple --provider fake playlist create "Test" --dry-run` → exit 0, stderr `[dry-run] Would create private playlist "Test" in Fake Provider`; nothing created.
  - Notes: 
- [ ] 1.4 `sple --provider fake playlist create "Test" --quiet` → prints the ID only (nothing else on stdout).
  - Notes: 
- [ ] 1.5 `sple --provider fake playlist show nope` → exit **4**, `playlist not found: nope`.
  - Notes: 
- [ ] 1.6 `sple --provider fake search abc --limit 2` → exit 0 (`No results` is acceptable); `--json` output parses with `jq`.
  - Notes: 
- [ ] 1.7 `sple --provider fake export --all -o out-dir --format json` → `exported N of N playlists`; `out-dir/index.json` exists. Repeat with `--format csv`.
  - Notes: 
- [ ] 1.8 `sple --provider fake export --liked -o liked.json` → exit 0, file written.
  - Notes: 
- [ ] 1.9 Re-run 1.8 unchanged → exit **2**, `Export target already exists; use --force to overwrite`; file untouched. With `--force` → succeeds.
  - Notes: 
- [ ] 1.10 Usage errors: `sple export` (no source), `sple export --all` (no `-o`), `sple export --force` (no `-o`), `sple export --all --json -o x`-style misuse → exit 2 with a clear message, no stack trace.
  - Notes: 
- [ ] 1.11 `sple --provider nope playlist list` (or fake without the env var) → clear unknown-provider error, no stack trace.
  - Notes: 

## 2. Spotify prerequisites

- [ ] 2.1 Create an app in the Spotify developer dashboard (Development Mode). Record the Client ID (do not record it in this file).
  - Notes: 
- [ ] 2.2 Add redirect URI exactly `http://127.0.0.1/callback` (the registered URI in `src/provider/spotify/auth.ts`; loopback listener port may vary — confirm Spotify accepts it, record the actual redirect seen).
  - Notes: 
- [ ] 2.3 `export SPLE_SPOTIFY_CLIENT_ID=<client id>`. (A `.env` file such as `~/.config/sple/.env` is only honoured if Node loads it at startup, e.g. `node --env-file=...`; the env var is the verified path. Record whether a `.env` works if you try it.)
  - Notes: 
- [ ] 2.4 Unset the variable and run `sple auth login` → usage error `Missing Spotify Client ID...`, exit 2, no browser opened.
  - Notes: 
- [ ] 2.5 The dashboard app owner/test user is on **Premium** (FR-AUTH-2); have a second **non-Premium** account available for §9.
  - Notes: 
- [ ] 2.6 Test data ready: ≥1 owned playlist, 1 collaborative playlist you do *not* own, 1 followed non-collaborative playlist, 1 Spotify editorial playlist followed, one owned playlist with >100 tracks, ≥51 playlists in the library (for paging), some liked songs.
  - Notes: 

## 3. Auth

Token file: `~/.config/sple/tokens.json` on Linux (`$XDG_CONFIG_HOME/sple` if set; `~/Library/Application Support/sple` on macOS; `%APPDATA%\sple` on Windows).

- [ ] 3.1 `sple auth status` while logged out → exit 0, reports not logged in for spotify (record text).
  - Notes: 
- [ ] 3.2 `sple auth login` → browser opens, consent screen, redirect captured, success message with display name.
  - Notes: 
- [ ] 3.3 `sple auth status` → logged in, shows user, expiry, scopes **including the liked-songs scope** (needed for `export --liked`).
  - Notes: 
- [ ] 3.4 `sple auth status --provider spotify` and `--json | jq .` give consistent data; no token values printed anywhere.
  - Notes: 
- [ ] 3.5 `sple auth logout` → success; `tokens.json` entry removed; `sple auth status` shows logged out. (Revocation: Spotify access must be removed manually at spotify.com/account/apps — confirm the message says so.)
  - Notes: 
- [ ] 3.6 `sple auth login --no-browser` → URL printed, no browser opened; open it manually; callback completes login.
  - Notes: 
- [ ] 3.7 `sple auth login --manual` → URL printed; after consenting, paste the full redirected URL (browser may show a connection error page — expected) → login completes. Also try pasting garbage → `Invalid redirect URL`, non-zero exit.
  - Notes: 
- [ ] 3.8 `sple auth login --no-browser --manual` → exit 2, `--no-browser and --manual cannot be used together`.
  - Notes: 
- [ ] 3.9 Cancel/deny on the consent screen → clear error, non-zero exit, no tokens stored, no hang.
  - Notes: 
- [ ] 3.10 Wrong state/redirect (edit the pasted URL's `state`) → rejected with an error.
  - Notes: 
- [ ] 3.11 Token file permissions: `stat -c '%a' ~/.config/sple/tokens.json` → `600` (not group/world readable); directory not world-writable.
  - Notes: 
- [ ] 3.12 `sple auth login --provider other` → usage error (spotify only).
  - Notes: 

## 4. Token refresh

- [ ] 4.1 Logged in (3.2). Edit `tokens.json`: set the spotify `expiresAt` to a past ISO timestamp (keep the refresh token). Back up the file first; never paste its contents anywhere.
  - Notes: 
- [ ] 4.2 `sple playlist list --verbose` → succeeds silently (no re-login prompt); `tokens.json` `expiresAt` now in the future.
  - Notes: 
- [ ] 4.3 (Optional) Corrupt the refresh token → clear "log in again" style error, exit non-zero, no stack trace.
  - Notes: 

## 5. Search (S1, S3 unverified)

- [ ] 5.1 `sple search "daft punk" --limit 5` → ≤5 track results, readable table.
  - Notes: 
- [ ] 5.2 `sple search "daft punk" --type album --json | jq .` parses; results are albums.
  - Notes: 
- [ ] 5.3 `--type artist` and `--type playlist` each work.
  - Notes: 
- [ ] 5.4 `sple search "daft punk" --all --max-results 120` → exactly ≤120 results (several pages), no duplicates, no error. Default `--all` cap is 100; `--max-results` > 1000 → usage error.
  - Notes: 
- [ ] 5.5 **S1:** `sple search "isrc:<known ISRC>"` → returns the expected track. Record whether the filter works (do not record the ISRC itself).
  - Notes: 
- [ ] 5.6 `--limit 100` (above Spotify's page cap, declared 50) → clamped, no error, results returned (**S3**: record the actual cap behaviour).
  - Notes: 
- [ ] 5.7 Paging: `--limit 5 --offset 0` vs `--limit 5 --offset 5` → different, non-overlapping results. `--offset 996 --limit 10` → usage error (`--offset + --limit must not exceed 1000`).
  - Notes: 
- [ ] 5.8 `--all --limit 5` or `--all --offset 5` → usage error; `--max-results` without `--all` → usage error.
  - Notes: 
- [ ] 5.9 `--quiet` prints IDs only (no names).
  - Notes: 

## 6. Playlist read (S2, S3 unverified)

- [ ] 6.1 `sple playlist list` → all your playlists (owned + followed); counts match the Spotify app. With >50 playlists confirm **all** appear (paging) — **S3**.
  - Notes: 
- [ ] 6.2 `sple playlist list --owned` → only playlists you own. `--followed` → only followed ones. `--owned --followed` together → record behaviour (expect usage error or documented behaviour).
  - Notes: 
- [ ] 6.3 `sple playlist list --json | jq .` parses; `--quiet` → IDs only.
  - Notes: 
- [ ] 6.4 `sple playlist show <owned playlist>` (by ID, URL/URI, and by name if supported) → tracks match the app; order preserved.
  - Notes: 
- [ ] 6.5 `sple playlist show <owned playlist with >100 tracks>` → all tracks listed (paging, **S3**); count equals the app.
  - Notes: 
- [ ] 6.6 **S2:** `sple playlist show <collaborative playlist you don't own>` → expected readable. Record whether it is readable or restricted.
  - Notes: 
- [ ] 6.7 `sple playlist show <followed non-collaborative playlist>` → expected `Cannot read the tracks of "..." ... tracks are restricted` with workaround text (reason `not-owned`); exit code recorded; no stack trace.
  - Notes: 
- [ ] 6.8 `sple playlist show <Spotify editorial playlist>` → same access-restricted error as 6.7.
  - Notes: 
- [ ] 6.9 `sple playlist show <nonexistent id>` → not-found, exit 4.
  - Notes: 
- [ ] 6.10 `sple playlist show -` with an ID piped on stdin works.
  - Notes: 

## 7. Playlist write

Use throwaway names; clean up in the app afterwards.

- [ ] 7.1 `sple playlist create "sple-m1-test" --dry-run` → nothing created (verify in app).
  - Notes: 
- [ ] 7.2 `sple playlist create "sple-m1-test" --description "m1 manual test"` → created **private** by default; name + description correct in app; ID printed (`--quiet` prints ID only).
  - Notes: 
- [ ] 7.3 `sple playlist create "sple-m1-pub" --public` → public in app. `--public --private` together → usage error (record).
  - Notes: 
- [ ] 7.4 `sple playlist create "sple-m1-collab" --collaborative` → collaborative in app (collaborative implies private; `--public --collaborative` should error).
  - Notes: 
- [ ] 7.5 `sple playlist remove <id> --dry-run` → reports what would happen; playlist still present in app.
  - Notes: 
- [ ] 7.6 `sple playlist remove <id>` without `--yes` in a non-TTY (e.g. `< /dev/null`) → does not remove; refuses/prompts (record).
  - Notes: 
- [ ] 7.7 `sple playlist remove <id> --yes` → success message says **unfollowed** (Spotify has no delete). In the app the playlist is gone from the library; (optionally) it remains reachable via its URL/recoverable under Account → Recover playlists.
  - Notes: 
- [ ] 7.8 Remove a playlist you only *follow* → unfollow works and the original is unaffected.
  - Notes: 

## 8. Export

Schema: `schemas/canonical-playlist.v1.schema.json`.

- [ ] 8.1 `sple export <playlist> -o one.json` → file written; validates against the schema (e.g. `npx ajv-cli validate -s schemas/canonical-playlist.v1.schema.json -d one.json`, or any JSON-Schema validator); track count matches the app.
  - Notes: 
- [ ] 8.2 `sple export <playlist> -o one.csv --format csv` → opens in a spreadsheet; columns sensible; unicode names/commas/quotes correctly quoted; track count matches.
  - Notes: 
- [ ] 8.3 `sple export <playlist> --format json` without `-o` → JSON on stdout (pipe to `jq .`); `--json` on stdout-export → usage error as documented.
  - Notes: 
- [ ] 8.4 `sple export --all -o ./all-out` → one file per playlist plus `index.json`; summary `exported N of M playlists`; every file validates.
  - Notes: 
- [ ] 8.5 `sple export --all -o ./all-out --format csv` → CSV per playlist.
  - Notes: 
- [ ] 8.6 `sple export --liked -o liked.json` → liked songs exported (requires liked scope from 3.3); count matches the app.
  - Notes: 
- [ ] 8.7 Overwrite protection: repeat 8.1 → exit 2 `already exists; use --force`; with `--force` → overwritten. Same for the `--all` directory.
  - Notes: 
- [ ] 8.8 Multiple playlists as args without `-o` → usage error `Multiple sources require -o <directory>`; `--all` with positional args → usage error.
  - Notes: 
- [ ] 8.9 With `--all`, an unreadable playlist (followed non-collaborative / editorial, §6.7) is **skipped and reported** (`exported N of M`, reason shown, non-zero/partial exit code recorded) — it must not crash the run or abort other exports.
  - Notes: 
- [ ] 8.10 No tokens or other secrets appear in any exported file or in `--debug` output.
  - Notes: 

## 9. Premium detection (S4)

- [ ] 9.1 Log in with a **non-Premium** account: `sple auth login`. Record the exact outcome and error text (expected from code: `Spotify Premium is required for Development Mode apps. Subscribe to Premium and retry login: https://www.spotify.com/premium/`, reason `premium-required`). Note whether the failure happens at login or only at the first API call, and the exit code.
  - Notes: 
- [ ] 9.2 If login succeeded, `sple playlist list` → record the exact error/behaviour.
  - Notes: 
- [ ] 9.3 Confirm no tokens were persisted for the rejected account (`sple auth status`).
  - Notes: 

## Results summary

| Section | Steps | Passed | Failed | Blocked/Skipped | Tester | Date |
|---|---|---|---|---|---|---|
| 0 Setup | 5 | | | | | |
| 1 Offline (fake) | 11 | | | | | |
| 2 Prerequisites | 6 | | | | | |
| 3 Auth | 12 | | | | | |
| 4 Token refresh | 3 | | | | | |
| 5 Search | 9 | | | | | |
| 6 Playlist read | 10 | | | | | |
| 7 Playlist write | 8 | | | | | |
| 8 Export | 10 | | | | | |
| 9 Premium (S4) | 3 | | | | | |

Spike outcomes observed (facts only, sanitized):

| Spike | Observed result | Step(s) | Confirms prior claim? |
|---|---|---|---|
| S1 ISRC filter | | 5.5 | |
| S2 Collaborator item access | | 6.6 | |
| S3 Page-size limits | | 5.6, 6.1, 6.5 | |
| S4 Premium detection | | 9.1–9.2 | |

## Reporting failures

For each failure open an issue (or add a row to the notes) with:

1. **Step** number (e.g. `6.7`) and commit SHA.
2. **Command** exactly as run (redact IDs/tokens).
3. **Output** — full stdout and stderr (run with `--debug` if useful; redact secrets).
4. **Exit code** (`echo $?`) — expected codes seen so far: 0 ok, 2 usage error, 4 not found.
5. Expected vs. actual, and whether it reproduces.
6. Environment: OS, Node version, account type (Premium or not).
