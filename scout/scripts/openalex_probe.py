"""Probe OpenAlex for the pilot's unresolved papers; never changes app data."""
import argparse, datetime as dt, hashlib, json, time, urllib.parse, urllib.request
from pathlib import Path
import pilot_metadata as arxiv

OUT=arxiv.ROOT/'research/abstract-pilot'
CACHE=arxiv.ROOT/'work/openalex-cache'
# The pilot audit classified these review rows as supported or rejected; the
# unresolved set is the 27 no-results plus the one probable match.
EXCLUDED_REVIEW_IDS={'eccv-2026-3333','eccv-2026-5542'}

def abstract_from_inverted(index):
    if not index: return ''
    words=[]
    for word, positions in index.items():
        words.extend((position,word) for position in positions)
    return ' '.join(word for _,word in sorted(words))

def fetch(url, retries=2, sleep_seconds=1.1):
    CACHE.mkdir(parents=True,exist_ok=True)
    path=CACHE/(hashlib.sha256(url.encode()).hexdigest()+'.json')
    if path.exists(): return json.loads(path.read_text())
    for attempt in range(retries):
        if attempt or fetch.last:
            time.sleep(max(0,sleep_seconds-(time.monotonic()-fetch.last)))
        fetch.last=time.monotonic()
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'ECCVplanner metadata probe/0.1'})
            with urllib.request.urlopen(req,timeout=25) as response: body=response.read().decode()
            json.loads(body)
            result={'url':url,'retrievedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'body':body}
            path.write_text(json.dumps(result,ensure_ascii=False))
            return result
        except Exception:
            if attempt+1==retries: raise
            time.sleep(10)
fetch.last=0

def works(raw):
    data=json.loads(raw); result=[]
    for item in data.get('results',[]):
        authors=[((a.get('author') or {}).get('display_name') or '') for a in item.get('authorships',[])]
        result.append({'openAlexId':item.get('id'),'title':item.get('title') or '','authors':authors,
                       'abstract':abstract_from_inverted(item.get('abstract_inverted_index')),
                       'published':item.get('publication_date'),'updated':item.get('updated_date'),
                       'doi':item.get('doi')})
    return result

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--limit',type=int); args=ap.parse_args()
    source=json.loads((OUT/'fallback-results.json').read_text())
    unresolved=[r for r in source['rows'] if r['status']=='no_results' or (r['status']=='review' and r['paperId'] not in EXCLUDED_REVIEW_IDS)]
    if args.limit: unresolved=unresolved[:args.limit]
    rows=[]
    state=OUT/'openalex-probe.jsonl'
    unresolved_ids={r['paperId'] for r in unresolved}
    if state.exists():
        by_id={item['paperId']:item for line in state.read_text().splitlines() if line.strip() for item in [json.loads(line)] if item.get('paperId') in unresolved_ids}
        rows=list(by_id.values())
    # Successful classifications are resumable; failed requests are retried.
    done={r['paperId'] for r in rows if r.get('status') != 'request_failed'}
    for r in unresolved:
        if r['paperId'] in done: continue
        url='https://api.openalex.org/works?'+urllib.parse.urlencode({'search':r['title'],'per-page':10})
        out={'paperId':r['paperId'],'officialTitle':r['title'],'officialAuthors':r['authors'],'queryUrl':url,'source':'openalex'}
        try:
            response=fetch(url); cs=works(response['body'])
            for c in cs: c['match']=arxiv.assess(r,c)
            cs.sort(key=lambda c:(c['match']['clear'],c['match']['titleSimilarity'],c['match']['authorRecall']),reverse=True)
            clear=[c for c in cs if c['match']['clear']]
            out.update(status='clear' if len(clear)==1 else 'review' if cs else 'no_results',retrievedAt=response['retrievedAt'],candidates=cs)
        except Exception as exc: out.update(status='request_failed',error=repr(exc),candidates=[])
        rows=[old for old in rows if old['paperId'] != r['paperId']]
        rows.append(out); state.write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows)); print(r['paperId'],out['status'],flush=True)
    counts={};
    for r in rows: counts[r['status']]=counts.get(r['status'],0)+1
    summary={'source':'OpenAlex','pilotUnresolvedCount':len(unresolved),'processed':len(rows),'counts':counts,'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
    (OUT/'openalex-probe-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(counts),flush=True)
if __name__=='__main__': main()
