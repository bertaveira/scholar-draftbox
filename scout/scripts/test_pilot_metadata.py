import unittest
from pilot_metadata import assess,candidates
class MatchingTests(unittest.TestCase):
    def test_clear_requires_title_and_multiple_authors(self):
        p={'title':'Café: 3D Vision!','authors':['Ana García','Bo Li','Chris Ray']}
        c={'title':'Cafe 3D Vision','authors':['Ana Garcia','Bo Li']}
        self.assertTrue(assess(p,c)['clear'])
        self.assertFalse(assess(p,dict(c,authors=['Other Person']))['clear'])
        self.assertFalse(assess(p,dict(c,title='Cafe 3D Vision Revisited'))['clear'])
    def test_author_order_does_not_matter_but_initials_need_review(self):
        p={'title':'Paper','authors':['Bo Li','Ana Garcia']}
        self.assertTrue(assess(p,dict(p,authors=['Garcia Ana','Li Bo']))['clear'])
        self.assertFalse(assess(p,dict(p,authors=['A Garcia','B Li']))['clear'])
    def test_errors_are_not_silent_empty_results(self):
        with self.assertRaises(Exception): candidates('<html>Oops</html>broken')
        with self.assertRaises(ValueError): candidates('<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/api/errors</id></entry></feed>')
        self.assertEqual(candidates('<feed xmlns="http://www.w3.org/2005/Atom"/>'),[])
if __name__=='__main__': unittest.main()
