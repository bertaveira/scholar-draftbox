import Fuse from "fuse.js";
export type Paper = {
  id: string;
  officialId: string;
  title: string;
  authors: string[];
  topics: string[];
  abstract: string | null;
  officialUrl: string;
  paperUrl: string | null;
};
export type Session = {
  id: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  room: string | null;
  officialUrl: string;
};
export type Presentation = {
  id: string;
  paperId: string;
  sessionId: string | null;
  type: string;
  posterNumber: string | null;
  room: string | null;
  officialUrl: string;
};
export type Dataset = {
  schemaVersion: 1;
  version: string;
  retrievedAt: string;
  timezone: string;
  sources: string[];
  papers: Paper[];
  sessions: Session[];
  presentations: Presentation[];
  coverage: Record<string, unknown>;
};
export type Filters = { day: string; session: string; type: string; topic: string };
export const emptyFilters: Filters = { day: "all", session: "all", type: "all", topic: "all" };
export const dayKey = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Stockholm",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(date))
    : "";
export const dayLabel = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Stockholm",
        weekday: "long",
        day: "numeric",
        month: "short",
      }).format(new Date(date))
    : "Schedule not available";
export const timeLabel = (s: Session) =>
  s.startsAt
    ? `${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" }).format(new Date(s.startsAt))}${s.endsAt ? "–" + new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" }).format(new Date(s.endsAt)) : ""}`
    : "Time not available";
export function createSearch(data: Dataset) {
  const fuse = new Fuse(data.papers, {
    keys: [
      { name: "title", weight: 4 },
      { name: "authors", weight: 2 },
      { name: "topics", weight: 2 },
      { name: "abstract", weight: 1 },
    ],
    threshold: 0.32,
    ignoreLocation: true,
    ignoreDiacritics: true,
  });
  const sessions = new Map(data.sessions.map((s) => [s.id, s]));
  const byPaper = new Map<string, Presentation[]>();
  data.presentations.forEach((p) => byPaper.set(p.paperId, [...(byPaper.get(p.paperId) || []), p]));
  return (query: string, filters: Filters = emptyFilters) => {
    const rows = query.trim() ? fuse.search(query.trim()).map((x) => x.item) : data.papers;
    return rows.filter(
      (p) =>
        (filters.topic === "all" || p.topics.includes(filters.topic)) &&
        ((filters.day === "all" && filters.session === "all" && filters.type === "all") ||
          (byPaper.get(p.id) || []).some(
            (x) =>
              (filters.session === "all" || x.sessionId === filters.session) &&
              (filters.type === "all" || x.type === filters.type) &&
              (filters.day === "all" ||
                dayKey(sessions.get(x.sessionId || "")?.startsAt || null) === filters.day),
          )),
    );
  };
}
export function parseProfile(value: unknown): string[] {
  if (!value || typeof value !== "object") throw Error("This is not an ECCV Scout profile.");
  const v = value as Record<string, unknown>;
  if (
    v.schemaVersion !== 1 ||
    v.conference !== "eccv-2026" ||
    !Array.isArray(v.savedPaperIds) ||
    v.savedPaperIds.length > 10000 ||
    v.savedPaperIds.some((x) => typeof x !== "string" || !/^eccv-2026-\d+$/.test(x))
  )
    throw Error("Invalid profile. Your saved papers have not changed.");
  return [...new Set(v.savedPaperIds as string[])];
}
export const profile = (ids: string[]) => ({
  schemaVersion: 1,
  conference: "eccv-2026",
  savedPaperIds: [...new Set(ids)],
});
export const STORAGE_KEY = "eccv-scout.profile.v1";
export function validateDataset(value: unknown): Dataset {
  const d = value as Dataset;
  if (
    !d ||
    d.schemaVersion !== 1 ||
    typeof d.version !== "string" ||
    !d.version ||
    !Number.isFinite(Date.parse(d.retrievedAt)) ||
    d.timezone !== "Europe/Stockholm" ||
    !Array.isArray(d.papers) ||
    !d.papers.length ||
    !Array.isArray(d.sessions) ||
    !Array.isArray(d.presentations) ||
    !Array.isArray(d.sources)
  )
    throw Error("Conference data is invalid.");
  const safeUrl = (v: unknown) => typeof v === "string" && /^https?:\/\//.test(v);
  const nullableString = (v: unknown) => v === null || typeof v === "string";
  for (const p of d.papers)
    if (
      typeof p.id !== "string" ||
      !/^eccv-2026-\d+$/.test(p.id) ||
      typeof p.title !== "string" ||
      !p.title.trim() ||
      !Array.isArray(p.authors) ||
      p.authors.some((a) => typeof a !== "string") ||
      !Array.isArray(p.topics) ||
      p.topics.some((t) => typeof t !== "string") ||
      !nullableString(p.abstract) ||
      !safeUrl(p.officialUrl) ||
      (p.paperUrl !== null && !safeUrl(p.paperUrl))
    )
      throw Error("Invalid paper record.");
  for (const s of d.sessions)
    if (
      typeof s.id !== "string" ||
      typeof s.name !== "string" ||
      !s.name ||
      !nullableString(s.room) ||
      !safeUrl(s.officialUrl) ||
      [s.startsAt, s.endsAt].some(
        (t) =>
          t !== null &&
          (typeof t !== "string" ||
            !/(Z|[+-]\d\d:\d\d)$/.test(t) ||
            !Number.isFinite(Date.parse(t))),
      ) ||
      (s.startsAt && s.endsAt && Date.parse(s.startsAt) >= Date.parse(s.endsAt))
    )
      throw Error("Invalid session record.");
  const pids = new Set(d.papers.map((p) => p.id)),
    sids = new Set(d.sessions.map((s) => s.id));
  if (
    pids.size !== d.papers.length ||
    sids.size !== d.sessions.length ||
    new Set(d.presentations.map((p) => p.id)).size !== d.presentations.length
  )
    throw Error("Duplicate dataset identifiers.");
  for (const p of d.presentations)
    if (
      typeof p.id !== "string" ||
      !pids.has(p.paperId) ||
      (p.sessionId !== null && !sids.has(p.sessionId)) ||
      !["poster", "oral", "spotlight"].includes(p.type) ||
      !nullableString(p.posterNumber) ||
      !nullableString(p.room) ||
      !safeUrl(p.officialUrl)
    )
      throw Error("Invalid presentation reference.");
  return d;
}
export function groupSaved(data: Dataset, ids: string[]) {
  const selected = new Set(ids);
  const byId = new Map(data.papers.map((p) => [p.id, p]));
  const groups = data.sessions
    .map((session) => ({
      session,
      papers: [
        ...new Set(
          data.presentations
            .filter((p) => p.sessionId === session.id && selected.has(p.paperId))
            .map((p) => p.paperId),
        ),
      ].map((id) => byId.get(id)!),
    }))
    .filter((g) => g.papers.length);
  const scheduled = new Set(groups.flatMap((g) => g.papers.map((p) => p.id)));
  return {
    groups,
    unscheduled: data.papers.filter((p) => selected.has(p.id) && !scheduled.has(p.id)),
    unknown: ids.filter((id) => !byId.has(id)),
  };
}
export function sortPosters(papers: Paper[], presentations: Presentation[], sessionId: string) {
  const numbers = new Map(
    presentations.filter((p) => p.sessionId === sessionId).map((p) => [p.paperId, p.posterNumber]),
  );
  return [...papers].sort((a, b) => {
    const an = numbers.get(a.id),
      bn = numbers.get(b.id);
    return an && bn
      ? an.localeCompare(bn, undefined, { numeric: true })
      : an
        ? -1
        : bn
          ? 1
          : a.title.localeCompare(b.title);
  });
}
