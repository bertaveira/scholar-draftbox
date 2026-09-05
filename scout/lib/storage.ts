import { parseProfile, profile, STORAGE_KEY } from "./conference";
let ids: string[] = [];
let issue = "";
let initialized = false;
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}
export function initializeStorage() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const read = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      ids = raw ? parseProfile(JSON.parse(raw)) : [];
      issue = "";
    } catch {
      issue = "Saved papers could not be read. Export a backup before clearing browser data.";
    }
    emit();
  };
  read();
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === null) read();
  });
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export const getSaved = () => ids;
const empty: string[] = [];
export const getServerSaved = () => empty;
export const getStorageIssue = () => issue;
export function setSaved(next: string[]) {
  ids = parseProfile(profile(next));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile(ids)));
    issue = "";
  } catch {
    issue = "Browser storage is unavailable. Changes last only for this visit; export a backup.";
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
