# ECCV abstract/arXiv enrichment coverage

Dataset version: `ae6392c8841f5e10`; official papers: 2863.

| Classification | Count |
|---|---:|
| clear | 1813 |
| review | 68 |
| no_results | 982 |
| request_failed | 0 |

Review queue rows: 1050. `no_results` means a successful empty API feed; `request_failed` means the request or response validation failed.

67 of the review candidates were subsequently accepted. The app imports 1880 matched links and sourced abstracts using `npm run data:links`. Official titles, authors, and schedules are preserved.

Source and audit artifacts:

- `enrichment-records.jsonl`: accepted abstracts and arXiv provenance
- `matching-evidence.jsonl`: official identity fields, query provenance, candidates and match metrics
- `review-queue.jsonl`: ambiguous, empty, and failed rows
- `llm-adjudication.jsonl`: accepted/rejected review decisions
- `reviewed-abstracts.jsonl`: accepted review abstracts recovered from cached arXiv responses
- `strict-results.jsonl`: local-only resumable checkpoint (ignored by Git)
- `coverage.json`: machine-readable counts and dataset/version guard
