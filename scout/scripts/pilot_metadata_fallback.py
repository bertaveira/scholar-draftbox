"""Second pilot pass: broader title terms plus first-author surname; same conservative acceptance rules."""
import collections,json,urllib.parse
import pilot_metadata as pilot

def main():
    data=json.loads((pilot.ROOT/'public/data/conference.json').read_text())
    frequencies=collections.Counter(w for p in data['papers'] for w in set(pilot.norm(p['title']).split()))
    source=json.loads((pilot.OUT/'results.json').read_text())
    if len(source['rows'])!=100: raise ValueError('Complete the first 100-paper pass first.')
    rows=[]
    for original in source['rows']:
        r=dict(original)
        if r['status']=='clear': rows.append(r);continue
        words=set(w for w in pilot.norm(r['title']).split() if len(w)>3)
        terms=sorted(words,key=lambda w:(frequencies[w],-len(w),w))[:3]
        surname=pilot.norm(r['authors'][0]).split()[-1]
        query=' AND '.join(['ti:'+w for w in terms]+['au:'+surname])
        url='https://export.arxiv.org/api/query?'+urllib.parse.urlencode({'search_query':query,'start':0,'max_results':10})
        try:
            response=pilot.fetch(url); cs=pilot.candidates(response['body'])
            combined={c['arxivUrl']:c for c in r['candidates']+cs}
            cs=list(combined.values())
            for c in cs:c['match']=pilot.assess(r,c)
            cs.sort(key=lambda c:(c['match']['clear'],c['match']['titleSimilarity'],c['match']['authorRecall']),reverse=True)
            clear=[c for c in cs if c['match']['clear']]
            r.update(firstPassStatus=original['status'],status='clear' if len(clear)==1 else 'review' if cs else 'no_results',candidates=cs,fallbackQueryUrl=url,fallbackRetrievedAt=response['retrievedAt'])
        except Exception as e: r.update(fallbackError=str(e))
        rows.append(r)
        (pilot.OUT/'fallback-results.json').write_text(json.dumps(dict(source,rows=rows,counts=dict(collections.Counter(x['status'] for x in rows)),fallbackRequests=pilot.requests),indent=2,ensure_ascii=False)+'\n')
        print(r['paperId'],original['status'],'=>',r['status'],flush=True)
    (pilot.OUT/'fallback-results.json').write_text(json.dumps(dict(source,rows=rows,counts=dict(collections.Counter(x['status'] for x in rows)),fallbackRequests=pilot.requests),indent=2,ensure_ascii=False)+'\n')
    print(collections.Counter(x['status'] for x in rows),flush=True)
if __name__=='__main__':main()
