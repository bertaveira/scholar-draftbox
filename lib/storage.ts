import { parseProfile, profile, STORAGE_KEY } from './conference';
let ids: string[] = [];
let dismissedIds: string[] = [];
let issue = '';
let recommendationIssue = '';
let initialized = false;
const listeners = new Set<() => void>();
export const RECOMMENDATION_DISMISSALS_KEY =
  'eccv-scout.recommendation-dismissals.v1';

function parseDismissals(value: unknown): string[] {
  const record = value as Record<string, unknown>;
  if (
    !record ||
    record.schemaVersion !== 1 ||
    record.conference !== 'eccv-2026' ||
    !Array.isArray(record.paperIds) ||
    record.paperIds.length > 10000 ||
    record.paperIds.some(
      (paperId) =>
        typeof paperId !== 'string' || !/^eccv-2026-\d+$/.test(paperId),
    )
  )
    throw Error('Invalid recommendation dismissals.');
  return [...new Set(record.paperIds as string[])];
}

const dismissalProfile = (paperIds: string[]) => ({
  schemaVersion: 1,
  conference: 'eccv-2026',
  paperIds: [...new Set(paperIds)],
});

function emit() {
  listeners.forEach((fn) => fn());
}
export function initializeStorage() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const readSaved = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      ids = raw ? parseProfile(JSON.parse(raw)) : [];
      issue = '';
    } catch {
      issue =
        'Saved papers could not be read. Export a backup before clearing browser data.';
    }
  };
  const readDismissals = () => {
    try {
      const raw = localStorage.getItem(RECOMMENDATION_DISMISSALS_KEY);
      dismissedIds = raw ? parseDismissals(JSON.parse(raw)) : [];
      recommendationIssue = '';
    } catch {
      recommendationIssue =
        'Dismissed recommendations could not be read. Suggestions may reappear.';
    }
  };
  readSaved();
  readDismissals();
  emit();
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === null) readSaved();
    if (e.key === RECOMMENDATION_DISMISSALS_KEY || e.key === null)
      readDismissals();
    emit();
  });
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export const getSaved = () => ids;
export const getDismissedRecommendations = () => dismissedIds;
const empty: string[] = [];
export const getServerSaved = () => empty;
export const getServerDismissedRecommendations = () => empty;
export const getStorageIssue = () => issue;
export const getRecommendationStorageIssue = () => recommendationIssue;
export function setSaved(next: string[]) {
  ids = parseProfile(profile(next));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile(ids)));
    issue = '';
  } catch {
    issue =
      'Browser storage is unavailable. Changes last only for this visit; export a backup.';
  }
  emit();
  return ids;
}
export function setBookmark(id: string, save: boolean) {
  return setSaved(save ? [...ids, id] : ids.filter((x) => x !== id));
}
export function importProfile(value: unknown) {
  const imported = parseProfile(value);
  return setSaved([...ids, ...imported]);
}

export function setDismissedRecommendations(next: string[]) {
  dismissedIds = parseDismissals(dismissalProfile(next));
  try {
    localStorage.setItem(
      RECOMMENDATION_DISMISSALS_KEY,
      JSON.stringify(dismissalProfile(dismissedIds)),
    );
    recommendationIssue = '';
  } catch {
    recommendationIssue =
      'Browser storage is unavailable. Dismissals last only for this visit.';
  }
  emit();
  return dismissedIds;
}

export function dismissRecommendation(paperId: string) {
  return setDismissedRecommendations([...dismissedIds, paperId]);
}

export function clearDismissedRecommendations() {
  return setDismissedRecommendations([]);
}
