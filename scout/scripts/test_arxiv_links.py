import unittest
from apply_arxiv_links import apply_links
class LinkTests(unittest.TestCase):
    def setUp(self):
        self.data={'papers':[{'id':'p1','title':'Paper','paperUrl':None},{'id':'p2','title':'Other','paperUrl':None}],'sessions':[],'presentations':[],'coverage':{},'sources':[]}
        self.record={'paperId':'p1','officialTitle':'Paper','arxivUrl':'https://arxiv.org/abs/2603.22275v1','retrievedAt':'2026-09-05T00:00:00Z'}
    def test_known_links_only_and_repeatable(self):
        a=apply_links(self.data,[self.record]);self.assertEqual(a['coverage']['arxivLinks'],1)
        self.assertIsNone(a['papers'][1]['paperUrl']);self.assertIsNone(self.data['papers'][0]['paperUrl'])
        self.assertEqual(a,apply_links(a,[self.record]))
    def test_invalid_records_leave_source_unchanged(self):
        for change in [{'arxivUrl':'https://arxiv.org.evil.com/abs/123'},{'arxivUrl':'javascript:alert(1)'},{'officialTitle':'Changed'},{'paperId':'missing'}]:
            with self.assertRaises(ValueError):apply_links(self.data,[dict(self.record,**change)])
        with self.assertRaises(ValueError):apply_links(self.data,[self.record,self.record])
        self.assertIsNone(self.data['papers'][0]['paperUrl'])
    def test_abstract_provenance_and_official_text_precedence(self):
        record=dict(self.record,abstract='A sourced abstract.',sourceVersion='1')
        result=apply_links(self.data,[record]);paper=result['papers'][0]
        self.assertEqual(paper['abstract'],'A sourced abstract.')
        self.assertEqual(paper['abstractSource']['url'],record['arxivUrl'])
        self.assertEqual(result['coverage']['arxivAbstracts'],1)
        self.assertEqual(result,apply_links(result,[record]))
        self.data['papers'][0]['abstract']='Official abstract.'
        result=apply_links(self.data,[record])
        self.assertEqual(result['papers'][0]['abstract'],'Official abstract.')
        self.assertNotIn('abstractSource',result['papers'][0])
    def test_bad_abstract_rejects_whole_import(self):
        for abstract in [123,{},'  ']:
            with self.assertRaises(ValueError): apply_links(self.data,[dict(self.record,abstract=abstract)])
        self.assertNotIn('abstract',self.data['papers'][0])
