"""Bounded, resumable metadata pilot. Never edits the application dataset."""
import argparse, collections, datetime as dt, difflib, hashlib, json, random, re, time, unicodedata
import urllib.request, urllib.parse, urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'research/abstract-pilot'
CACHE=ROOT/'work/metadata-cache'
NS={'a':'http://www.w3.org/2005/Atom'}

def norm(s):
    return ' '.join(re.findall(r'\w+', ''.join(c for c in unicodedata.normalize('NFKD',s.casefold()) if not unicodedata.combining(c))))
def author(s): return ' '.join(sorted(norm(s).split()))
def assess(p,c):
    a,b=set(map(author,p['authors'])),set(map(author,c['authors']))
    overlap=len(a&b); ratio=overlap/max(1,len(a))
    exact=norm(p['title'])==norm(c['title'])
    similarity=difflib.SequenceMatcher(None,norm(p['title']),norm(c['title'])).ratio()
    clear=exact and overlap>=min(2,len(a)) and ratio>=.6
    return {'exactTitle':exact,'titleSimilarity':round(similarity,4),'matchingAuthors':overlap,'authorRecall':round(ratio,4),'clear':clear}

def candidates(raw):
    root=ET.fromstring(raw)
    if root.tag != "{http://www.w3.org/2005/Atom}feed": raise ValueError("Expected an Atom feed")
    result=[]
    for e in root.findall('a:entry',NS):
        url=e.findtext('a:id','',NS)
        if 'arxiv.org/abs/' not in url: raise ValueError('Unexpected API entry: '+url)
        result.append({'arxivUrl':url.replace('http:','https:'),'title':' '.join(e.findtext('a:title','',NS).split()),'authors':[x.findtext('a:name','',NS) for x in e.findall('a:author',NS)],'abstract':' '.join(e.findtext('a:summary','',NS).split()),'published':e.findtext('a:published','',NS),'updated':e.findtext('a:updated','',NS)})
    return result

last_request=0
requests=0

def cache_path(url, cache_dir=CACHE):
    return cache_dir/(hashlib.sha256(url.encode()).hexdigest()+'.json')

def fetch(url, cache_dir=CACHE, retries=2, sleep_seconds=3.1, retry_delay=10, clock=time.monotonic, sleeper=time.sleep):
    global last_request,requests
    cache_dir.mkdir(parents=True,exist_ok=True)
    path=cache_path(url, cache_dir)
    if path.exists(): return json.loads(path.read_text())
    for attempt in range(retries):
        sleeper(max(0,sleep_seconds-(clock()-last_request)))
        last_request=clock();requests+=1
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'ScholarDraftbox-metadata-pilot/0.1 (research metadata matching)'}),timeout=25) as r:
                raw=r.read().decode()
            result={'url':url,'retrievedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'body':raw}
            candidates(raw) # Don't cache failures as successful empty responses.
            path.write_text(json.dumps(result,ensure_ascii=False))
            return result
        except Exception:
            if attempt: raise
            sleeper(retry_delay)

def query_url(title, max_results=5):
    query='ti:"'+norm(title)+'"'
    return 'https://export.arxiv.org/api/query?'+urllib.parse.urlencode({'search_query':query,'start':0,'max_results':max_results})

def classify(p, cs):
    for c in cs: c['match']=assess(p,c)
    cs.sort(key=lambda c:(c['match']['clear'],c['match']['titleSimilarity'],c['match']['authorRecall']),reverse=True)
    clear=[c for c in cs if c['match']['clear']]
    return 'clear' if len(clear)==1 else 'review' if cs else 'no_results'

def write_jsonl(path, rows):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(''.join(json.dumps(row,ensure_ascii=False,sort_keys=True)+'\n' for row in rows))
    tmp.replace(path)

def run_full(limit=None, output_dir=None, breaker=3, keep_going=True, breaker_cooldown=60):
    """Run the strict title pass for the whole official dataset, resumably.

    Raw API bodies remain in the shared pilot cache. The JSONL artifacts contain
    official IDs and matching evidence only; accepted abstracts are in records.
    """
    global requests
    output_dir=Path(output_dir or (ROOT/'research/abstract-enrichment'))
    data=json.loads((ROOT/'public/data/conference.json').read_text())
    papers=sorted(data['papers'],key=lambda p:p['id'])
    target=papers[:limit] if limit else papers
    state_path=output_dir/'strict-results.jsonl'
    rows=[]
    if state_path.exists():
        by_id={json.loads(line)['paperId']:json.loads(line) for line in state_path.read_text().splitlines() if line.strip()}
        rows=list(by_id.values())
    done={r['paperId'] for r in rows if r.get('status') != 'request_failed'}
    consecutive_errors=0
    for index,p in enumerate(target,1):
        if p['id'] in done: continue
        url=query_url(p['title'])
        row={'paperId':p['id'],'officialTitle':p['title'],'officialAuthors':p['authors'],'queryUrl':url,'source':'arxiv'}
        try:
            response=fetch(url)
            cs=candidates(response['body'])
            status=classify(p,cs)
            row.update(status=status,retrievedAt=response['retrievedAt'],candidateEvidence=[{
                'arxivUrl':c['arxivUrl'],'title':c['title'],'authors':c['authors'],'published':c['published'],'updated':c['updated'],'match':c['match']
            } for c in cs])
            if status=='clear':
                chosen=[c for c in cs if c['match']['clear']][0]
                row['accepted']={'arxivUrl':chosen['arxivUrl'],'abstract':chosen['abstract'],'published':chosen['published'],'updated':chosen['updated'],'sourceVersion':chosen['arxivUrl'].rsplit('v',1)[-1] if 'v' in chosen['arxivUrl'].rsplit('/',1)[-1] else None}
            consecutive_errors=0
        except Exception as exc:
            row.update(status='request_failed',error=repr(exc),candidateEvidence=[])
            consecutive_errors+=1
        rows=[old for old in rows if old['paperId'] != p['id']]
        rows.append(row); done.add(p['id'])
        write_jsonl(state_path,rows)
        counts=collections.Counter(r['status'] for r in rows)
        # Use the sorted target index, not len(rows): retries replace prior
        # failed checkpoint rows, so the unique-row count can temporarily stay
        # flat while progress is still advancing.
        print(f'{index}/{len(target)} {row["status"]} {p["id"]} counts={dict(counts)}',flush=True)
        if consecutive_errors>=breaker:
            if not keep_going:
                print(f'Stopped after {breaker} consecutive request failures; rerun to resume.',flush=True)
                break
            print(f'{breaker} consecutive request failures; cooling down {breaker_cooldown}s before continuing.',flush=True)
            time.sleep(breaker_cooldown)
            consecutive_errors=0
    accepted=[]; evidence=[]; review=[]
    for r in rows:
        evidence.append({k:v for k,v in r.items() if k not in ('accepted',)})
        if r.get('accepted'): accepted.append({'paperId':r['paperId'],'officialTitle':r['officialTitle'],'arxivUrl':r['accepted']['arxivUrl'],'abstract':r['accepted']['abstract'],'source':'arxiv','sourceVersion':r['accepted']['sourceVersion'],'published':r['accepted']['published'],'updated':r['accepted']['updated'],'retrievedAt':r.get('retrievedAt')})
        if r['status'] in ('review','no_results','request_failed'): review.append(r)
    write_jsonl(output_dir/'enrichment-records.jsonl',accepted)
    write_jsonl(output_dir/'matching-evidence.jsonl',evidence)
    write_jsonl(output_dir/'review-queue.jsonl',review)
    summary={'datasetVersion':data['version'],'paperCount':len(papers),'processedRows':len(rows),'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'counts':dict(collections.Counter(r['status'] for r in rows)),'requestsThisRun':requests,'artifacts':{'records':'enrichment-records.jsonl','evidence':'matching-evidence.jsonl','review':'review-queue.jsonl','state':'strict-results.jsonl'}}
    (output_dir/'coverage.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary['counts']),flush=True)
    return summary

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int,default=100);parser.add_argument('--full',action='store_true');parser.add_argument('--output-dir');parser.add_argument('--breaker',type=int,default=3);parser.add_argument('--stop-on-breaker',action='store_true');args=parser.parse_args()
    if args.full:
        run_full(output_dir=args.output_dir,breaker=args.breaker,keep_going=not args.stop_on_breaker); return
    data=json.loads((ROOT/'public/data/conference.json').read_text()); papers=sorted(data['papers'],key=lambda p:p['id'])
    OUT.mkdir(parents=True,exist_ok=True)
    sample_path=OUT/'sample.json'
    if sample_path.exists(): sample=json.loads(sample_path.read_text())
    else:
        rng=random.Random(20260905); randoms=rng.sample(papers,80); used={p['id'] for p in randoms}
        tricky=[p for p in papers if p['id'] not in used and (len(p['title'].split())<=6 or re.search(r'[^\x00-\x7f]|[${}]',p['title']))]
        extra=rng.sample(tricky,20)
        sample={'datasetVersion':data['version'],'seed':20260905,'selection':'80 random papers plus 20 short/non-ASCII/math titles, without overlap','papers':[dict(p,sampleGroup='random' if p['id'] in used else 'challenge') for p in randoms+extra]}
        sample_path.write_text(json.dumps(sample,indent=2,ensure_ascii=False)+'\n')
    rows=[]; consecutive_errors=0
    for p in sample['papers'][:args.limit]:
        query='ti:"'+norm(p['title'])+'"'
        url='https://export.arxiv.org/api/query?'+urllib.parse.urlencode({'search_query':query,'start':0,'max_results':5})
        row={'paperId':p['id'],'title':p['title'],'authors':p['authors'],'sampleGroup':p['sampleGroup'],'queryUrl':url}
        try:
            response=fetch(url); cs=candidates(response['body'])
            for c in cs: c['match']=assess(p,c)
            cs.sort(key=lambda c:(c['match']['clear'],c['match']['titleSimilarity'],c['match']['authorRecall']),reverse=True)
            clear=[c for c in cs if c['match']['clear']]
            row.update(status='clear' if len(clear)==1 else 'review' if cs else 'no_results',candidates=cs,retrievedAt=response['retrievedAt'])
            consecutive_errors=0
        except Exception as e:
            row.update(status='request_failed',error=str(e),candidates=[]);consecutive_errors+=1
        rows.append(row)
        result={'datasetVersion':data['version'],'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'requestsThisRun':requests,'counts':dict(collections.Counter(r['status'] for r in rows)),'rows':rows}
        (OUT/'results.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
        print(f"{len(rows)}/{args.limit} {row['status']} {p['id']}",flush=True)
        if consecutive_errors>=3:
            print('Stopped after three consecutive request failures; rerun to resume cached successes.',flush=True);break
    print(json.dumps(result['counts']),flush=True)
if __name__=='__main__': main()
