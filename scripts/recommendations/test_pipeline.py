import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from .config import ModelSpec
from .core import (
    compute_top_neighbours,
    load_dataset,
    normalize_embeddings,
    prepare_papers,
    publish_artifacts,
    read_cached_vector,
    validate_current,
    vector_cache_path,
    write_cached_vector,
)
from .pipeline import select_evaluation_sample


TEST_MODEL = ModelSpec(
    key="test",
    repository="local/test",
    revision="0123456789abcdef",
    dimensions=3,
    max_tokens=32,
    pooling="test pooling",
    license="Apache-2.0",
    purpose="tests",
)


def dataset(count=4):
    papers = []
    for index in range(count):
        papers.append(
            {
                "id": f"eccv-2026-{index + 1}",
                "officialId": str(index + 1),
                "title": f"Paper {index + 1}",
                "authors": [],
                "topics": ["Topic A" if index % 2 == 0 else "Topic B"],
                "abstract": "A sourced abstract" if index % 2 == 0 else None,
                "officialUrl": f"https://example.test/{index + 1}",
                "paperUrl": None,
            }
        )
    return {"schemaVersion": 1, "version": "test-dataset", "papers": papers}


class RecommendationPipelineTests(unittest.TestCase):
    def test_missing_abstract_uses_only_title_and_topics(self):
        prepared = prepare_papers(dataset(), "[SEP]")
        missing = prepared[1]
        self.assertFalse(missing.has_abstract)
        self.assertEqual(missing.text, "Paper 2 [SEP] Topics: Topic B")
        self.assertNotIn("abstract", missing.text.lower())

    def test_normalization_and_neighbours_are_finite_unique_and_self_free(self):
        vectors = normalize_embeddings(
            np.array([[1, 0, 0], [0.9, 0.1, 0], [0, 1, 0], [0, 0, 1]], dtype=np.float32)
        )
        ids = [paper["id"] for paper in dataset()["papers"]]
        neighbours = compute_top_neighbours(ids, vectors, 2)
        for paper_id, entries in neighbours.items():
            targets = [entry[0] for entry in entries]
            self.assertEqual(len(targets), len(set(targets)))
            self.assertNotIn(paper_id, targets)
            self.assertTrue(all(np.isfinite(entry[1]) for entry in entries))
        self.assertEqual(neighbours[ids[0]][0][0], ids[1])

    def test_duplicate_ids_are_rejected(self):
        vectors = normalize_embeddings(np.eye(3, dtype=np.float32))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            compute_top_neighbours(["same", "same", "other"], vectors, 1)

    def test_content_addressed_cache_validates_vectors(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = vector_cache_path(root, TEST_MODEL, "content-hash")
            vector = np.array([1, 0, 0], dtype=np.float32)
            write_cached_vector(path, vector)
            np.testing.assert_array_equal(read_cached_vector(path, 3), vector)
            self.assertIsNone(read_cached_vector(path, 2))

    def test_content_hash_changes_only_for_changed_paper_input(self):
        original = dataset()
        changed = dataset()
        changed["papers"][0]["abstract"] = "A revised sourced abstract"
        before = prepare_papers(original, "[SEP]")
        after = prepare_papers(changed, "[SEP]")
        self.assertNotEqual(before[0].content_hash, after[0].content_hash)
        self.assertEqual(
            [paper.content_hash for paper in before[1:]],
            [paper.content_hash for paper in after[1:]],
        )

    def test_atomic_publication_keeps_last_valid_pointer_on_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            input_path = root / "public" / "data" / "conference.json"
            input_path.parent.mkdir(parents=True)
            input_path.write_text(json.dumps(dataset()), encoding="utf-8")
            output = input_path.parent / "recommendations"
            loaded = load_dataset(input_path)
            ids = [paper["id"] for paper in loaded["papers"]]
            vectors = normalize_embeddings(
                np.array([[1, 0, 0], [0.9, 0.1, 0], [0, 1, 0], [0, 0, 1]], dtype=np.float32)
            )
            neighbours = compute_top_neighbours(ids, vectors, 2)
            publish_artifacts(
                data=loaded,
                input_path=input_path,
                output_root=output,
                spec=TEST_MODEL,
                embeddings=vectors,
                neighbours=neighbours,
                k=2,
                generation={"device": "test"},
                token_stats={"papers": 4, "missingAbstract": 2},
            )
            validate_current(output, input_path)
            pointer_before = (output / "current.json").read_bytes()
            invalid = dict(neighbours)
            invalid[ids[0]] = [[ids[0], 1.0], [ids[1], 0.5]]
            with self.assertRaisesRegex(ValueError, "relationship"):
                publish_artifacts(
                    data=loaded,
                    input_path=input_path,
                    output_root=output,
                    spec=TEST_MODEL,
                    embeddings=vectors,
                    neighbours=invalid,
                    k=2,
                    generation={"device": "test"},
                    token_stats={"papers": 4, "missingAbstract": 2},
                )
            self.assertEqual((output / "current.json").read_bytes(), pointer_before)
            validate_current(output, input_path)

    def test_evaluation_sample_is_balanced_and_covers_all_topics(self):
        real_path = Path(__file__).resolve().parents[2] / "public" / "data" / "conference.json"
        real = load_dataset(real_path)
        ids = select_evaluation_sample(real["papers"], 30)
        selected = [paper for paper in real["papers"] if paper["id"] in ids]
        self.assertEqual(len(ids), 30)
        self.assertEqual(len(set(ids)), 30)
        self.assertEqual(sum(bool(paper.get("abstract")) for paper in selected), 15)
        self.assertEqual(
            {topic for paper in selected for topic in paper.get("topics", [])},
            {topic for paper in real["papers"] for topic in paper.get("topics", [])},
        )


if __name__ == "__main__":
    unittest.main()
