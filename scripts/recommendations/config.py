"""Pinned models and preprocessing settings used by the recommendation pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = ROOT / "public" / "data" / "conference.json"
DEFAULT_OUTPUT = ROOT / "public" / "data" / "recommendations"
DEFAULT_CACHE = ROOT / ".recommendations-cache"
EVALUATION_DIR = Path(__file__).resolve().parent / "evaluation"

PREPROCESSING_VERSION = "scholar-draftbox-paper-text-v2"
TITLE_ABSTRACT_SEPARATOR = "tokenizer SEP token"
LONG_INPUT_POLICY = "preserve title and right-truncate abstract/topic fallback at the model token limit"
MISSING_ABSTRACT_POLICY = "title + tokenizer SEP token + 'Topics: ' + official topics"


@dataclass(frozen=True)
class ModelSpec:
    key: str
    repository: str
    revision: str
    dimensions: int
    max_tokens: int
    pooling: str
    license: str
    purpose: str
    adapter_repository: str | None = None
    adapter_revision: str | None = None
    default_batch_size: int = 64


MODELS = {
    "minilm": ModelSpec(
        key="minilm",
        repository="sentence-transformers/all-MiniLM-L6-v2",
        revision="1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
        dimensions=384,
        max_tokens=256,
        pooling="attention-mask-aware mean pooling",
        license="Apache-2.0",
        purpose="compact general-purpose sentence and short-paragraph similarity",
        default_batch_size=128,
    ),
    "specter2": ModelSpec(
        key="specter2",
        repository="allenai/specter2_base",
        revision="3447645e1def9117997203454fa4495937bfbd83",
        adapter_repository="allenai/specter2",
        adapter_revision="2081559630a80fc5851d8f798a05ba81e9468089",
        dimensions=768,
        max_tokens=512,
        pooling="CLS token with SPECTER2 proximity adapter active",
        license="Apache-2.0",
        purpose="scientific paper-to-paper proximity and nearest-neighbour retrieval",
        default_batch_size=64,
    ),
}

SELECTED_MODEL = "specter2"
