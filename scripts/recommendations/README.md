# Offline recommendation data

This directory builds static paper-to-paper recommendation data. The browser integration lives separately in [`lib/recommendations.ts`](../../lib/recommendations.ts), reads bookmarks without changing their format, and never calls a model. Free-text semantic search is not implemented.

## Reproduce

Python 3.12 was used for the checked-in artifacts. Create an ignored local environment and choose one PyTorch backend:

```sh
uv venv .recommendations-venv --python 3.12

# RTX 5090 / other CUDA 12.8-compatible NVIDIA GPU
uv pip install --python .recommendations-venv/bin/python \
  --torch-backend cu128 \
  -r scripts/recommendations/requirements.txt

# CPU fallback (same artifacts, slower inference)
uv pip install --python .recommendations-venv/bin/python \
  --torch-backend cpu \
  -r scripts/recommendations/requirements.txt
```

Run the 30-paper comparison, generate the selected model, and validate the published version:

```sh
.recommendations-venv/bin/python -m scripts.recommendations.pipeline evaluate --device cuda
.recommendations-venv/bin/python -m scripts.recommendations.pipeline generate --model specter2 --device cuda --neighbors 30
python3 -m scripts.recommendations.pipeline validate
```

For CPU-only regeneration, replace `--device cuda` with `--device cpu --batch-size 8`. Add `--offline` after the first successful model download to forbid network access. The default ignored cache is `.recommendations-cache/`; deleting it is safe but forces all papers to be embedded again.

The embedding cache path includes the exact model/adapter revisions, all preprocessing settings, and a hash of each paper's stable ID, title, sourced abstract (or missing state), and topics. A data refresh therefore reuses unchanged rows and recomputes changed/new rows only.

## Inputs and models

The baseline is weighted TF-IDF over official title unigrams/bigrams and official topics. It deliberately does not use abstracts.

Exactly two open models are evaluated:

| Key        | Intended use                                             | Revision                                                                                                                                         | Context | Dimensions | License    |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------: | ---------: | ---------- |
| `minilm`   | General sentence/short-paragraph similarity              | `sentence-transformers/all-MiniLM-L6-v2@1110a243fdf4706b3f48f1d95db1a4f5529b4d41`                                                                |     256 |        384 | Apache-2.0 |
| `specter2` | Scientific paper proximity / nearest-neighbour retrieval | `allenai/specter2_base@3447645e1def9117997203454fa4495937bfbd83` + proximity adapter `allenai/specter2@2081559630a80fc5851d8f798a05ba81e9468089` |     512 |        768 | Apache-2.0 |

The pinned [MiniLM model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) describes mean pooling, 384-dimensional output, Apache-2.0 licensing, and truncation beyond 256 word pieces. The [SPECTER2 model card](https://huggingface.co/allenai/specter2) identifies the proximity adapter for paper-query/candidate nearest-neighbour retrieval, title-plus-abstract input, CLS pooling, 512-token training inputs, and Apache-2.0 licensing. The evaluation uses those instructions directly.

Text is Unicode NFC-normalized and whitespace-collapsed. Papers with a sourced abstract use `title + tokenizer SEP + abstract`. The 983 papers without one use `title + tokenizer SEP + "Topics: " + official topics`; no abstract is invented. Before inference, the pipeline tokenizes every untruncated input and records how many exceed the model limit. Right truncation preserves the title and removes only the tail of the abstract/topic fallback. In this snapshot MiniLM exceeded its limit for 1,437 papers; SPECTER2 exceeded it for none (maximum 482 tokens).

## Artifact layout and schema

`public/data/recommendations/current.json` is the small atomic pointer. It names a complete immutable directory under `versions/<artifactVersion>/` containing:

- `manifest.json`: dataset/schema versions, complete conference input SHA-256, recommendation-content SHA-256, exact model and adapter revisions, license, preprocessing, coverage/truncation counts, dimensions, numeric layout, runtime/device information, file sizes, and file hashes.
- `paper-ids.json`: explicit row ordering. `paperIds[i]` owns embedding row `i`.
- `embeddings.f16`: headerless little-endian IEEE-754 binary16, row-major, 768 values per paper for the selected model. Rows are L2-normalized in float32 before conversion; validation allows at most 0.002 norm error after binary16 encoding.
- `neighbors.json`: `{schemaVersion,datasetVersion,model,k,similarity,neighbors}`. `neighbors[paperId]` is a descending list of `[neighborPaperId, cosineSimilarity]`. Scores are raw cosine similarities, not probabilities or percentage relevance.

Self-matches and duplicate neighbour IDs are rejected. Validation also checks finite vectors/scores, byte length, dimensions, stable-ID ordering, exactly 30 relationships per paper, descending scores, target existence, score/vector agreement, every file hash, and compatibility with the current `conference.json`.

Generation writes a sibling staging directory, validates the complete version, atomically renames it into `versions/`, and only then atomically replaces `current.json`. Any exception leaves the previous pointer and version intact. Older valid versions are intentionally retained.

## Browser-side personalization

The implemented UI personalizes entirely from `neighbors.json`; it does not need the binary embeddings, a user profile on a server, or a per-user model call. The production service worker therefore precaches the pointer, manifest, and neighbour graph, but not `embeddings.f16` or `paper-ids.json`. Those pipeline artifacts remain available in the immutable version directory without consuming visitors' offline-cache quota.

1. Read saved IDs from local storage. Remove saved IDs and locally dismissed IDs from every candidate stream.
2. Build lightweight interest buckets among saved papers with union-find. Join two saved papers when either appears in the other's top-30 list or their top-30 neighbour sets have Jaccard overlap of at least 0.2. Unconnected saves remain separate interests.
3. For candidate `c` contributed by saved paper `s` at one-based rank `r`, use `max(0, cosine(s,c)) / log2(r + 2)`. Within each interest bucket use the strongest contribution plus `0.15` times the second strongest; do not average every bookmark into one vector/topic.
4. Produce the slate by fair interleaving across interest buckets (choose from the least-represented bucket, breaking ties by bucket score). Deduplicate candidates globally.
5. Keep the top contributing saved IDs with each candidate (normally one to three). The Suggestions page renders these as “Similar to [paper you saved].”

This makes several saved papers on one theme reinforce candidates without allowing that theme to erase unrelated saved interests. The numeric constants are transparent local ranking policy, not learned relevance claims. Free-text semantic search remains out of scope because it needs a separate query encoder (for SPECTER2, the adhoc-query adapter), preprocessing contract, and artifacts.

See [evaluation/report.md](evaluation/report.md) for the model decision and inspected examples. The machine-readable top-five outputs for all 30 queries are in `evaluation/results.json`.
