"""Render a compact coverage/review report for the separate full-pass artifacts."""
import json
import pilot_metadata as p

def main():
    out=p.ROOT/'research/abstract-enrichment'
    coverage=json.loads((out/'coverage.json').read_text())
    counts=coverage['counts']
    decisions=[json.loads(line) for line in (out/'llm-adjudication.jsonl').read_text().splitlines() if line.strip()]
    accepted_review=sum(d['decision']=='accept_match' for d in decisions)
    review=sum(1 for line in (out/'review-queue.jsonl').read_text().splitlines() if line.strip())
    lines=['# ECCV abstract/arXiv enrichment coverage','',f"Dataset version: `{coverage['datasetVersion']}`; official papers: {coverage['paperCount']}.",'','| Classification | Count |','|---|---:|']
    for key in ('clear','review','no_results','request_failed'):
        lines.append(f"| {key} | {counts.get(key,0)} |")
    lines += ['',f'Review queue rows: {review}. `no_results` means a successful empty API feed; `request_failed` means the request or response validation failed.', '', f'{accepted_review} of the review candidates were subsequently accepted. The app imports {counts.get("clear",0)+accepted_review} matched links and sourced abstracts using `npm run data:links`. Official titles, authors, and schedules are preserved.', '', 'Source and audit artifacts:', '', '- `enrichment-records.jsonl`: accepted abstracts and arXiv provenance', '- `matching-evidence.jsonl`: official identity fields, query provenance, candidates and match metrics', '- `review-queue.jsonl`: ambiguous, empty, and failed rows', '- `llm-adjudication.jsonl`: accepted/rejected review decisions', '- `reviewed-abstracts.jsonl`: accepted review abstracts recovered from cached arXiv responses', '- `strict-results.jsonl`: local-only resumable checkpoint (ignored by Git)', '- `coverage.json`: machine-readable counts and dataset/version guard']
    (out/'coverage.md').write_text('\n'.join(lines)+'\n')
if __name__=='__main__': main()
