import { Dataset, Paper, Session } from './conference';

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

export type SessionSuggestion = {
  session: Session;
  score: number;
  papers: { paper: Paper; score: number }[];
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

/**
 * Score every paper session from the user's saved-paper interests.
 *
 * A session is judged by its best three unseen papers, rather than its total
 * score, so large poster sessions do not automatically beat small oral ones.
 * Reverse neighbour links and a small topic-overlap fallback give sparse
 * recommendation graphs enough coverage to surface cross-domain matches.
 */
export function rankSessionSuggestions(
  data: Dataset,
  recommendations: RecommendationData,
  savedPaperIds: string[],
  dismissedPaperIds: string[],
  additionallyExcludedPaperIds: string[] = [],
): SessionSuggestion[] {
  const byId = new Map(data.papers.map((paper) => [paper.id, paper]));
  const saved = [...new Set(savedPaperIds)]
    .map((paperId) => byId.get(paperId))
    .filter((paper): paper is Paper => Boolean(paper));
  if (!saved.length) return [];

  const excluded = new Set([
    ...savedPaperIds,
    ...dismissedPaperIds,
    ...additionallyExcludedPaperIds,
  ]);
  const savedIds = new Set(saved.map((paper) => paper.id));
  const contributions = new Map<string, Map<string, number>>();
  const record = (candidateId: string, savedId: string, score: number) => {
    if (excluded.has(candidateId) || score <= 0) return;
    const candidate =
      contributions.get(candidateId) || new Map<string, number>();
    candidate.set(savedId, Math.max(candidate.get(savedId) || 0, score));
    contributions.set(candidateId, candidate);
  };

  for (const savedPaper of saved)
    (recommendations.neighbors[savedPaper.id] || []).forEach(
      ([candidateId, cosine], index) => {
        record(
          candidateId,
          savedPaper.id,
          Math.max(0, cosine) / Math.log2(index + 3),
        );
        (recommendations.neighbors[candidateId] || []).forEach(
          ([secondHopId, secondHopCosine], secondHopIndex) => {
            record(
              secondHopId,
              savedPaper.id,
              (0.3 * Math.max(0, Math.min(cosine, secondHopCosine))) /
                Math.sqrt(Math.log2(index + 3) * Math.log2(secondHopIndex + 3)),
            );
            (recommendations.neighbors[secondHopId] || []).forEach(
              ([thirdHopId, thirdHopCosine], thirdHopIndex) =>
                record(
                  thirdHopId,
                  savedPaper.id,
                  (0.09 *
                    Math.max(
                      0,
                      Math.min(cosine, secondHopCosine, thirdHopCosine),
                    )) /
                    Math.cbrt(
                      Math.log2(index + 3) *
                        Math.log2(secondHopIndex + 3) *
                        Math.log2(thirdHopIndex + 3),
                    ),
                ),
            );
          },
        );
      },
    );

  for (const [candidateId, neighbors] of Object.entries(
    recommendations.neighbors,
  ))
    neighbors.forEach(([neighborId, cosine], index) => {
      if (savedIds.has(neighborId))
        record(
          candidateId,
          neighborId,
          Math.max(0, cosine) / Math.log2(index + 3),
        );
    });

  const savedTopicSets = saved
    .filter((paper) => paper.topics.length)
    .map((paper) => ({ paperId: paper.id, topics: new Set(paper.topics) }));
  for (const paper of data.papers) {
    if (excluded.has(paper.id) || !paper.topics.length) continue;
    const paperTopics = new Set(paper.topics);
    for (const savedPaper of savedTopicSets) {
      const topicScore = 0.12 * overlap(paperTopics, savedPaper.topics);
      record(paper.id, savedPaper.paperId, topicScore);
    }
  }

  const paperScores = new Map<string, number>();
  for (const [paperId, bySavedPaper] of contributions) {
    const scores = [...bySavedPaper.values()].sort(
      (left, right) => right - left,
    );
    paperScores.set(paperId, scores[0] + 0.15 * (scores[1] || 0));
  }

  const paperIdsBySession = new Map<string, Set<string>>();
  for (const presentation of data.presentations) {
    if (!presentation.sessionId) continue;
    const ids =
      paperIdsBySession.get(presentation.sessionId) || new Set<string>();
    ids.add(presentation.paperId);
    paperIdsBySession.set(presentation.sessionId, ids);
  }

  const candidates: SessionSuggestion[] = [];
  for (const session of data.sessions) {
    if (!session.startsAt || !paperIdsBySession.has(session.id)) continue;
    const papers = [...(paperIdsBySession.get(session.id) || [])]
      .flatMap((paperId) => {
        const paper = byId.get(paperId),
          score = paperScores.get(paperId) || 0;
        return paper && score > 0 ? [{ paper, score }] : [];
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.paper.id.localeCompare(right.paper.id),
      )
      .slice(0, 5);
    const score =
      (papers[0]?.score || 0) +
      0.55 * (papers[1]?.score || 0) +
      0.3 * (papers[2]?.score || 0);
    candidates.push({ session, score, papers });
  }

  return candidates.sort(
    (left, right) =>
      right.score - left.score ||
      Date.parse(left.session.startsAt!) -
        Date.parse(right.session.startsAt!) ||
      left.session.id.localeCompare(right.session.id),
  );
}
