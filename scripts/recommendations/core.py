"""Core data, cache, neighbour, validation, and atomic publication utilities."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import os
import re
import shutil
import tempfile
import unicodedata
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from .config import (
    LONG_INPUT_POLICY,
    MISSING_ABSTRACT_POLICY,
    PREPROCESSING_VERSION,
    ModelSpec,
)


NEIGHBOUR_SCHEMA_VERSION = 1
ARTIFACT_SCHEMA_VERSION = 1
CURRENT_SCHEMA_VERSION = 1
EMBEDDING_DTYPE = "<f2"


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value)).strip()


def load_dataset(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    validate_dataset(data)
    return data


def validate_dataset(data: dict[str, Any]) -> None:
    if data.get("schemaVersion") != 1 or not isinstance(data.get("version"), str):
        raise ValueError("Unsupported conference dataset header")
    papers = data.get("papers")
    if not isinstance(papers, list) or not papers:
        raise ValueError("Conference dataset has no papers")
    ids: list[str] = []
    for paper in papers:
        paper_id = paper.get("id")
        if not isinstance(paper_id, str) or not paper_id or not re.fullmatch(r"eccv-2026-\d+", paper_id):
            raise ValueError(f"Invalid stable paper ID: {paper_id!r}")
        ids.append(paper_id)
        if not isinstance(paper.get("title"), str) or not paper["title"].strip():
            raise ValueError(f"Missing title for {paper_id}")
        if paper.get("abstract") is not None and not isinstance(paper["abstract"], str):
            raise ValueError(f"Invalid abstract for {paper_id}")
        if not isinstance(paper.get("topics"), list) or any(not isinstance(x, str) for x in paper["topics"]):
            raise ValueError(f"Invalid topics for {paper_id}")
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate stable paper IDs in conference dataset")


@dataclass(frozen=True)
class PreparedPaper:
    id: str
    title: str
    topics: tuple[str, ...]
    has_abstract: bool
    text: str
    content_hash: str


def prepare_papers(data: dict[str, Any], separator_token: str) -> list[PreparedPaper]:
    prepared: list[PreparedPaper] = []
    for raw in data["papers"]:
        title = normalize_text(raw["title"])
        abstract = normalize_text(raw.get("abstract") or "")
        topics = tuple(normalize_text(topic) for topic in raw.get("topics", []) if normalize_text(topic))
        has_abstract = bool(abstract)
        secondary = abstract if has_abstract else "Topics: " + "; ".join(topics)
        text = f"{title} {separator_token} {secondary}".strip()
        content = {
            "id": raw["id"],
            "title": title,
            "abstract": abstract if has_abstract else None,
            "topics": topics,
            "hasAbstract": has_abstract,
        }
        prepared.append(
            PreparedPaper(
                id=raw["id"],
                title=title,
                topics=topics,
                has_abstract=has_abstract,
                text=text,
                content_hash=sha256_bytes(canonical_json(content)),
            )
        )
    return prepared


def model_cache_namespace(spec: ModelSpec) -> str:
    config = {
        "model": asdict(spec),
        "preprocessingVersion": PREPROCESSING_VERSION,
        "missingAbstractPolicy": MISSING_ABSTRACT_POLICY,
        "longInputPolicy": LONG_INPUT_POLICY,
    }
    return sha256_bytes(canonical_json(config))[:20]


def vector_cache_path(cache_root: Path, spec: ModelSpec, content_hash: str) -> Path:
    return cache_root / "embeddings" / spec.key / model_cache_namespace(spec) / f"{content_hash}.npy"


def read_cached_vector(path: Path, dimensions: int) -> np.ndarray | None:
    if not path.exists():
        return None
    try:
        vector = np.load(path, allow_pickle=False)
    except (OSError, ValueError):
        return None
    if vector.shape != (dimensions,) or not np.issubdtype(vector.dtype, np.floating):
        return None
    vector = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(vector))
    if not np.isfinite(vector).all() or not math.isfinite(norm) or abs(norm - 1.0) > 1e-4:
        return None
    return vector


def write_cached_vector(path: Path, vector: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            np.save(handle, np.asarray(vector, dtype=np.float32), allow_pickle=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def normalize_embeddings(vectors: np.ndarray) -> np.ndarray:
    vectors = np.asarray(vectors, dtype=np.float32)
    if vectors.ndim != 2 or not np.isfinite(vectors).all():
        raise ValueError("Embedding matrix must be finite and two-dimensional")
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    if not np.isfinite(norms).all() or np.any(norms <= 1e-12):
        raise ValueError("Embedding matrix contains a zero or invalid vector")
    normalized = vectors / norms
    if not np.isfinite(normalized).all():
        raise ValueError("Embedding normalization produced invalid values")
    return normalized.astype(np.float32, copy=False)


def compute_top_neighbours(
    paper_ids: list[str], embeddings: np.ndarray, k: int
) -> dict[str, list[list[str | float]]]:
    if len(paper_ids) != len(set(paper_ids)):
        raise ValueError("Cannot compute neighbours with duplicate paper IDs")
    if embeddings.shape[0] != len(paper_ids) or k < 1 or k >= len(paper_ids):
        raise ValueError("Invalid neighbour matrix shape or k")
    scores = np.asarray(embeddings, dtype=np.float32) @ np.asarray(embeddings, dtype=np.float32).T
    np.fill_diagonal(scores, -np.inf)
    result: dict[str, list[list[str | float]]] = {}
    for row, paper_id in enumerate(paper_ids):
        candidate_indices = np.argpartition(scores[row], -k)[-k:]
        ordered = sorted(candidate_indices.tolist(), key=lambda i: (-float(scores[row, i]), paper_ids[i]))
        result[paper_id] = [[paper_ids[i], round(float(np.clip(scores[row, i], -1.0, 1.0)), 6)] for i in ordered]
    return result


def atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def recommendation_content(data: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "id": paper["id"],
            "title": paper["title"],
            "topics": paper.get("topics", []),
            "abstract": paper.get("abstract"),
        }
        for paper in data["papers"]
    ]


def artifact_version(data: dict[str, Any], spec: ModelSpec, k: int, input_sha256: str) -> str:
    config = {
        "datasetVersion": data["version"],
        "inputSha256": input_sha256,
        "recommendationContentSha256": sha256_bytes(canonical_json(recommendation_content(data))),
        "model": asdict(spec),
        "preprocessingVersion": PREPROCESSING_VERSION,
        "numericFormat": EMBEDDING_DTYPE,
        "neighbours": k,
    }
    suffix = sha256_bytes(canonical_json(config))[:10]
    return f"{data['version']}-{spec.key}-{suffix}"


def _file_record(path: Path) -> dict[str, Any]:
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": sha256_file(path)}


def publish_artifacts(
    *,
    data: dict[str, Any],
    input_path: Path,
    output_root: Path,
    spec: ModelSpec,
    embeddings: np.ndarray,
    neighbours: dict[str, list[list[str | float]]],
    k: int,
    generation: dict[str, Any],
    token_stats: dict[str, Any],
) -> tuple[Path, bool]:
    """Validate a staged complete version, promote it, then atomically move the pointer."""
    validate_dataset(data)
    paper_ids = [paper["id"] for paper in data["papers"]]
    if embeddings.shape != (len(paper_ids), spec.dimensions):
        raise ValueError("Embedding matrix does not match dataset/model dimensions")
    embeddings = normalize_embeddings(embeddings)
    input_bytes = input_path.read_bytes()
    input_sha256 = sha256_bytes(input_bytes)
    version = artifact_version(data, spec, k, input_sha256)
    versions_root = output_root / "versions"
    versions_root.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{version}.", dir=versions_root))
    target = versions_root / version
    promoted = False
    try:
        ids_payload = {
            "schemaVersion": ARTIFACT_SCHEMA_VERSION,
            "datasetVersion": data["version"],
            "paperIds": paper_ids,
        }
        (stage / "paper-ids.json").write_bytes(canonical_json(ids_payload))
        little_endian = np.asarray(embeddings, dtype=EMBEDDING_DTYPE)
        (stage / "embeddings.f16").write_bytes(little_endian.tobytes(order="C"))
        neighbour_payload = {
            "schemaVersion": NEIGHBOUR_SCHEMA_VERSION,
            "datasetVersion": data["version"],
            "model": spec.key,
            "k": k,
            "similarity": "cosine",
            "neighbors": neighbours,
        }
        (stage / "neighbors.json").write_bytes(canonical_json(neighbour_payload))
        files = {
            "paperIds": _file_record(stage / "paper-ids.json"),
            "embeddings": _file_record(stage / "embeddings.f16"),
            "neighbors": _file_record(stage / "neighbors.json"),
        }
        content = recommendation_content(data)
        manifest = {
            "schemaVersion": ARTIFACT_SCHEMA_VERSION,
            "artifactVersion": version,
            "dataset": {
                "schemaVersion": data["schemaVersion"],
                "version": data["version"],
                "paperCount": len(paper_ids),
                "input": str(input_path.relative_to(input_path.parents[2])),
                "inputSha256": input_sha256,
                "recommendationContentSha256": sha256_bytes(canonical_json(content)),
            },
            "model": {
                "key": spec.key,
                "repository": spec.repository,
                "revision": spec.revision,
                "adapterRepository": spec.adapter_repository,
                "adapterRevision": spec.adapter_revision,
                "license": spec.license,
                "purpose": spec.purpose,
                "dimensions": spec.dimensions,
                "contextTokens": spec.max_tokens,
                "pooling": spec.pooling,
            },
            "preprocessing": {
                "version": PREPROCESSING_VERSION,
                "unicodeNormalization": "NFC",
                "whitespace": "collapse runs and trim",
                "titleAbstractSeparator": "the model tokenizer's SEP token",
                "availableAbstractInput": "title + SEP + sourced abstract",
                "missingAbstractInput": MISSING_ABSTRACT_POLICY,
                "longInputPolicy": LONG_INPUT_POLICY,
            },
            "coverage": token_stats,
            "embeddingFormat": {
                "file": files["embeddings"]["file"],
                "paperIdsFile": files["paperIds"]["file"],
                "rows": len(paper_ids),
                "dimensions": spec.dimensions,
                "numericFormat": "IEEE 754 binary16",
                "dtype": EMBEDDING_DTYPE,
                "byteOrder": "little-endian",
                "layout": "row-major; row i belongs to paperIds[i]",
                "l2Normalized": True,
                "normalizationToleranceAfterFloat16Encoding": 0.002,
            },
            "neighborFormat": {
                "file": files["neighbors"]["file"],
                "k": k,
                "key": "stable paper ID",
                "entry": "[neighbor stable paper ID, raw cosine similarity]",
                "scoreSemantics": "cosine similarity, not a probability or percentage relevance",
                "computedFrom": "normalized float32 vectors before float16 serialization",
            },
            "files": files,
            "generation": generation,
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        (stage / "manifest.json").write_bytes(canonical_json(manifest))
        validate_artifact_directory(stage, input_path)

        if target.exists():
            validate_artifact_directory(target, input_path)
            shutil.rmtree(stage)
        else:
            os.replace(stage, target)
            promoted = True

        pointer = {
            "schemaVersion": CURRENT_SCHEMA_VERSION,
            "artifactVersion": version,
            "datasetVersion": data["version"],
            "manifest": f"versions/{version}/manifest.json",
        }
        atomic_write_bytes(output_root / "current.json", canonical_json(pointer))
        return target, promoted
    except Exception:
        if stage.exists():
            shutil.rmtree(stage)
        raise


def validate_artifact_directory(directory: Path, input_path: Path) -> dict[str, Any]:
    manifest_path = directory / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != ARTIFACT_SCHEMA_VERSION:
        raise ValueError("Unsupported recommendation manifest schema")
    data = load_dataset(input_path)
    dataset_info = manifest.get("dataset", {})
    if dataset_info.get("version") != data["version"]:
        raise ValueError("Recommendation artifact dataset version mismatch")
    if dataset_info.get("inputSha256") != sha256_file(input_path):
        raise ValueError("Recommendation artifact conference input hash mismatch")

    for record in manifest.get("files", {}).values():
        path = directory / record["file"]
        if not path.is_file() or path.stat().st_size != record["bytes"] or sha256_file(path) != record["sha256"]:
            raise ValueError(f"Recommendation artifact file hash mismatch: {path.name}")

    ids_path = directory / manifest["files"]["paperIds"]["file"]
    ids_payload = json.loads(ids_path.read_text(encoding="utf-8"))
    paper_ids = ids_payload.get("paperIds")
    expected_ids = [paper["id"] for paper in data["papers"]]
    if paper_ids != expected_ids or len(paper_ids) != len(set(paper_ids)):
        raise ValueError("Recommendation artifact paper ordering is incompatible with dataset")

    embedding_format = manifest["embeddingFormat"]
    rows = embedding_format["rows"]
    dimensions = embedding_format["dimensions"]
    if rows != len(paper_ids) or dimensions != manifest["model"]["dimensions"]:
        raise ValueError("Recommendation embedding dimensions are inconsistent")
    vector_path = directory / embedding_format["file"]
    if vector_path.stat().st_size != rows * dimensions * np.dtype(EMBEDDING_DTYPE).itemsize:
        raise ValueError("Recommendation embedding binary has the wrong byte length")
    vectors = np.fromfile(vector_path, dtype=EMBEDDING_DTYPE).reshape(rows, dimensions).astype(np.float32)
    norms = np.linalg.norm(vectors, axis=1)
    if not np.isfinite(vectors).all() or np.any(np.abs(norms - 1.0) > 0.002):
        raise ValueError("Recommendation embeddings are non-finite or not normalized")

    neighbour_path = directory / manifest["files"]["neighbors"]["file"]
    payload = json.loads(neighbour_path.read_text(encoding="utf-8"))
    if payload.get("datasetVersion") != data["version"] or payload.get("model") != manifest["model"]["key"]:
        raise ValueError("Recommendation neighbour header is incompatible")
    neighbours = payload.get("neighbors")
    k = payload.get("k")
    if not isinstance(neighbours, dict) or set(neighbours) != set(paper_ids) or k != manifest["neighborFormat"]["k"]:
        raise ValueError("Recommendation neighbour keys or count are incompatible")
    index = {paper_id: i for i, paper_id in enumerate(paper_ids)}
    for paper_id, entries in neighbours.items():
        if len(entries) != k:
            raise ValueError(f"Wrong neighbour count for {paper_id}")
        seen: set[str] = set()
        previous = math.inf
        row = vectors[index[paper_id]]
        for entry in entries:
            if not isinstance(entry, list) or len(entry) != 2:
                raise ValueError(f"Invalid neighbour entry for {paper_id}")
            neighbour_id, score = entry
            if neighbour_id == paper_id or neighbour_id in seen or neighbour_id not in index:
                raise ValueError(f"Invalid neighbour relationship for {paper_id}")
            if not isinstance(score, (int, float)) or not math.isfinite(score) or not -1.000001 <= score <= 1.000001:
                raise ValueError(f"Invalid cosine similarity for {paper_id}")
            if score > previous + 1e-7:
                raise ValueError(f"Unsorted neighbours for {paper_id}")
            encoded_score = float(row @ vectors[index[neighbour_id]])
            if abs(encoded_score - score) > 0.003:
                raise ValueError(f"Neighbour score/vector mismatch for {paper_id}")
            seen.add(neighbour_id)
            previous = score
    return manifest


def validate_current(output_root: Path, input_path: Path) -> dict[str, Any]:
    pointer = json.loads((output_root / "current.json").read_text(encoding="utf-8"))
    if pointer.get("schemaVersion") != CURRENT_SCHEMA_VERSION:
        raise ValueError("Unsupported recommendation current pointer")
    manifest_relative = Path(pointer["manifest"])
    if manifest_relative.is_absolute() or ".." in manifest_relative.parts:
        raise ValueError("Unsafe recommendation manifest pointer")
    manifest = validate_artifact_directory(output_root / manifest_relative.parent, input_path)
    if manifest["artifactVersion"] != pointer["artifactVersion"] or manifest["dataset"]["version"] != pointer["datasetVersion"]:
        raise ValueError("Recommendation current pointer is inconsistent")
    return manifest
