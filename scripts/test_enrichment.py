import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import pilot_metadata as p

class EnrichmentTests(unittest.TestCase):
    def test_query_and_acceptance_remain_strict(self):
        paper={'title':'Exact Work','authors':['Ana Garcia','Bo Li','Chris Ray']}
        self.assertEqual(p.assess(paper,{'title':'Exact Work','authors':['Garcia Ana','Li Bo']})['clear'],True)
        self.assertFalse(p.assess(paper,{'title':'Exact Work Revisited','authors':paper['authors']})['clear'])

    def test_fetch_reuses_cache_without_sleep_or_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache=Path(tmp); url='https://example.invalid/query'
            p.cache_path(url,cache).write_text(json.dumps({'url':url,'body':'cached','retrievedAt':'now'}))
            with patch('pilot_metadata.urllib.request.urlopen') as open_url, patch('pilot_metadata.time.sleep') as sleep:
                result=p.fetch(url,cache_dir=cache)
            self.assertEqual(result['body'],'cached'); open_url.assert_not_called(); sleep.assert_not_called()

    def test_invalid_feed_is_failure_not_empty(self):
        with self.assertRaises(ValueError): p.candidates('<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>bad</id></entry></feed>')
        self.assertEqual(p.candidates('<feed xmlns="http://www.w3.org/2005/Atom"/>'),[])

    def test_full_run_resumes_and_retries_failed_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'public/data').mkdir(parents=True)
            data={'version':'test','papers':[
                {'id':'a','title':'One','authors':['A One']},
                {'id':'b','title':'Two','authors':['B Two']}]}
            (root/'public/data/conference.json').write_text(json.dumps(data))
            feed=lambda title, name: '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/1.0000v1</id><title>'+title+'</title><summary>Abstract</summary><published>2026-01-01</published><updated>2026-01-01</updated><author><name>'+name+'</name></author></entry></feed>'
            calls=[]
            def fake_fetch(url):
                calls.append(url)
                if len(calls)==1: raise RuntimeError('temporary')
                title='One' if 'one' in url.lower() else 'Two'
                return {'body':feed(title, 'A One' if title=='One' else 'B Two'),'retrievedAt':'now'}
            old=p.ROOT
            try:
                p.ROOT=root
                with patch.object(p,'fetch',side_effect=fake_fetch): p.run_full(output_dir=root/'out',breaker=3)
                self.assertEqual(json.loads((root/'out/coverage.json').read_text())['counts'],{'request_failed':1,'clear':1})
                with patch.object(p,'fetch',side_effect=fake_fetch): p.run_full(output_dir=root/'out',breaker=3)
                self.assertEqual(len((root/'out/strict-results.jsonl').read_text().splitlines()),2)
                self.assertEqual(json.loads((root/'out/coverage.json').read_text())['counts'],{'clear':2})
            finally: p.ROOT=old

if __name__=='__main__': unittest.main()
