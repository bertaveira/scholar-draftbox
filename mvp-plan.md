# ECCV Scout — First MVP

## Summary

Build a phone-friendly local app that lets attendees **find papers, save them, and see which posters to visit in each session**.

Keep `eccv-scout-build-plan.md` unchanged as the long-term reference. Save this implementation plan separately as `mvp-plan.md` when implementation begins.

The first deliverable is a working local preview using real ECCV 2026 main-conference data. Semantic search and public deployment follow later.

## Product and interface

- **Explore (`/`):** keyword search across titles, authors, available abstracts, and topics; filters for day, session, presentation type, and available topics. Show result counts and a clear reset action.
- **Paper details:** open a detail panel with authors, abstract, official links, all known presentations, and a Save button.
- **Saved (`/saved`):** group saved papers by conference day and session, with a separate group for papers lacking schedule information.
- **Session (`/session/:id`):** show session time, room, and saved posters prominently. Default to natural poster-number order; allow browsing all papers in the session.
- Saving means bookmarking, not committing to attend. Do not add conflict warnings, attendance controls, or calendar export in this release.
- Use a compact, high-contrast interface with white surfaces, dark text, blue accents, prominent poster numbers, and large touch targets. Open directly on search and results.
- Include loading, empty, missing-data, offline, and storage-failure states; display source links, data freshness, and the unofficial-project disclaimer.

## Implementation

**Data first**

- Inspect the official accepted-paper list, paper pages, and schedule; identify the public data backing their JavaScript interfaces.
- Build a repeatable ingestion and validation command. Use official data only for this release; missing abstracts do not block inclusion.
- Separate `Paper`, `Session`, and `Presentation` records. A presentation links a paper to a session and holds its presentation type and poster number.
- Preserve official identifiers where available, maintain stable IDs across refreshes, use nullable unknown fields, and interpret conference times in `Europe/Stockholm`.
- Publish one versioned dataset with source URLs and retrieval time. Report paper count and coverage of abstracts, session assignments, times, and poster numbers.
- Reject duplicate IDs, broken relationships, invalid time ranges, and unexpectedly large dataset reductions. Retain the previous valid snapshot on failure.
- If official schedule details are unavailable, show “Schedule not available”; do not fabricate poster assignments or call the venue-use milestone complete.

**App and local state**

- Scaffold a React/TypeScript app using the Sites starter, its existing routing conventions, Tailwind, and supplied accessible components. Keep this release local.
- Run search and filters entirely in the browser using Fuse.js, prioritizing title matches. Render results in batches of 50.
- Store a versioned list of saved paper IDs in `localStorage`, shared across views and browser tabs.
- Provide JSON export/import for laptop-to-phone transfer. Validate imports before changing saved state; merge and deduplicate IDs. Preserve unrecognized saved IDs with an unavailable-paper notice.
- Cache the app shell and the complete loaded dataset for offline reuse. Show an offline indicator and cached-data timestamp. Apply refreshed datasets as complete versions.
- Add a minimal WebMCP surface for searching papers and saving/removing bookmarks, sharing the same application logic.
- No accounts, database, server API, analytics, embeddings, recommendations, or automated deployment.

## Build sequence and verification

1. **Establish reliable data:** produce the normalized dataset and coverage report; verify representative records against official sources.
2. **Deliver the first working preview:** show real paper cards, keyword search, and saving in the selected visual style.
3. **Complete the core journey:** filters, detail panel, Saved grouping, and poster-session view.
4. **Make it resilient:** import/export, offline caching, missing-data handling, documentation, and production build.

Verify:

- One paper can have both oral and poster presentations without duplicate bookmarks.
- Search handles titles, author names, acronyms, accents, and combined filters.
- Saved state survives reloads; importing merges correctly; invalid imports leave existing state intact.
- Session grouping respects conference-local time and handles missing metadata.
- A previously loaded dataset remains browsable offline.
- Malformed refreshes cannot replace valid data.
- Type checks, focused data/state tests, and the production build pass.

## Completion criteria and defaults

The MVP is complete when an attendee can search real papers, save several, reopen the app, and find their saved posters grouped into the correct sessions—with export/import and offline reuse available.

Default scope is main-conference papers only. Workshops, calendar export, attendance planning, semantic search, personalized recommendations, and public Cloudflare hosting remain in the reference roadmap.
