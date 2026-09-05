"""Produce auditable pilot summary and candidate table without touching app data."""
import collections,csv,json
import pilot_metadata as p

def main():
    result=json.loads((p.OUT/'fallback-results.json').read_text()); first=json.loads((p.OUT/'results.json').read_text())
    rows=result['rows']; counts=collections.Counter(r['status'] for r in rows)
    accepted=[r for r in rows if r['status']=='clear']; abstracts=sum(bool(r['candidates'][0]['abstract']) for r in accepted)
    with (p.OUT/'review.csv').open('w') as f:
        w=csv.writer(f,lineterminator="\n");w.writerow(['paperId','group','status','ECCV title','arXiv title','arXiv URL','author matches','ECCV author count','title similarity','abstract characters','ECCV authors','arXiv authors'])
        for r in rows:
            c=r['candidates'][0] if r['candidates'] else {};m=c.get('match',{})
            w.writerow([r['paperId'],r['sampleGroup'],r['status'],r['title'],c.get('title',''),c.get('arxivUrl',''),m.get('matchingAuthors',''),len(r['authors']),m.get('titleSimilarity',''),len(c.get('abstract','')),'; '.join(r['authors']),'; '.join(c.get('authors',[]))])
    lines=['# Abstract and arXiv metadata pilot','',f"Dataset: `{result['datasetVersion']}`. Sample: 80 reproducibly random papers plus 20 short/non-ASCII/math-title challenge papers; seed 20260905. These are separate strata, not an unbiased 100-paper coverage estimate.",'','## Results','', '| Group | Papers | Clear matches | Review candidates | No results | Request failures |','|---|---:|---:|---:|---:|---:|']
    for group in ['random','challenge']:
        rs=[r for r in rows if r['sampleGroup']==group];cs=collections.Counter(r['status'] for r in rs)
        lines.append(f"| {group} | {len(rs)} | {cs['clear']} | {cs['review']} | {cs['no_results']} | {cs['request_failed']} |")
    lines += ['',f"First pass: {first['counts']}. After fallback: {dict(counts)}.",f"All {len(accepted)} clear matches have arXiv URLs; {abstracts} have nonempty abstracts.",'','## Method and limits','',
    'First pass searches the normalized full title. Fallback searches three distinctive title terms plus first-author surname. Candidate matching requires an exact normalized title, at least two matching full author names (one for single-author papers), and at least 60% of the official authors. Multiple qualifying candidates go to review. Similar titles alone are never automatically accepted.',
    'Normalization ignores capitalization, punctuation, accents and name-token order; it does not invent missing names or expand initials. The 60% threshold is a pilot rule, not a calibrated probability. Author changes and differently titled preprints require scrutiny.',
    'The official abstract endpoint still returned {}. Three official paper pages had no arXiv links or rendered abstract-content elements. This is a spot check, not proof that every official page lacks metadata.',
    'This run makes no per-paper language-model calls. API responses are cached locally under work/metadata-cache. Collection uses a single connection with at least 3.1 seconds between requests. Request failures remain separate from no-results responses.',
    'No-results means these two queries found no candidate, not that the paper has no preprint. Search indexing, title changes and upload timing may affect recall. A manual audit of returned candidates cannot establish recall for missing papers.',
    'Abstracts are copied from arXiv metadata, not generated or extracted from PDFs. They may describe a preprint version rather than the final accepted manuscript. Source URLs and timestamps are retained in JSON.',
    'The app dataset and UI remain unchanged. This research output is not bundled or published.',
    '', '## Reproduce','', 'From the repository root:', '```sh','python3 -u scout/scripts/pilot_metadata.py','python3 -u scout/scripts/pilot_metadata_fallback.py','python3 scout/scripts/pilot_metadata_report.py','python3 -m unittest discover -s scout/scripts -p "test_pilot_metadata.py"','```','',
    'Run collection commands sequentially, not concurrently. The sample is fixed in sample.json. Successful query responses are reused; raw cache files remain local. results.json holds the first pass; fallback-results.json contains the combined candidates; review.csv is the review table.',
    '', 'Sources: [arXiv API](https://info.arxiv.org/help/api/user-manual.html), [arXiv rate limits and metadata terms](https://info.arxiv.org/help/api/tou.html), [official abstract endpoint](https://eccv.ecva.net/static/virtual/data/eccv-2026-abstracts.json).','']
    lines += ["## Pilot review and recommendation", "",
        "Eight clear matches were spot-checked against retrieved titles, author lists and abstract openings. The twelve clear matches with differing normalized author sets were also inspected. No obvious wrong-work match was observed in these checks; this is not an independent accuracy guarantee. See audit.json for scope and decisions.", "",
        "Of the three review sets: eccv-2026-3333 is supported by exact title and matching names with added middle initials; eccv-2026-5519 is a probable match with an LLM/VLM title change and all three authors matching; all candidates for eccv-2026-5542 were rejected as unrelated. Thus 70 automatic matches, one additional metadata-supported match, one probable match needing confirmation, and 28 unresolved papers.", "",
        "The 80-paper random stratum yielded 58 automatic matches (72.5%); the 20 challenge papers yielded 12 (60%). Do not assume these percentages will hold exactly for all 2,863 papers.", "",
        "The two collection passes made 100 + 30 API requests with no failures or retries; a separate initial connectivity probe also queried arXiv once. There were zero per-paper model API calls. A conversational assistant reviewed the small audit subset.", "",
        "Recommendation: expand the strict scripted pass first, retain source/version provenance, and keep ambiguous cases separate. Before scaling the fallback, test another metadata index on the 28 unresolved cases: these 30 broader arXiv queries added only one probable renamed match. A carefully tested middle-initial rule could resolve the other review case without an LLM. No full-dataset run has started.", ""]
    (p.OUT/'report.md').write_text('\n'.join(lines))
if __name__=='__main__':main()
