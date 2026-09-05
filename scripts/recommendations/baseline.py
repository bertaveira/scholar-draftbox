"""Small, dependency-free title/topic TF-IDF baseline for qualitative comparison."""

from __future__ import annotations

import collections
import math
import re
import unicodedata
from typing import Any


STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it",
    "of", "on", "or", "that", "the", "this", "to", "towards", "via", "we", "with", "without",
}


def tokens(value: str) -> list[str]:
    ascii_text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    return [token for token in re.findall(r"[a-z0-9]+", ascii_text) if token not in STOPWORDS and len(token) > 1]


def raw_features(paper: dict[str, Any]) -> dict[str, float]:
    title_tokens = tokens(paper["title"])
    topic_tokens = tokens(" ".join(paper.get("topics", [])))
    values: collections.defaultdict[str, float] = collections.defaultdict(float)
    for token in title_tokens:
        values[f"title:{token}"] += 2.0
    for left, right in zip(title_tokens, title_tokens[1:]):
        values[f"title-bigram:{left}_{right}"] += 3.0
    for token in topic_tokens:
        values[f"topic:{token}"] += 1.0
    for topic in paper.get("topics", []):
        values[f"topic-label:{' '.join(tokens(topic))}"] += 2.0
    return dict(values)


class TitleTopicBaseline:
    def __init__(self, papers: list[dict[str, Any]]):
        self.paper_ids = [paper["id"] for paper in papers]
        if len(self.paper_ids) != len(set(self.paper_ids)):
            raise ValueError("Baseline requires unique paper IDs")
        document_features = [raw_features(paper) for paper in papers]
        document_frequency: collections.Counter[str] = collections.Counter()
        for features in document_features:
            document_frequency.update(features.keys())
        count = len(papers)
        self.vectors: list[dict[str, float]] = []
        self.postings: dict[str, list[tuple[int, float]]] = collections.defaultdict(list)
        for index, features in enumerate(document_features):
            weighted = {
                feature: (1.0 + math.log(value)) * (math.log((count + 1) / (document_frequency[feature] + 1)) + 1.0)
                for feature, value in features.items()
            }
            norm = math.sqrt(sum(value * value for value in weighted.values()))
            vector = {feature: value / norm for feature, value in weighted.items()} if norm else {}
            self.vectors.append(vector)
            for feature, value in vector.items():
                self.postings[feature].append((index, value))
        self.index = {paper_id: index for index, paper_id in enumerate(self.paper_ids)}

    def neighbours(self, paper_id: str, k: int = 5) -> list[list[str | float]]:
        query_index = self.index[paper_id]
        scores: collections.defaultdict[int, float] = collections.defaultdict(float)
        for feature, query_value in self.vectors[query_index].items():
            for candidate_index, candidate_value in self.postings[feature]:
                if candidate_index != query_index:
                    scores[candidate_index] += query_value * candidate_value
        ordered = sorted(scores, key=lambda i: (-scores[i], self.paper_ids[i]))[:k]
        return [[self.paper_ids[i], round(scores[i], 6)] for i in ordered]
