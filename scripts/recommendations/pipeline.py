"""CLI for evaluating, generating, and validating offline recommendation data."""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import json
import platform
import time
from collections import Counter
from pathlib import Path
from typing import Any

from .baseline import TitleTopicBaseline
from .config import (
    DEFAULT_CACHE,
    DEFAULT_INPUT,
    DEFAULT_OUTPUT,
    EVALUATION_DIR,
    MODELS,
    SELECTED_MODEL,
)
from .core import (
    atomic_write_bytes,
    canonical_json,
    compute_top_neighbours,
    load_dataset,
    prepare_papers,
    publish_artifacts,
    sha256_file,
    validate_current,
)
from .models import ModelRunner, encode_with_cache


def stable_order(paper_id: str) -> str:
    return hashlib.sha256(f"scholar-draftbox-evaluation-v1:{paper_id}".encode()).hexdigest()


def select_evaluation_sample(papers: list[dict[str, Any]], count: int = 30) -> list[str]:
    """Cover every official topic, then balance abstract-present/missing examples."""
    if count < 2:
        raise ValueError("Evaluation sample must contain at least two papers")
    topics = sorted({topic for paper in papers for topic in paper.get("topics", [])})
    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    for index, topic in enumerate(topics):
        want_abstract = index % 2 == 0
        candidates = [
            paper
            for paper in papers
            if topic in paper.get("topics", []) and bool(paper.get("abstract")) == want_abstract
        ]
        if not candidates:
            candidates = [paper for paper in papers if topic in paper.get("topics", [])]
        candidate = min(candidates, key=lambda paper: stable_order(paper["id"]))
        if candidate["id"] not in selected_ids:
            selected.append(candidate)
            selected_ids.add(candidate["id"])

    target_with_abstract = count // 2
    topic_counts = Counter(topic for paper in selected for topic in paper.get("topics", []))
    while len(selected) < count:
        with_abstract = sum(bool(paper.get("abstract")) for paper in selected)
        want_abstract = with_abstract < target_with_abstract
        candidates = [
            paper
            for paper in papers
            if paper["id"] not in selected_ids and bool(paper.get("abstract")) == want_abstract
        ]
        if not candidates:
            candidates = [paper for paper in papers if paper["id"] not in selected_ids]
        candidate = min(
            candidates,
            key=lambda paper: (
                sum(topic_counts[topic] for topic in paper.get("topics", [])),
                stable_order(paper["id"]),
            ),
        )
        selected.append(candidate)
        selected_ids.add(candidate["id"])
        topic_counts.update(candidate.get("topics", []))
    return [paper["id"] for paper in selected[:count]]


def dependency_versions() -> dict[str, str]:
    result = {"python": platform.python_version()}
    for package in ("torch", "transformers", "adapters", "sentence-transformers", "numpy"):
        try:
            result[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            pass
    return result


def device_details(device: str) -> dict[str, Any]:
    import torch

    details: dict[str, Any] = {
        "device": device,
        "torch": torch.__version__,
        "torchCudaBuild": torch.version.cuda,
        "cudaAvailable": torch.cuda.is_available(),
    }
    if device.startswith("cuda") and torch.cuda.is_available():
        index = torch.cuda.current_device()
        details.update(
            {
                "gpu": torch.cuda.get_device_name(index),
                "computeCapability": ".".join(str(x) for x in torch.cuda.get_device_capability(index)),
            }
        )
    return details


def release_gpu() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass


def model_embeddings(
    *,
    model_key: str,
    data: dict[str, Any],
    cache: Path,
    device: str,
    batch_size: int | None,
    offline: bool,
) -> tuple[list[Any], Any, dict[str, Any], dict[str, Any]]:
    spec = MODELS[model_key]
    runner = ModelRunner(spec, cache, device=device, offline=offline)
    prepared = prepare_papers(data, runner.separator_token)
    token_stats = runner.token_stats(prepared)
    vectors, cache_stats = encode_with_cache(
        runner,
        prepared,
        cache,
        batch_size=batch_size or spec.default_batch_size,
    )
    runtime = {**cache_stats, **device_details(runner.device)}
    del runner
    release_gpu()
    return prepared, vectors, token_stats, runtime


def evaluate(args: argparse.Namespace) -> None:
    started = time.perf_counter()
    data = load_dataset(args.input)
    papers_by_id = {paper["id"]: paper for paper in data["papers"]}
    sample_ids = select_evaluation_sample(data["papers"], 30)
    baseline_started = time.perf_counter()
    baseline = TitleTopicBaseline(data["papers"])
    method_results: dict[str, dict[str, list[list[str | float]]]] = {
        "title-topic-tfidf": {paper_id: baseline.neighbours(paper_id, 5) for paper_id in sample_ids}
    }
    runtimes: dict[str, Any] = {
        "title-topic-tfidf": {"seconds": round(time.perf_counter() - baseline_started, 3), "device": "cpu"}
    }
    coverage: dict[str, Any] = {}

    for model_key in MODELS:
        model_started = time.perf_counter()
        _prepared, vectors, token_stats, runtime = model_embeddings(
            model_key=model_key,
            data=data,
            cache=args.cache,
            device=args.device,
            batch_size=args.batch_size,
            offline=args.offline,
        )
        all_neighbours = compute_top_neighbours(
            [paper["id"] for paper in data["papers"]], vectors, 5
        )
        method_results[model_key] = {paper_id: all_neighbours[paper_id] for paper_id in sample_ids}
        runtime["totalModelEvaluationSeconds"] = round(time.perf_counter() - model_started, 3)
        runtimes[model_key] = runtime
        coverage[model_key] = token_stats
        del vectors, all_neighbours
        release_gpu()

    queries: list[dict[str, Any]] = []
    for paper_id in sample_ids:
        source = papers_by_id[paper_id]
        query = {
            "id": paper_id,
            "title": source["title"],
            "topics": source.get("topics", []),
            "hasAbstract": bool(source.get("abstract")),
            "methods": {},
        }
        for method, results in method_results.items():
            query["methods"][method] = [
                {
                    "id": neighbour_id,
                    "title": papers_by_id[neighbour_id]["title"],
                    "topics": papers_by_id[neighbour_id].get("topics", []),
                    "hasAbstract": bool(papers_by_id[neighbour_id].get("abstract")),
                    "score": score,
                }
                for neighbour_id, score in results[paper_id]
            ]
        queries.append(query)

    payload = {
        "schemaVersion": 1,
        "datasetVersion": data["version"],
        "inputSha256": sha256_file(args.input),
        "sample": {
            "count": len(sample_ids),
            "selection": "deterministic topic-stratified sample covering all official topics and balanced by abstract availability",
            "withAbstract": sum(query["hasAbstract"] for query in queries),
            "missingAbstract": sum(not query["hasAbstract"] for query in queries),
            "topicCount": len({topic for query in queries for topic in query["topics"]}),
        },
        "methods": {
            "title-topic-tfidf": {
                "kind": "baseline",
                "input": "official title and topics only",
                "score": "cosine similarity over weighted TF-IDF features",
            },
            **{
                key: {
                    "kind": "embedding",
                    "repository": spec.repository,
                    "revision": spec.revision,
                    "adapterRepository": spec.adapter_repository,
                    "adapterRevision": spec.adapter_revision,
                    "dimensions": spec.dimensions,
                    "contextTokens": spec.max_tokens,
                    "license": spec.license,
                    "score": "cosine similarity",
                }
                for key, spec in MODELS.items()
            },
        },
        "coverage": coverage,
        "runtimes": runtimes,
        "totalSeconds": round(time.perf_counter() - started, 3),
        "queries": queries,
    }
    atomic_write_bytes(args.output, canonical_json(payload))
    print(
        f"Wrote {args.output} with {len(queries)} queries "
        f"({payload['sample']['withAbstract']} abstracts, {payload['sample']['missingAbstract']} missing)"
    )


def generate(args: argparse.Namespace) -> None:
    started = time.perf_counter()
    data = load_dataset(args.input)
    spec = MODELS[args.model]
    prepared, vectors, token_stats, runtime = model_embeddings(
        model_key=args.model,
        data=data,
        cache=args.cache,
        device=args.device,
        batch_size=args.batch_size,
        offline=args.offline,
    )
    neighbour_started = time.perf_counter()
    neighbours = compute_top_neighbours([paper.id for paper in prepared], vectors, args.neighbors)
    runtime["neighborSeconds"] = round(time.perf_counter() - neighbour_started, 3)
    runtime["pipelineSecondsBeforePublish"] = round(time.perf_counter() - started, 3)
    runtime["dependencies"] = dependency_versions()
    target, promoted = publish_artifacts(
        data=data,
        input_path=args.input,
        output_root=args.output,
        spec=spec,
        embeddings=vectors,
        neighbours=neighbours,
        k=args.neighbors,
        generation=runtime,
        token_stats=token_stats,
    )
    manifest = validate_current(args.output, args.input)
    action = "published" if promoted else "reused existing validated version"
    print(f"{action}: {target}")
    print(
        f"validated {manifest['dataset']['paperCount']} papers, {manifest['neighborFormat']['k']} neighbours each, "
        f"{manifest['model']['dimensions']} dimensions"
    )


def validate(args: argparse.Namespace) -> None:
    manifest = validate_current(args.output, args.input)
    files = manifest["files"]
    print(
        json.dumps(
            {
                "artifactVersion": manifest["artifactVersion"],
                "datasetVersion": manifest["dataset"]["version"],
                "papers": manifest["dataset"]["paperCount"],
                "model": manifest["model"]["key"],
                "dimensions": manifest["model"]["dimensions"],
                "neighborsPerPaper": manifest["neighborFormat"]["k"],
                "files": {key: value["bytes"] for key, value in files.items()},
                "status": "valid",
            },
            indent=2,
        )
    )


def common_arguments(parser: argparse.ArgumentParser, include_output: bool = True) -> None:
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--offline", action="store_true", help="require already-cached model files")
    if include_output:
        parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    evaluation = subparsers.add_parser("evaluate", help="compare the baseline and both candidate models")
    common_arguments(evaluation, include_output=False)
    evaluation.add_argument("--output", type=Path, default=EVALUATION_DIR / "results.json")
    evaluation.set_defaults(handler=evaluate)

    generation = subparsers.add_parser("generate", help="generate and atomically publish a complete artifact version")
    common_arguments(generation)
    generation.add_argument("--model", choices=tuple(MODELS), default=SELECTED_MODEL)
    generation.add_argument("--neighbors", type=int, default=30)
    generation.set_defaults(handler=generate)

    validation = subparsers.add_parser("validate", help="validate the current published artifact against conference data")
    validation.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    validation.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    validation.set_defaults(handler=validate)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if getattr(args, "batch_size", None) is not None and args.batch_size < 1:
        raise ValueError("--batch-size must be positive")
    args.handler(args)


if __name__ == "__main__":
    main()
