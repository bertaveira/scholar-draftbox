# Metadata enrichment evidence

These files document the metadata collection and matching decisions. They are not served as website assets. The app uses the normalized snapshot at `public/data/conference.json`.

- `abstract-pilot/`: fixed sample, query results, audit notes, and the 100-paper pilot report. The OpenAlex probe is historical exploratory output, not an import source.
- `abstract-enrichment/`: full-run coverage, accepted records, matching evidence, review queue and adjudication decisions. `reviewed-abstracts.jsonl` preserves the accepted review abstracts recovered from cached source responses.

Run `npm run data:links` from the repository root to validate and apply the accepted links and abstracts. This requires no network access or raw cache files. Official ingestion also reapplies this enrichment when these artifacts are present. Build afterwards to update the preview/offline bundle.

Raw HTTP caches under `work/` and the redundant full-run `strict-results.jsonl` checkpoint remain local and ignored. Keep them locally to resume collection without unnecessary API calls. The scripts for collection and historical reports live in `scripts/`; the app import does not rerun them or infer new matches.

Collection reports retain the original official dataset version. The enriched app snapshot has a new content version. Unmatched and rejected candidates are not imported.
