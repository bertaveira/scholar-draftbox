"""Official ECCV HTML ingestion. Standard library only; validate before atomic publish."""
import argparse, datetime as dt, hashlib, json, os, re, urllib.request, unicodedata
from pathlib import Path
from html.parser import HTMLParser
from zoneinfo import ZoneInfo
BASE = 'https://eccv.ecva.net'
SOURCES = {'accepted': BASE+'/Conferences/2026/AcceptedPapers', 'calendar': BASE+'/virtual/2026/calendar', 'events': BASE+'/static/virtual/data/eccv-2026-orals-posters.json', 'abstracts': BASE+'/static/virtual/data/eccv-2026-abstracts.json'}
class Node:
    def __init__(self, tag='', attrs=(), parent=None): self.tag,self.attrs,self.parent,self.children=tag,dict(attrs),parent,[]
    def text(self): return re.sub(r'\s+', ' ', ''.join(c.text() if isinstance(c,Node) else c for c in self.children)).strip()
    def has(self, name): return name in self.attrs.get('class','').split()
    def all(self, tag=None, cls=None):
        for c in self.children:
            if isinstance(c,Node):
                if (tag is None or c.tag==tag) and (cls is None or c.has(cls)): yield c
                yield from c.all(tag,cls)
    def ancestor(self, cls):
        p=self.parent
        while p:
            if p.has(cls): return p
            p=p.parent
class Parser(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True); self.root=Node(); self.current=self.root; self.feed(text)
    def handle_starttag(self,t,a):
        n=Node(t,a,self.current); self.current.children.append(n)
        if t not in ('br','hr','img','input','meta','link','source','wbr','area','base','embed'): self.current=n
    def handle_endtag(self,t):
        n=self.current
        while n.parent:
            if n.tag==t: self.current=n.parent; return
            n=n.parent
    def handle_data(self,d): self.current.children.append(d)
def first(n,tag=None,cls=None): return next(n.all(tag,cls),None) if n else None
def clean(t): return re.sub(r'\s+',' ',t or '').strip()
def norm(t): return clean(t).casefold()
def clock(t):
    t=t.lower().replace('.','').strip(); m=re.search(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)',t)
    if t == 'noon': return 12,0
    if t == 'midnight': return 0,0
    if not m: raise ValueError('Unrecognized clock: '+t)
    h,mi,ap=m.groups(); return int(h)%12+(12 if ap=='pm' else 0),int(mi or 0)
def normalize(raw):
    accepted=Parser(raw['accepted']).root; calendar=Parser(raw['calendar']).root
    events=json.loads(raw.get('events','{"results":[]}'))['results']; abstracts=json.loads(raw.get('abstracts','{}'))
    room_names={}
    for option in calendar.all('option'):
        value=option.attrs.get('value','')
        slug=re.sub(r'[^a-z0-9]+','-',unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().lower()).strip('-')
        if value: room_names[slug]=value
    papers={}; row_signatures={}; bytitle={}; presentations=[]; sessions={}; warnings=[]
    for row in accepted.all('tr'):
        links=[a for a in row.all('a') if re.match(r'/virtual/2026/poster/\d+$',a.attrs.get('href',''))]
        if not links: continue
        a=links[0]; eid=a.attrs['href'].split('/')[-1]; pid='eccv-2026-'+eid
        if pid in papers:
            if row_signatures[pid] != row.text(): raise ValueError('Conflicting duplicate paper '+pid)
            continue
        row_signatures[pid]=row.text()
        author=first(row,cls='indented'); topic=first(row,cls='elc-keywords'); where=first(row,cls='elc-where'); w=where.text() if where else ''
        position=re.search(r'Poster Location:\s*#?\s*([^ ]+)',w); room=re.search(r'In Room:\s*(.*?)\s*Poster Location:',w)
        p={'id':pid,'officialId':eid,'title':a.text(),'authors':[clean(x) for x in re.split(r'\s*[·•⋅]\s*',author.text()) if clean(x)] if author else [],'topics':[clean(x) for x in re.split(r'[·•⋅]',topic.text()) if clean(x)] if topic else [],'abstract':abstracts.get(eid) or None,'officialUrl':BASE+a.attrs['href'],'paperUrl':None}
        papers[pid]=p; bytitle[norm(p['title'])]=pid
        presentations.append({'id':'event-'+eid,'paperId':pid,'sessionId':None,'type':'poster','posterNumber':position.group(1) if position else None,'room':room.group(1) if room else None,'officialUrl':p['officialUrl']})
    poster_map={p['id']:p for p in presentations}
    for block in calendar.all(cls='sessiontitle'):
        a=first(block,'a'); box=block.ancestor('timebox'); day=block.ancestor('container2')
        if not a or not box or not day or '/session/' not in a.attrs.get('href',''): continue
        date_text=first(day,cls='hdrbox').text(); dm=re.search(r'(\d+)\s+SEP',date_text)
        if not dm or int(dm.group(1)) not in (10,11,12): continue
        sid='session-'+a.attrs['href'].split('/')[-1]; span=first(a,cls='sessiontime'); time_text=span.text() if span else ''
        name=clean(a.text().replace(time_text,'')); time_node=next((c for c in box.children if isinstance(c,Node) and c.has('time')),None)
        if not time_node: continue
        h,mi=clock(time_node.text()); start=dt.datetime(2026,9,int(dm.group(1)),h,mi,tzinfo=ZoneInfo('Europe/Stockholm'))
        end=None; match=re.search(r'[-–](\d{1,2}):(\d{2})',time_text)
        if match:
            eh,em=map(int,match.groups()); eh=eh%12+(12 if h>=12 else 0)
            end=start.replace(hour=eh,minute=em)
            if end<=start: end+=dt.timedelta(hours=12)
        parent=block.parent.parent
        room_class=next((x[5:] for x in parent.attrs.get('class','').split() if x.startswith('room-')),None)
        room=room_names.get(room_class) or {'exhall':'ExHall','arena-room':'Arena Room','ab':'AB'}.get(room_class)
        session={'id':sid,'name':name,'startsAt':start.isoformat(),'endsAt':end.isoformat() if end else None,'room':room,'officialUrl':BASE+a.attrs['href'],'kind':next((kind for kind in ('poster','oral','spotlight','demo') if name.lower().startswith(kind)), 'ceremony')}
        sessions[sid]=session
        for link in parent.all('a'):
            href=link.attrs.get('href',''); m=re.match(r'/virtual/2026/(poster|oral)/(\d+)$',href)
            if not m: continue
            typ,eid=m.groups(); pid='eccv-2026-'+eid if typ=='poster' else bytitle.get(norm(link.text()))
            if pid not in papers:
                warnings.append('Unmatched '+href); continue
            if typ=='poster':
                presentation=poster_map['event-'+eid]
                if presentation['sessionId'] and presentation['sessionId']!=sid: raise ValueError('Multiple poster sessions '+eid)
                presentation['sessionId']=sid
                if not presentation['room']: presentation['room']=room
            elif not any(p['id']=='event-'+eid for p in presentations):
                presentations.append({'id':'event-'+eid,'paperId':pid,'sessionId':sid,'type':'oral','posterNumber':None,'room':room,'officialUrl':BASE+href})
        # The calendar renders oral/spotlight titles as text without event links.
        for content in parent.all(cls='content'):
            typ='oral' if content.has('oral') else 'spotlight' if content.has('spotlight') else None
            if not typ: continue
            title=re.sub(r'^\[.*?\]\s*','',content.text())
            pid=bytitle.get(norm(title))
            if not pid:
                warnings.append('Unmatched '+typ+': '+title); continue
            if any(p['paperId']==pid and p['sessionId']==sid and p['type']==typ for p in presentations): continue
            presentations.append({'id':sid+'-'+typ+'-'+pid,'paperId':pid,'sessionId':sid,'type':typ,'posterNumber':None,'room':room,'officialUrl':session['officialUrl']})
    # Non-paper program events use the calendar's own clock and explicit end time.
    kinds={'invited-talk':'keynote','panel':'panel','break':'break','reception':'social','social':'social','mentorship':'mentorship'}
    for title in calendar.all(cls='title-style'):
        parent=title.parent; a=first(title,'a'); box=title.ancestor('timebox'); day=title.ancestor('container2')
        kind=next((value for css,value in kinds.items() if parent.has(css)),None)
        if not kind or not a or not box or not day: continue
        heading=first(day,cls='hdrbox'); dm=re.search(r'(\d+)\s+SEP',heading.text() if heading else '')
        if not dm or int(dm.group(1)) not in (10,11,12): continue
        time_node=next((c for c in box.children if isinstance(c,Node) and c.has('time')),None)
        if not time_node: continue
        hour,minute=clock(time_node.text()); start=dt.datetime(2026,9,int(dm.group(1)),hour,minute,tzinfo=ZoneInfo('Europe/Stockholm'))
        end_node=first(parent,cls='end-time'); end=None
        if end_node:
            eh,em=clock(end_node.text()); end=start.replace(hour=eh,minute=em)
            if end<=start: end+=dt.timedelta(days=1)
        href=a.attrs.get('href','')
        if not re.match(r'/virtual/2026/[a-z-]+/\d+$',href): continue
        sid='calendar-'+href.split('/')[-1]+'-'+start.date().isoformat()
        room_class=next((x[5:] for x in parent.attrs.get('class','').split() if x.startswith('room-')),None)
        speaker=first(parent,cls='speaker-style')
        sessions[sid]={'id':sid,'name':a.text(),'startsAt':start.isoformat(),'endsAt':end.isoformat() if end else None,'room':room_names.get(room_class),'officialUrl':BASE+href,'kind':kind,'speaker':speaker.text() if speaker else None}

    # Enrich only records that are actually present in the published JSON, never treat it as complete.
    for e in events:
        pid='eccv-2026-'+str(e['id'])
        if pid in papers:
            p=papers[pid]; p['authors']=[clean(a['fullname']) for a in e['authors']]; p['abstract']=e.get('abstract') or p['abstract']; p['paperUrl']=e.get('paper_pdf_url') or None
    data={'schemaVersion':1,'version':'','retrievedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'timezone':'Europe/Stockholm','sources':list(SOURCES.values()),'papers':sorted(papers.values(),key=lambda p:p['title'].casefold()),'sessions':sorted(sessions.values(),key=lambda s:(s['startsAt'],s['name'])),'presentations':presentations}
    data['version']=hashlib.sha256(json.dumps([data['papers'],data['sessions'],data['presentations']],sort_keys=True).encode()).hexdigest()[:16]
    report={'papers':len(papers),'sessions':len(sessions),'presentations':len(presentations),'abstracts':sum(bool(p['abstract']) for p in papers.values()),'withSession':sum(any(x['paperId']==p and x['sessionId'] for x in presentations) for p in papers),'posterNumbers':sum(bool(p['posterNumber']) for p in presentations),'timedSessions':sum(bool(s['startsAt'] and s['endsAt']) for s in sessions.values()),'warnings':sorted(set(warnings))}
    data['coverage']=report
    return data

def validate(data, previous=None):
    if data.get('schemaVersion')!=1 or data.get('timezone')!='Europe/Stockholm': raise ValueError('Invalid dataset header')
    for kind in ('papers','sessions','presentations'):
        ids=[x['id'] for x in data[kind]]
        if len(ids)!=len(set(ids)): raise ValueError('Duplicate '+kind+' IDs')
    pids={p['id'] for p in data['papers']}; sids={s['id'] for s in data['sessions']}
    if not pids or any(not p['title'].strip() for p in data['papers']): raise ValueError('Missing papers/titles')
    for p in data['presentations']:
        if p['paperId'] not in pids or (p['sessionId'] is not None and p['sessionId'] not in sids): raise ValueError('Broken presentation reference')
    for s in data['sessions']:
        for key in ('startsAt','endsAt'):
            if s[key] and dt.datetime.fromisoformat(s[key]).tzinfo is None: raise ValueError('Missing timezone')
        if s['startsAt'] and s['endsAt'] and dt.datetime.fromisoformat(s['endsAt'])<=dt.datetime.fromisoformat(s['startsAt']): raise ValueError('Invalid time range')
    if previous:
        for key in ('papers','presentations','sessions'):
            if len(data[key])<len(previous[key])*.9: raise ValueError('Unexpected '+key+' count reduction')
        for key in ('withSession','posterNumbers','timedSessions'):
            if data['coverage'][key]<previous['coverage'][key]*.9: raise ValueError('Unexpected coverage reduction: '+key)
def publish(data,path):
    previous=json.loads(path.read_text()) if path.exists() else None
    validate(data,previous); path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix('.tmp'); temp.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))); os.replace(temp,path)
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source-dir',type=Path);args=ap.parse_args(); raw={}
    for name,url in SOURCES.items():
        if args.source_dir: raw[name]=(args.source_dir/('eccv-'+name+('.json' if name in ('events','abstracts') else '.html'))).read_text()
        else:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'ECCV-Scout/0.1 community conference planner'}),timeout=60) as r: raw[name]=r.read().decode()
    data=normalize(raw);publish(data,Path(__file__).resolve().parents[1]/'public/data/conference.json'); print(json.dumps(data['coverage'],indent=2))
if __name__=='__main__': main()
