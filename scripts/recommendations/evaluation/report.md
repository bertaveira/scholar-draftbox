# Recommendation model evaluation

## Decision

Use **SPECTER2 with the proximity adapter** for the published artifacts. The 30-paper inspection was close: MiniLM was preferable on ten queries, SPECTER2 on nine, and the remaining eleven were not meaningfully distinguishable from titles and available abstracts. SPECTER2 produced slightly broader top-five topic coverage (2.83 distinct official topics per query versus 2.70 for MiniLM and 2.47 for the keyword baseline) and handled useful cross-topic relationships particularly well. Most importantly, every paper fit its 512-token context (maximum 482), while MiniLM right-truncated 1,437 of 2,863 inputs at 256 tokens.

This was not a “larger is automatically better” choice. MiniLM's 384-dimensional embedding file would be half the size and it was clearly better for several sparse/title-only cases. SPECTER2's checked-in 768-dimensional file is still only 4.19 MiB, and GPU runtime was effectively tied, so complete abstract coverage and scientific-retrieval behavior outweighed the extra 2.10 MiB. Revisit the choice when official abstracts fill the missing 983 records or the corpus changes materially.

## Method

The deterministic sample contains 30 papers, covers all 18 official topics, and is balanced between 15 sourced-abstract and 15 missing-abstract queries. For each query, the top five from the title/topic TF-IDF baseline, MiniLM, and SPECTER2 were inspected. “Prefer” below is a qualitative read of topical/method relevance and useful variety, not benchmark accuracy or a ground-truth label. Raw titles, stable IDs, topics, abstract-presence flags, cosine scores, and exact model revisions are retained in `results.json`.

| # | Abstract | Query (shortened) | Embedding-model readout | Obvious issue or useful distinction |
| ---: | :---: | --- | --- | --- |
| 1 | yes | DiffGI thin-shell 3D generation | SPECTER2 | Strong 3D shape/generation set despite crossing the coarse official topic label. |
| 2 | no | DINOv3D unified spatial understanding | SPECTER2 | Both were good; SPECTER2 grouped unified 3D representations and reconstruction more coherently. |
| 3 | yes | SynCity scene-scale 3D diffusion | tie | Both mixed scene/world generation with one adjacent 4D result. |
| 4 | no | SHINE-PPG illumination-robust rPPG | MiniLM | Both drifted toward generic low-light/restoration; neither preserved the physiological rPPG aspect well. |
| 5 | yes | WildDepth wildlife depth dataset | tie | Depth/3D results were relevant, but the wildlife/data-set angle disappeared. |
| 6 | no | ReconDreamer-RL | tie | Both found visual RL/world-model papers; the diffusion-reconstruction mechanism was weakly represented. |
| 7 | yes | Domain-incremental object detection | tie | Relevant continual/open-world detection, with moderate drift to generic adaptation. |
| 8 | no | Articulated category-level pose | tie | Both put the nearly exact PriorPose paper first; keyword baseline was also strong here. |
| 9 | yes | Dress-ED virtual try-on editing | tie | Four of five results were directly try-on/editing related for both. |
| 10 | no | Lightweight image inpainting | SPECTER2 | Better balance of inpainting, super-resolution, and efficient restoration. |
| 11 | yes | Fast vision-language grounding | SPECTER2 | Grounding and spatial VLM results were semantically coherent beyond shared title words. |
| 12 | no | Pseudo-label calibration for cross-domain few-shot detection | SPECTER2 | Best result directly matched pseudo-label/domain-adaptive detection; one unrelated re-ID result remained. |
| 13 | yes | CountEx exemplar counting | MiniLM | SPECTER2 largely returned generic detection/grounding; MiniLM at least surfaced a contrastive counting paper. |
| 14 | no | Frequency experts for concealed segmentation | MiniLM | MiniLM retrieved two direct concealed/camouflaged segmentation papers; SPECTER2 mixed in unrelated recognition/security. |
| 15 | yes | Physics + diffusion dynamic hair | tie | Both put HairWeaver first and covered hair, avatars, and physical motion. |
| 16 | no | Neural video representation compression | MiniLM | Both drifted to token compression and video representation; MiniLM included a video-codec VAE. |
| 17 | yes | Activation quantization of vision encoders | tie | The keyword baseline retained quantization more consistently; dense results broadened to pruning/efficient encoders. |
| 18 | no | Latent action prototyping for VLA | SPECTER2 | Four of five were closely related VLA latent/action representations. |
| 19 | yes | Multi-view spatial VLM benchmark | tie | Both produced an excellent, varied spatial-reasoning benchmark set. |
| 20 | yes | Mapping gated communities and equity | SPECTER2 | Strong cross-vocabulary geospatial/cadastral/urban retrieval; the lexical baseline failed conspicuously. |
| 21 | yes | Stylized novel-view 3D animation | MiniLM | MiniLM kept more 3D view-consistent/stylization candidates; both lost some animation specificity. |
| 22 | yes | Personalized long-horizon speech | MiniLM | Both were mixed; SPECTER2 overemphasized token compression while MiniLM retained more audio-generation results. |
| 23 | yes | Parametric CAD generation | tie | Both found CAD/B-rep/mold-design work; SPECTER2 added a useful 3D-printing relation. |
| 24 | yes | Diffusion feature caching | SPECTER2 | SPECTER2 kept diffusion acceleration in view, though the lexical baseline gave the most exact caching set. |
| 25 | no | RGB+thermal 3D reconstruction adaptation | SPECTER2 | Better multi-view/geometry reconstruction mix; thermal specificity was mostly lost by both. |
| 26 | no | Sound-based multi-person 3D pose | MiniLM | All methods struggled to combine sound, multi-person, and pose; MiniLM at least placed an audio-visual pose paper first. |
| 27 | no | Token pruning for edge MLLMs | tie | Both produced focused visual-token compression/pruning lists with useful method diversity. |
| 28 | no | Unpaired image dehazing | MiniLM | MiniLM returned three direct dehazing papers; SPECTER2 had an obvious unrelated margin-loss failure at rank two. |
| 29 | no | Low-cost hyperspectral imaging | MiniLM | MiniLM retained hyperspectral specificity in three results; SPECTER2 broadened toward computational imaging. |
| 30 | no | Egocentric hand trajectory prediction | MiniLM | MiniLM better preserved egocentric hand/object interaction and trajectory; SPECTER2 mixed in generic scene understanding. |

The keyword baseline remains valuable as a sanity check. It excelled when distinctive phrases repeated (virtual try-on, articulated pose, diffusion caching, dehazing), but produced lexical false friends for CountEx (“fine-grained” tasks unrelated to counting), Pointer-CAD (“parametric” ionospheric prediction), and urban-equity mapping. Its stronger same-topic rate (3.27 of five) also reflected the explicit topic-label feature and came with lower cross-topic diversity.

## Runtime and size

Environment: RTX 5090 (32 GB), NVIDIA driver 580.126.18, PyTorch 2.11.0+cu128, Python 3.12.12. With model downloads already present but an empty v2 paper-vector cache, the full 2,863-paper evaluation took 29.4 seconds: 14.7 seconds for MiniLM and 14.4 seconds for SPECTER2, including model load, cache writes, and top-five construction. The baseline took 0.086 seconds on CPU. A cached selected-model publication took about 4.0 seconds before final validation.

Published SPECTER2 files:

| File | Bytes | MiB |
| --- | ---: | ---: |
| `embeddings.f16` | 4,397,568 | 4.19 |
| `neighbors.json` | 2,449,979 | 2.34 |
| `paper-ids.json` | 48,739 | 0.05 |
| `manifest.json` + `current.json` | 3,185 | <0.01 |
| **Total** | **6,899,471** | **6.58** |

## Limitations

- This is one human qualitative pass over 30 queries, not an accuracy, click-through, citation, or user-satisfaction benchmark. ECCV topics are broad and imperfect proxies for relevance.
- Missing abstracts materially weaken all dense models. Title/topic fallback can over-index on fashionable terms and cannot recover method details that are absent from the source.
- Cosine distributions differ sharply: SPECTER2 scores in this sample were tightly compressed (0.908–0.975). Scores are only for ordering within this artifact and must not be displayed as confidence/probability or compared with another model's values.
- Nearest neighbours can be redundant and can reinforce dense conference themes. The proposed browser ranker balances saved-paper interest buckets and lightly suppresses near-duplicates.
- MiniLM's 256-token path explicitly truncates long inputs; SPECTER2 did not truncate this snapshot, but future refreshed abstracts can exceed 512 and will be recorded/right-truncated under the same policy.
- No relevance feedback or personal data leaves the browser. Dismissals and saves remain device-local, so preferences do not transfer unless the existing profile transfer mechanism is used.
