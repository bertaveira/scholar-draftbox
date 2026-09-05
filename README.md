# Scholar Draftbox

A local, unofficial ECCV 2026 paper explorer and personal poster shortlist. Now wearing its affectionate Scholar Inbox parody branding: Scholar Draftbox, the one we have at home. The underlying data tools and storage keys retain the ECCV Scout name so existing bookmarks remain intact.

The accepted implementation plan is [mvp-plan.md](mvp-plan.md). The original [build plan](eccv-scout-build-plan.md) is preserved as the future roadmap. Application code lives in `scout/`.

## Run locally

Use Node.js **22.13 or later** (Node 24 recommended) and Python 3.9 or later.

```sh
cd scout
npm ci
npm run dev
```

For the complete offline-capable local preview:

```sh
npm run build
npm run preview
```

Open http://localhost:3000. Production preview binds only to the local machine. After the first online load, wait for **Ready for offline use** before disconnecting. Development mode deliberately does not install a service worker. To use development mode after a production preview, remove the localhost service worker in browser developer tools or use a different port.

On this workspace's older system Node, prefix npm commands with:

```sh
PATH=/Users/bertaveira/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run dev
```

## What works

- Browser keyword search with accent-insensitive matching, title priority, and combined topic/day/session/presentation filters.
- Detail panel with authors, available abstract, official links, and all known presentations.
- Device-local bookmarks, grouped by day/session, natural poster-number ordering, and session browsing.
- Versioned JSON export/import; imports merge bookmarks and preserve unknown IDs.
- Offline app shell, all session routes, and a complete validated conference snapshot.
- Optional WebMCP `search_papers` and `set_paper_bookmark` tools in browsers exposing `document.modelContext`.

Saving a paper is a bookmark, not a promise to attend. There are no conflict warnings, accounts, tracking, AI endpoints, calendar exports, or hosted deployment in this release.

## Data and source precedence

The September 5, 2026 snapshot contains **2,863 papers**, **2,863 posters**, **28 oral appearances**, **135 spotlight appearances**, and **21 sessions**. Every paper has a poster number and session assignment. All abstracts are currently unavailable from the official published dataset; the app says so instead of inventing summaries.

Official sources:

- [Accepted papers](https://eccv.ecva.net/Conferences/2026/AcceptedPapers): paper IDs, titles, authors, topics, poster numbers, and poster rooms. The page repeats some papers under multiple topics; identical repeated rows are deduplicated, conflicting duplicates rejected.
- [Conference calendar](https://eccv.ecva.net/virtual/2026/calendar): authoritative session membership, times, and oral/spotlight titles. Appearances rendered without links are matched by exact normalized title, never fuzzy matching. Session times are not individual talk start times.
- [Published event JSON](https://eccv.ecva.net/static/virtual/data/eccv-2026-orals-posters.json): optional metadata enrichment. It declares 2,891 events but includes only the first 200; its API continuation returned 403 during implementation. It must not be used as the complete paper list.
- [Published abstracts](https://eccv.ecva.net/static/virtual/data/eccv-2026-abstracts.json): empty at retrieval.

The official calendar and published event JSON disagree on some session times. For example, the calendar places Poster Session 5 at 11:00–12:30 while the JSON gives 10:30–12:30. Scout consistently uses the calendar; verify the official schedule for last-minute changes. The individual Session 5 page did not expose a time during cross-checking. The sample paper 4419 was checked against its official page and accepted-paper entry (title, author, poster 54, Poster Session 4).

Data uses separate paper, session, and presentation records, preserving official IDs. Missing values are `null`. Times include UTC offsets and display in `Europe/Stockholm`. No PDFs or external images are downloaded by the app.

## Refresh and validation

```sh
cd scout
npm run data:refresh
npm test
npm run typecheck
npm run lint
npm run build
```

Refresh downloads public sources at build time; visitors never scrape ECCV. It validates before an atomic file replacement. Duplicate canonical IDs, broken references, invalid time ranges, conflicting duplicate source records, and a drop greater than 10% in record counts or schedule/poster coverage reject publication. A failed refresh leaves the previous snapshot intact. Coverage and parser warnings are stored in the dataset and printed by the command. Review warnings and official schedule changes before rebuilding.

For repeatable ingestion from downloaded source files:

```sh
python3 scripts/ingest.py --source-dir /path/to/snapshot
```

The folder must contain `eccv-accepted.html`, `eccv-calendar.html`, `eccv-events.json`, and `eccv-abstracts.json`. Use the exact official source URLs above to retrieve them. `public/data/conference.json` is the atomic, versioned normalized snapshot. Rebuild after refreshing; the UI’s Refresh data button reloads the local snapshot, not the upstream conference sources.

## Storage, offline updates, and privacy

Bookmarks use `eccv-scout.profile.v1` in browser localStorage. Export a backup before clearing browser data or changing origins. Profiles contain a schema version, conference identifier, and saved paper IDs. Imports reject malformed or incompatible profiles before changing state. Storage errors leave an in-memory shortlist usable for the current visit.

Production builds precache all exported routes and required assets. Installation fails atomically if any required asset is missing. On localhost, a fully downloaded new build activates and refreshes open app tabs together; saved bookmarks remain intact. On other hosts a new service worker waits for existing tabs to close before activating. Valid data snapshots are cached separately, and a failed or malformed download falls back to the last valid snapshot. Offline availability requires a successful initial online visit and browser storage permission; a new offline visitor cannot download the app.

No personal data is uploaded. Official links open the conference website, whose own policies apply.

## Verification and known limits

Automated coverage includes data validation, full-source deduplication, multiple appearances per paper, combined search filters, accent matching, Stockholm day boundaries, natural poster ordering, profile merging, cross-tab updates, storage failures, malformed refresh fallback, and offline service-worker navigation/cache behavior.

WebMCP registration contracts and shared-state actions are tested with a simulated model context. A live browser WebMCP context has not been verified. Safari/Chrome visual and touch testing has not been performed in this task.

The lint command covers authored application, data tooling, and test code. Unmodified supplied component primitives contain existing lint findings and are excluded from that command. Public hosting, semantic search, recommendations, workshops, and calendar export remain future work.
