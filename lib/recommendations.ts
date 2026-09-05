import { Dataset, Paper } from './conference';

export type NeighborEntry = [paperId: string, cosineSimilarity: number];
export type RecommendationData = {
  schemaVersion: 1;
  datasetVersion: string;
  model: string;
  k: number;
  similarity: 'cosine';
  neighbors: Record<string, NeighborEntry[]>;
};

export type PersonalizedSuggestion = {
  paper: Paper;
  score: number;
  contributingSavedPaperIds: string[];
};

export function validateRecommendationData(
  value: unknown,
  data: Dataset,
): RecommendationData {
  const recommendations = value as RecommendationData;
  if (
    !recommendations ||
    recommendations.schemaVersion !== 1 ||
    recommendations.datasetVersion !== data.version ||
    typeof recommendations.model !== 'string' ||
    !recommendations.model ||
    !Number.isInteger(recommendations.k) ||
    recommendations.k < 1 ||
    recommendations.k >= data.papers.length ||
    recommendations.similarity !== 'cosine' ||
    !recommendations.neighbors ||
    typeof recommendations.neighbors !== 'object' ||
    Array.isArray(recommendations.neighbors)
  )
    throw Error('Recommendation data is incompatible with this conference.');

  const known = new Set(data.papers.map((paper) => paper.id));
  const keys = Object.keys(recommendations.neighbors);
  if (keys.length !== known.size || keys.some((paperId) => !known.has(paperId)))
    throw Error('Recommendation data has incompatible paper IDs.');

  for (const [paperId, entries] of Object.entries(recommendations.neighbors)) {
    if (!Array.isArray(entries) || entries.length !== recommendations.k)
      throw Error(`Recommendation count is invalid for ${paperId}.`);
    const seen = new Set<string>();
    let previous = Infinity;
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2)
        throw Error(`Recommendation entry is invalid for ${paperId}.`);
      const [neighborId, score] = entry;
      if (
        typeof neighborId !== 'string' ||
        neighborId === paperId ||
        !known.has(neighborId) ||
        seen.has(neighborId) ||
        typeof score !== 'number' ||
        !Number.isFinite(score) ||
        score < -1.000001 ||
        score > 1.000001 ||
        score > previous + 1e-7
      )
        throw Error(`Recommendation relationship is invalid for ${paperId}.`);
      seen.add(neighborId);
      previous = score;
    }
  }
  return recommendations;
}

export function similarPapers(
  data: Dataset,
  recommendations: RecommendationData,
  paperId: string,
  limit = 5,
): { paper: Paper; similarity: number }[] {
  const byId = new Map(data.papers.map((paper) => [paper.id, paper]));
  return (recommendations.neighbors[paperId] || [])
    .slice(0, Math.max(0, limit))
    .flatMap(([neighborId, similarity]) => {
      const paper = byId.get(neighborId);
      return paper ? [{ paper, similarity }] : [];
    });
}

class DisjointSet {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    const parent = this.parent[index];
    if (parent !== index) this.parent[index] = this.find(parent);
    return this.parent[index];
  }

  join(left: number, right: number) {
    const leftRoot = this.find(left),
      rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent[rightRoot] = leftRoot;
  }
}

function overlap(left: Set<string>, right: Set<string>) {
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  return shared / (left.size + right.size - shared || 1);
}

/**
 * Build a fair local slate from saved-paper neighbour streams.
 * Saved papers in the same neighbourhood become one interest; interests are
 * interleaved instead of being averaged into a single profile vector.
 */
export function rankPersonalizedSuggestions(
  data: Dataset,
  recommendations: RecommendationData,
  savedPaperIds: string[],
  dismissedPaperIds: string[],
  limit = 8,
): PersonalizedSuggestion[] {
  if (limit <= 0) return [];
  const byId = new Map(data.papers.map((paper) => [paper.id, paper]));
  const saved = [...new Set(savedPaperIds)].filter((paperId) =>
    byId.has(paperId),
  );
  if (!saved.length) return [];

  const excluded = new Set([...savedPaperIds, ...dismissedPaperIds]);
  const neighborSets = saved.map(
    (paperId) =>
      new Set((recommendations.neighbors[paperId] || []).map(([id]) => id)),
  );
  const groups = new DisjointSet(saved.length);
  for (let left = 0; left < saved.length; left += 1)
    for (let right = left + 1; right < saved.length; right += 1)
      if (
        neighborSets[left].has(saved[right]) ||
        neighborSets[right].has(saved[left]) ||
        overlap(neighborSets[left], neighborSets[right]) >= 0.2
      )
        groups.join(left, right);

  const bucketBySeed = new Map(
    saved.map((paperId, index) => [paperId, groups.find(index)]),
  );
  const candidateContributions = new Map<string, Map<string, number>>();
  for (const savedId of saved) {
    const entries = recommendations.neighbors[savedId] || [];
    entries.forEach(([candidateId, cosine], index) => {
      if (excluded.has(candidateId)) return;
      const contribution = Math.max(0, cosine) / Math.log2(index + 1 + 2);
      const current =
        candidateContributions.get(candidateId) || new Map<string, number>();
      current.set(savedId, contribution);
      candidateContributions.set(candidateId, current);
    });
  }

  const queues = new Map<
    number,
    (PersonalizedSuggestion & { bucketScore: number })[]
  >();
  for (const [candidateId, contributions] of candidateContributions) {
    const paper = byId.get(candidateId);
    if (!paper) continue;
    const byBucket = new Map<number, number[]>();
    for (const [savedId, contribution] of contributions) {
      const bucket = bucketBySeed.get(savedId)!;
      byBucket.set(bucket, [...(byBucket.get(bucket) || []), contribution]);
    }
    const bucketScores = [...byBucket.entries()]
      .map(([bucket, values]) => {
        values.sort((left, right) => right - left);
        return [bucket, values[0] + 0.15 * (values[1] || 0)] as const;
      })
      .sort((left, right) => right[1] - left[1] || left[0] - right[0]);
    const primaryBucket = bucketScores[0][0];
    const score = bucketScores[0][1] + 0.1 * (bucketScores[1]?.[1] || 0);
    const contributingSavedPaperIds = [...contributions]
      .sort(
        ([leftId, left], [rightId, right]) =>
          right - left || leftId.localeCompare(rightId),
      )
      .slice(0, 3)
      .map(([savedId]) => savedId);
    const queue = queues.get(primaryBucket) || [];
    queue.push({
      paper,
      score,
      bucketScore: bucketScores[0][1],
      contributingSavedPaperIds,
    });
    queues.set(primaryBucket, queue);
  }

  for (const queue of queues.values())
    queue.sort(
      (left, right) =>
        right.score - left.score || left.paper.id.localeCompare(right.paper.id),
    );
  const orderedBuckets = [...queues]
    .sort(
      ([leftId, left], [rightId, right]) =>
        (right[0]?.bucketScore || 0) - (left[0]?.bucketScore || 0) ||
        leftId - rightId,
    )
    .map(([bucket]) => bucket);

  const result: PersonalizedSuggestion[] = [];
  const selected = new Set<string>();
  while (result.length < limit) {
    let added = false;
    for (const bucket of orderedBuckets) {
      const queue = queues.get(bucket)!;
      let suggestion = queue.shift();
      while (suggestion && selected.has(suggestion.paper.id))
        suggestion = queue.shift();
      if (!suggestion) continue;
      selected.add(suggestion.paper.id);
      result.push({
        paper: suggestion.paper,
        score: suggestion.score,
        contributingSavedPaperIds: suggestion.contributingSavedPaperIds,
      });
      added = true;
      if (result.length === limit) break;
    }
    if (!added) break;
  }
  return result;
}
