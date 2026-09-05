"""Lazy-loading embedding backends and content-addressed embedding cache."""

from __future__ import annotations

import contextlib
import time
from pathlib import Path
from typing import Any

import numpy as np

from .config import ModelSpec
from .core import (
    PreparedPaper,
    canonical_json,
    normalize_embeddings,
    read_cached_vector,
    sha256_bytes,
    vector_cache_path,
    write_cached_vector,
)


MINILM_FILES = [
    "1_Pooling/*",
    "config.json",
    "config_sentence_transformers.json",
    "modules.json",
    "model.safetensors",
    "sentence_bert_config.json",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.txt",
]
SPECTER_BASE_FILES = [
    "config.json",
    "pytorch_model.bin",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.txt",
]
SPECTER_ADAPTER_FILES = ["adapter_config.json", "pytorch_adapter.bin"]


def resolve_device(requested: str) -> str:
    import torch

    if requested == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but PyTorch cannot access a CUDA device; use --device cpu")
    return requested


class ModelRunner:
    def __init__(self, spec: ModelSpec, cache_dir: Path, device: str, offline: bool = False):
        self.spec = spec
        self.cache_dir = cache_dir
        self.device = resolve_device(device)
        self.offline = offline
        self.model: Any = None
        self.tokenizer: Any = None
        self.load_seconds = 0.0
        self._load()

    def _snapshot(self, repository: str, revision: str, patterns: list[str]) -> str:
        from huggingface_hub import snapshot_download

        return snapshot_download(
            repo_id=repository,
            revision=revision,
            cache_dir=self.cache_dir / "huggingface",
            allow_patterns=patterns,
            local_files_only=self.offline,
        )

    def _load(self) -> None:
        started = time.perf_counter()
        if self.spec.key == "minilm":
            from sentence_transformers import SentenceTransformer

            snapshot = self._snapshot(self.spec.repository, self.spec.revision, MINILM_FILES)
            self.model = SentenceTransformer(snapshot, device=self.device)
            self.model.max_seq_length = self.spec.max_tokens
            self.tokenizer = self.model.tokenizer
        elif self.spec.key == "specter2":
            from adapters import AutoAdapterModel
            from transformers import AutoTokenizer

            base_snapshot = self._snapshot(self.spec.repository, self.spec.revision, SPECTER_BASE_FILES)
            if not self.spec.adapter_repository or not self.spec.adapter_revision:
                raise ValueError("SPECTER2 requires a pinned proximity adapter")
            adapter_snapshot = self._snapshot(
                self.spec.adapter_repository, self.spec.adapter_revision, SPECTER_ADAPTER_FILES
            )
            self.tokenizer = AutoTokenizer.from_pretrained(base_snapshot, local_files_only=True)
            self.model = AutoAdapterModel.from_pretrained(base_snapshot, local_files_only=True)
            adapter_name = self.model.load_adapter(adapter_snapshot, load_as="specter2")
            # adapters 1.3.0 accepts set_active=True but does not activate the adapter.
            # Make the model-card requirement explicit and fail rather than embed with the base model.
            self.model.set_active_adapters(adapter_name)
            if self.model.active_adapters is None or adapter_name not in str(self.model.active_adapters):
                raise RuntimeError("SPECTER2 proximity adapter did not activate")
            self.model.to(self.device)
            self.model.eval()
        else:
            raise ValueError(f"Unsupported model: {self.spec.key}")
        self.load_seconds = time.perf_counter() - started

    @property
    def separator_token(self) -> str:
        token = self.tokenizer.sep_token
        if not token:
            raise ValueError(f"Tokenizer for {self.spec.key} has no separator token")
        return token

    def token_stats(self, papers: list[PreparedPaper]) -> dict[str, Any]:
        lengths: list[int] = []
        truncated: list[str] = []
        for paper in papers:
            encoded = self.tokenizer(
                paper.text,
                add_special_tokens=True,
                truncation=False,
                return_attention_mask=False,
                return_token_type_ids=False,
                verbose=False,
            )
            length = len(encoded["input_ids"])
            lengths.append(length)
            if length > self.spec.max_tokens:
                truncated.append(paper.id)
        ordered_truncated = sorted(truncated)
        return {
            "papers": len(papers),
            "withAbstract": sum(paper.has_abstract for paper in papers),
            "missingAbstract": sum(not paper.has_abstract for paper in papers),
            "overContextLimit": len(truncated),
            "overContextLimitIdsSha256": sha256_bytes(canonical_json(ordered_truncated)),
            "maximumObservedTokens": max(lengths, default=0),
            "contextTokens": self.spec.max_tokens,
        }

    def encode(self, texts: list[str], batch_size: int, show_progress: bool = True) -> np.ndarray:
        if not texts:
            return np.empty((0, self.spec.dimensions), dtype=np.float32)
        if self.spec.key == "minilm":
            vectors = self.model.encode(
                texts,
                batch_size=batch_size,
                show_progress_bar=show_progress,
                convert_to_numpy=True,
                normalize_embeddings=False,
            )
            return np.asarray(vectors, dtype=np.float32)

        import torch

        batches: list[np.ndarray] = []
        use_cuda_amp = self.device.startswith("cuda")
        total = (len(texts) + batch_size - 1) // batch_size
        with torch.inference_mode():
            for batch_number, start in enumerate(range(0, len(texts), batch_size), start=1):
                batch = texts[start : start + batch_size]
                inputs = self.tokenizer(
                    batch,
                    padding=True,
                    truncation=True,
                    max_length=self.spec.max_tokens,
                    return_tensors="pt",
                    return_token_type_ids=False,
                )
                inputs = {key: value.to(self.device) for key, value in inputs.items()}
                amp = torch.autocast(device_type="cuda", dtype=torch.float16) if use_cuda_amp else contextlib.nullcontext()
                with amp:
                    output = self.model(**inputs).last_hidden_state[:, 0, :]
                batches.append(output.float().cpu().numpy())
                if show_progress and (batch_number == total or batch_number % 10 == 0):
                    print(f"{self.spec.key}: encoded batch {batch_number}/{total}", flush=True)
        return np.concatenate(batches, axis=0).astype(np.float32, copy=False)


def encode_with_cache(
    runner: ModelRunner,
    papers: list[PreparedPaper],
    cache_root: Path,
    batch_size: int,
    show_progress: bool = True,
) -> tuple[np.ndarray, dict[str, Any]]:
    started = time.perf_counter()
    rows: list[np.ndarray | None] = [None] * len(papers)
    misses: list[tuple[int, PreparedPaper, Path]] = []
    for index, paper in enumerate(papers):
        path = vector_cache_path(cache_root, runner.spec, paper.content_hash)
        vector = read_cached_vector(path, runner.spec.dimensions)
        if vector is None:
            misses.append((index, paper, path))
        else:
            rows[index] = vector

    inference_started = time.perf_counter()
    if misses:
        encoded = normalize_embeddings(
            runner.encode([paper.text for _, paper, _ in misses], batch_size=batch_size, show_progress=show_progress)
        )
        if encoded.shape != (len(misses), runner.spec.dimensions):
            raise ValueError(f"{runner.spec.key} returned the wrong embedding dimensions: {encoded.shape}")
        for vector, (index, _paper, path) in zip(encoded, misses, strict=True):
            rows[index] = vector
            write_cached_vector(path, vector)
    inference_seconds = time.perf_counter() - inference_started

    if any(row is None for row in rows):
        raise RuntimeError("Embedding cache assembly left an empty row")
    matrix = normalize_embeddings(np.stack(rows))
    stats = {
        "cacheHits": len(papers) - len(misses),
        "cacheMisses": len(misses),
        "modelLoadSeconds": round(runner.load_seconds, 3),
        "inferenceAndCacheWriteSeconds": round(inference_seconds, 3),
        "embeddingStageSeconds": round(time.perf_counter() - started, 3),
        "device": runner.device,
        "batchSize": batch_size,
    }
    return matrix, stats
