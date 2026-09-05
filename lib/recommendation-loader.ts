import { Dataset } from './conference';
import {
  RecommendationData,
  validateRecommendationData,
} from './recommendations';

const ROOT = '/data/recommendations/';

type CurrentPointer = {
  schemaVersion: 1;
  artifactVersion: string;
  datasetVersion: string;
  manifest: string;
};

type RecommendationManifest = {
  schemaVersion: 1;
  artifactVersion: string;
  dataset: { version: string };
  files: { neighbors: { file: string } };
};

async function json(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw Error('Download failed');
  return response.json();
}

export async function loadRecommendations(
  data: Dataset,
): Promise<RecommendationData> {
  try {
    const pointer = (await json(ROOT + 'current.json')) as CurrentPointer;
    if (
      !pointer ||
      pointer.schemaVersion !== 1 ||
      pointer.datasetVersion !== data.version ||
      typeof pointer.artifactVersion !== 'string' ||
      !pointer.artifactVersion ||
      typeof pointer.manifest !== 'string' ||
      !/^versions\/[a-zA-Z0-9._-]+\/manifest\.json$/.test(pointer.manifest)
    )
      throw Error('Incompatible pointer');
    const manifest = (await json(
      ROOT + pointer.manifest,
    )) as RecommendationManifest;
    if (
      !manifest ||
      manifest.schemaVersion !== 1 ||
      manifest.artifactVersion !== pointer.artifactVersion ||
      manifest.dataset?.version !== data.version ||
      !/^[a-zA-Z0-9._-]+\.json$/.test(manifest.files?.neighbors?.file)
    )
      throw Error('Incompatible manifest');
    const directory = pointer.manifest.slice(
      0,
      pointer.manifest.lastIndexOf('/') + 1,
    );
    return validateRecommendationData(
      await json(ROOT + directory + manifest.files.neighbors.file),
      data,
    );
  } catch {
    throw Error(
      'Paper recommendations are unavailable for this conference snapshot.',
    );
  }
}
