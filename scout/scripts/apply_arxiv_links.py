"""Apply accepted research links and abstracts to the versioned snapshot; never infer new matches."""
import copy, hashlib, json, re
from pathlib import Path
from ingest import publish
ROOT=Path(__file__).resolve().parents[1]
ARXIV=re.compile(r'https://arxiv\.org/abs/(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?$')
def read_rows(path): return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
def accepted_links(directory):
    records=read_rows(directory/'enrichment-records.jsonl')
    reviewed_abstracts={r['paperId']:r for r in read_rows(directory/'reviewed-abstracts.jsonl')} if (directory/'reviewed-abstracts.jsonl').exists() else {}
    reviews={r['paperId']:r for r in read_rows(directory/'review-queue.jsonl')}
    for decision in read_rows(directory/'llm-adjudication.jsonl'):
        if decision['decision']!='accept_match': continue
        row=reviews[decision['paperId']]
        url=decision['selectedSourceUrl']
        if not any(c['arxivUrl']==url for c in row['candidateEvidence']):
            raise ValueError('Accepted URL missing from retrieved evidence: '+decision['paperId'])
        record={'paperId':row['paperId'],'officialTitle':row['officialTitle'],'arxivUrl':url,'retrievedAt':row['retrievedAt']}
        if row['paperId'] in reviewed_abstracts:
            stored=reviewed_abstracts[row['paperId']]
            if stored['arxivUrl']!=url or stored['officialTitle']!=row['officialTitle']: raise ValueError('Reviewed abstract identity mismatch')
            record.update(stored)
        records.append(record)
    return records

def apply_links(data, records):
    result=copy.deepcopy(data); papers={p['id']:p for p in result['papers']};seen=set()
    for record in records:
        pid=record['paperId'];url=record['arxivUrl']
        if pid in seen or pid not in papers: raise ValueError('Duplicate or unknown paper: '+pid)
        seen.add(pid)
        if papers[pid]['title']!=record['officialTitle']: raise ValueError('Official title changed: '+pid)
        if not ARXIV.fullmatch(url): raise ValueError('Invalid arXiv URL')
        abstract=record.get('abstract')
        if abstract is not None and (not isinstance(abstract,str) or not abstract.strip()): raise ValueError('Invalid abstract')
        if abstract and (not papers[pid].get('abstract') or papers[pid].get('abstractSource',{}).get('name')=='arxiv'):
            papers[pid]['abstract']=abstract.strip()
            papers[pid]['abstractSource']={'name':'arxiv','url':url,'retrievedAt':record['retrievedAt'],'version':record.get('sourceVersion')}
        papers[pid]['paperUrl']=url
        papers[pid]['paperLinkRetrievedAt']=record['retrievedAt']
    result['coverage']['abstracts']=sum(bool(p.get('abstract')) for p in result['papers'])
    result['coverage']['arxivAbstracts']=sum(p.get('abstractSource',{}).get('name')=='arxiv' for p in result['papers'])
    result['coverage']['arxivLinks']=sum(bool(ARXIV.fullmatch(p['paperUrl'] or '')) for p in result['papers'])
    if 'https://export.arxiv.org/api/query' not in result['sources']: result['sources'].append('https://export.arxiv.org/api/query')
    result['version']=hashlib.sha256(json.dumps([result['papers'],result['sessions'],result['presentations']],sort_keys=True).encode()).hexdigest()[:16]
    return result

def main():
    path=ROOT/'public/data/conference.json'
    result=apply_links(json.loads(path.read_text()),accepted_links(ROOT/'research/abstract-enrichment'))
    publish(result,path);print(f"Published {result['coverage']['arxivLinks']} arXiv links and {result['coverage']['arxivAbstracts']} sourced abstracts")
if __name__=='__main__':main()
