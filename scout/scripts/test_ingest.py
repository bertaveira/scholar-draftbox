import unittest,json,tempfile,copy
from pathlib import Path
from ingest import validate,publish,normalize
DATA=json.loads((Path(__file__).resolve().parents[1]/'public/data/conference.json').read_text())
class IngestionTests(unittest.TestCase):
 def test_real_data(self): validate(DATA)
 def test_invalid_refresh_retains_file(self):
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'data.json';publish(DATA,path);before=path.read_bytes()
   for kind in ('papers','sessions','presentations'):
    bad=copy.deepcopy(DATA);bad[kind]=[]
    with self.assertRaises(ValueError): publish(bad,path)
    self.assertEqual(before,path.read_bytes())
 def test_coverage_regression(self):
  bad=copy.deepcopy(DATA);bad['coverage']['posterNumbers']=0
  with self.assertRaises(ValueError):validate(bad,DATA)
 def test_duplicate_and_relationship(self):
  bad=copy.deepcopy(DATA);bad['papers'].append(bad['papers'][0])
  with self.assertRaises(ValueError):validate(bad)
  bad=copy.deepcopy(DATA);bad['presentations'][0]['sessionId']='missing'
  with self.assertRaises(ValueError):validate(bad)
 def test_html_duplicate_topics_and_multiple_presentations(self):
  row='<tr><td><a href="/virtual/2026/poster/123">A paper</a><div class="indented">Alice ⋅ Bob</div></td><td class="elc-keywords">Vision ⋅ Robotics</td><td class="elc-where">In Room: ExHall Poster Location: # 2</td></tr>'
  cal='<div class="container2"><div class="hdrbox">THU 10 SEP</div><div class="timebox"><div class="time">4 p.m.</div><div class="poster-session room-exhall"><div><div class="sessiontitle"><a href="/virtual/2026/session/1">Poster Session 1 <span class="sessiontime">[4:00-6:00]</span></a></div></div><a href="/virtual/2026/poster/123">A paper</a></div></div><div class="timebox"><div class="time">9 a.m.</div><div class="oral-session room-arena-room"><div><div class="sessiontitle"><a href="/virtual/2026/session/2">Oral Session <span class="sessiontime">[9:00-10:30]</span></a></div></div><div class="content oral">[9:00] A paper</div></div></div></div>'
  d=normalize({'accepted':'<table>'+row+row+'</table>','calendar':cal});validate(d)
  self.assertEqual(len(d['papers']),1);self.assertEqual(d['papers'][0]['authors'],['Alice','Bob']);self.assertEqual(len(d['presentations']),2);self.assertEqual(d['sessions'][1]['startsAt'],'2026-09-10T16:00:00+02:00')
 def test_keynote_and_noon_break_from_official_style_markup(self):
  row='<table><tr><td><a href="/virtual/2026/poster/123">A paper</a></td></tr></table>'
  cal='<option value="Arena Room">Arena Room</option><div class="container2"><div class="hdrbox">THU 10 SEP</div><div class="timebox"><div class="time">noon</div><div class="eventsession break room-arena-room"><div class="title-style"><a href="/virtual/2026/break/10">Lunch</a></div><span class="end-time">(ends 1:30 PM)</span></div></div><div class="timebox"><div class="time">3 p.m.</div><div class="eventsession invited-talk room-arena-room"><div class="title-style"><a href="/virtual/2026/invited-talk/11">Keynote title</a></div><div class="speaker-style">A Speaker</div><span class="end-time">(ends 4:00 PM)</span></div></div></div>'
  d=normalize({'accepted':row,'calendar':cal});validate(d)
  self.assertEqual(len(d['sessions']),2)
  self.assertEqual(d['sessions'][0]['startsAt'],'2026-09-10T12:00:00+02:00')
  self.assertEqual(d['sessions'][1]['kind'],'keynote')
  self.assertEqual(d['sessions'][1]['speaker'],'A Speaker')
  self.assertEqual(d['sessions'][1]['room'],'Arena Room')
  self.assertEqual(d['sessions'][1]['endsAt'],'2026-09-10T16:00:00+02:00')
if __name__=='__main__':unittest.main()
