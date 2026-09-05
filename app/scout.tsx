/* Static-export pages use native navigation: client routing was retaining the Explore view. */
/* oxlint-disable next/no-html-link-for-pages */
'use client';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Bookmark,
  PackageOpen,
  Search,
  ArrowUpRight,
  ArrowLeft,
  MapPin,
  Clock,
  Download,
  Upload,
  WifiOff,
  ChevronRight,
  Check,
  Sparkles,
  X,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import SavedSchedule from './saved-schedule';
import BookmarkTransfer from './bookmark-transfer';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  createSearch,
  Dataset,
  Paper,
  Session,
  Filters,
  emptyFilters,
  profile,
  dayKey,
  dayLabel,
  timeLabel,
  groupSaved,
  sortPosters,
} from '@/lib/conference';
import {
  PersonalizedSuggestion,
  RecommendationData,
  rankPersonalizedSuggestions,
  similarPapers,
} from '@/lib/recommendations';
import {
  clearDismissedRecommendations,
  dismissRecommendation,
  getDismissedRecommendations,
  getRecommendationStorageIssue,
  getSaved,
  getServerDismissedRecommendations,
  getServerSaved,
  getStorageIssue,
  initializeStorage,
  subscribe,
  setBookmark,
  importProfile,
} from '@/lib/storage';
import { loadConference } from '@/lib/loader';
import { loadRecommendations } from '@/lib/recommendation-loader';
import { registerTools, ModelContext } from '@/lib/webmcp';
function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string[];
  options: { value: string; label: string }[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="filter-field">
      <div className="filter-field-heading">
        <span className="filter-label">{label}</span>
        {value.length > 0 && (
          <button
            className="filter-clear"
            aria-label={'Clear ' + label.toLowerCase() + ' filter'}
            onClick={() => onChange([])}
          >
            Clear
          </button>
        )}
      </div>
      <Select multiple value={value} onValueChange={(v) => onChange(v)}>
        <SelectTrigger aria-label={label} className="filter-trigger">
          <SelectValue>
            {value.length === 0
              ? options.find((o) => o.value === 'all')?.label || 'Any'
              : value.length === 1
                ? options.find((o) => o.value === value[0])?.label
                : `${value.length} selected`}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          alignItemWithTrigger={false}
          align="start"
          className="filter-menu"
        >
          {options
            .filter((o) => o.value !== 'all')
            .map((o) => (
              <SelectItem
                key={o.value}
                value={o.value}
                className="filter-option"
              >
                {o.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {value.length > 1 && (
        <div className="filter-selections">
          {value.map((v) => (
            <button
              key={v}
              aria-label={
                'Remove ' + (options.find((o) => o.value === v)?.label || v)
              }
              onClick={() => onChange(value.filter((x) => x !== v))}
            >
              {options.find((o) => o.value === v)?.label || v}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export default function Scout({
  view = 'explore',
  sessionId,
}: {
  view?: 'explore' | 'saved' | 'suggestions' | 'session';
  sessionId?: string;
}) {
  const [data, setData] = useState<Dataset | null>(null),
    [query, setQuery] = useState(''),
    [searchQuery, setSearchQuery] = useState(''),
    [filters, setFilters] = useState<Filters>(emptyFilters),
    [limit, setLimit] = useState(50),
    [detail, setDetail] = useState<Paper | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [offline, setOffline] = useState(false),
    [loading, setLoading] = useState(true),
    [allSession, setAllSession] = useState(false),
    [offlineReady, setOfflineReady] = useState(false),
    [recommendations, setRecommendations] = useState<RecommendationData | null>(
      null,
    ),
    [recommendationLoading, setRecommendationLoading] = useState(false),
    [recommendationError, setRecommendationError] = useState('');
  const saved = useSyncExternalStore(subscribe, getSaved, getServerSaved),
    dismissedRecommendations = useSyncExternalStore(
      subscribe,
      getDismissedRecommendations,
      getServerDismissedRecommendations,
    ),
    storageIssue = useSyncExternalStore(subscribe, getStorageIssue, () => ''),
    recommendationStorageIssue = useSyncExternalStore(
      subscribe,
      getRecommendationStorageIssue,
      () => '',
    ),
    fileInput = useRef<HTMLInputElement>(null);
  const needsRecommendations = view === 'suggestions' || detail !== null;
  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await loadConference();
      setData(result.data);
      setNotice(result.warning);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    void Promise.resolve().then(() => {
      if (new URLSearchParams(window.location.search).get('all') === '1')
        setAllSession(true);
      initializeStorage();
      void load();
      update();
    });
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    if (!data) return;
    return registerTools(
      data,
      (document as Document & { modelContext?: ModelContext }).modelContext,
    );
  }, [data]);
  useEffect(() => {
    if (
      !data ||
      !needsRecommendations ||
      recommendations?.datasetVersion === data.version
    )
      return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setRecommendationLoading(true);
      setRecommendationError('');
      setRecommendations(null);
      loadRecommendations(data)
        .then((value) => {
          if (active) setRecommendations(value);
        })
        .catch((recommendationLoadError: Error) => {
          if (active) {
            setRecommendations(null);
            setRecommendationError(recommendationLoadError.message);
          }
        })
        .finally(() => {
          if (active) setRecommendationLoading(false);
        });
    });
    return () => {
      active = false;
    };
  }, [data, needsRecommendations, recommendations?.datasetVersion]);
  useEffect(() => {
    if (
      !(process.env.NODE_ENV === 'production') ||
      !('serviceWorker' in navigator)
    )
      return;
    let active = true;
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (active) setOfflineReady(true);
      })
      .catch(() => {
        if (active)
          setNotice(
            'Offline setup failed. Browsing and saving still work while connected.',
          );
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  const search = useMemo(() => (data ? createSearch(data) : null), [data]);
  const rows = useMemo(
    () =>
      search?.(
        searchQuery,
        view === 'session' && sessionId
          ? { ...filters, session: [sessionId] }
          : filters,
      ) || [],
    [search, searchQuery, filters, view, sessionId],
  );
  const byPaper = useMemo(() => {
    const map = new Map<string, Dataset['presentations']>();
    data?.presentations.forEach((p) =>
      map.set(p.paperId, [...(map.get(p.paperId) || []), p]),
    );
    return map;
  }, [data]);
  const sessions = useMemo(
    () => new Map(data?.sessions.map((s) => [s.id, s]) || []),
    [data],
  );
  const session = sessionId ? sessions.get(sessionId) : undefined;
  const grouped = useMemo(
    () => (data ? groupSaved(data, saved) : null),
    [data, saved],
  );
  const papersById = useMemo(
    () => new Map(data?.papers.map((paper) => [paper.id, paper]) || []),
    [data],
  );
  const personalizedSuggestions = useMemo(
    () =>
      data && recommendations
        ? rankPersonalizedSuggestions(
            data,
            recommendations,
            saved,
            dismissedRecommendations,
            8,
          )
        : [],
    [data, recommendations, saved, dismissedRecommendations],
  );
  const detailSimilar = useMemo(
    () =>
      data && recommendations && detail
        ? similarPapers(data, recommendations, detail.id, 5)
        : [],
    [data, recommendations, detail],
  );
  const sessionRows = useMemo(
    () =>
      data && sessionId
        ? sortPosters(
            rows.filter((p) =>
              (byPaper.get(p.id) || []).some((x) => x.sessionId === sessionId),
            ),
            data.presentations,
            sessionId,
          )
        : [],
    [data, sessionId, rows, byPaper],
  );
  const visibleRows =
    view === 'session'
      ? sessionRows.filter((p) => allSession || saved.includes(p.id))
      : rows;
  function reset() {
    setQuery('');
    setSearchQuery('');
    setFilters(emptyFilters);
    setLimit(50);
  }
  function changeFilter(key: keyof Filters, v: string[]) {
    setFilters((f) => ({ ...f, [key]: v }));
    setLimit(50);
  }
  function saveButton(p: Paper) {
    const isSaved = saved.includes(p.id);
    return (
      <button
        className={'save ' + (isSaved ? 'selected' : '')}
        aria-label={`${isSaved ? 'Remove saved paper' : 'Save paper'}: ${p.title}`}
        aria-pressed={isSaved}
        onClick={() => setBookmark(p.id, !isSaved)}
      >
        <Bookmark size={18} fill={isSaved ? 'currentColor' : 'none'} />
        <span>{isSaved ? 'Saved' : 'Save'}</span>
      </button>
    );
  }
  function paperActions(p: Paper) {
    return (
      <div className="paper-actions">
        {saveButton(p)}
        {p.paperUrl?.startsWith('https://arxiv.org/abs/') && (
          <a
            className="arxiv-button"
            href={p.paperUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Read ${p.title} on arXiv (opens in a new tab)`}
          >
            arXiv <ArrowUpRight size={15} />
          </a>
        )}
      </div>
    );
  }
  function card(p: Paper, inSession?: Session) {
    const all = byPaper.get(p.id) || [];
    const appearance =
      (inSession
        ? all.find((x) => x.sessionId === inSession.id)
        : all.find((x) => x.type === 'poster')) || all[0];
    const s = appearance?.sessionId
      ? sessions.get(appearance.sessionId)
      : undefined;
    return (
      <article className="paper" key={p.id}>
        {appearance?.posterNumber && (
          <div className="poster-number">
            <span>POSTER</span>
            <b>{appearance.posterNumber}</b>
          </div>
        )}
        <div className="paperbody">
          <div className="topic">
            {p.topics[0] || 'ECCV 2026'}
            {all.some((x) => x.type === 'oral') && (
              <span className="badge">ORAL</span>
            )}
          </div>
          <h2>
            <button onClick={() => setDetail(p)}>{p.title}</button>
          </h2>
          <p className="authors">
            {p.authors.length ? p.authors.join(', ') : 'Authors not available'}
          </p>
          <div className="paper-meta">
            {s ? (
              <>
                <a href={'/session/' + s.id}>
                  <Clock size={14} />
                  {dayLabel(s.startsAt)} · {timeLabel(s)}
                </a>
                <span>
                  <MapPin size={14} />
                  {appearance.room || s.room || 'Room not available'}
                </span>
                <span>{s.name}</span>
              </>
            ) : (
              <span>Schedule not available</span>
            )}
          </div>
        </div>
        {paperActions(p)}
      </article>
    );
  }
  function suggestionCard(suggestion: PersonalizedSuggestion) {
    const contributorTitles = suggestion.contributingSavedPaperIds
      .map((paperId) => papersById.get(paperId)?.title)
      .filter((title): title is string => Boolean(title));
    return (
      <article className="suggestion" key={suggestion.paper.id}>
        <div className="suggestion-body">
          <div className="topic">
            {suggestion.paper.topics[0] || 'ECCV 2026'}
          </div>
          <h3>
            <button onClick={() => setDetail(suggestion.paper)}>
              {suggestion.paper.title}
            </button>
          </h3>
          <p>
            Similar to{' '}
            {contributorTitles.length
              ? contributorTitles.slice(0, 2).join(' and ')
              : 'your saved papers'}
            .
          </p>
        </div>
        <div className="suggestion-actions">
          {saveButton(suggestion.paper)}
          <button
            className="dismiss-suggestion"
            aria-label={`Dismiss suggestion: ${suggestion.paper.title}`}
            onClick={() => dismissRecommendation(suggestion.paper.id)}
          >
            <X size={16} />
            <span>Not for me</span>
          </button>
        </div>
      </article>
    );
  }
  function empty(title: string, description: string) {
    return (
      <Empty className="empty-panel">
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  function exportSaved() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(profile(saved), null, 2)], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'eccv-scout-profile.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      'Profile exported. Import this file on your other device to merge your saved papers.',
    );
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw Error('Profile file is too large.');
      const before = getSaved().length;
      const next = importProfile(JSON.parse(await file.text()));
      setNotice(`Imported ${next.length - before} new saved papers.`);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  const days = data
    ? [
        ...new Set(
          data.sessions.map((s) => dayKey(s.startsAt)).filter(Boolean),
        ),
      ].sort()
    : [];
  const topics = data
    ? [
        ...new Set(
          data.papers
            .filter(
              (p) =>
                view !== 'session' ||
                (byPaper.get(p.id) || []).some(
                  (x) => x.sessionId === sessionId,
                ),
            )
            .flatMap((p) => p.topics),
        ),
      ].sort()
    : [];
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to papers
      </a>
      <header className="topbar">
        <a className="brand" href="/">
          <PackageOpen size={32} strokeWidth={1.7} />
          <span>
            Scholar <b>Draftbox</b>
          </span>
        </a>
        <span className="edition">ECCV 2026 EDITION</span>
        <nav aria-label="Main navigation">
          <a
            className={view === 'explore' ? 'active' : ''}
            aria-current={view === 'explore' ? 'page' : undefined}
            href="/"
          >
            Explore
          </a>
          <a
            className={view === 'suggestions' ? 'active' : ''}
            aria-current={view === 'suggestions' ? 'page' : undefined}
            href="/suggestions"
          >
            Suggestions
          </a>
          <a
            className={view === 'saved' ? 'active' : ''}
            aria-current={view === 'saved' ? 'page' : undefined}
            href="/saved"
          >
            Saved <span>{saved.length}</span>
          </a>
        </nav>
      </header>
      <main id="main" className="workspace">
        {view === 'session' && (
          <a className="back" href="/saved">
            <ArrowLeft size={16} /> My saved papers
          </a>
        )}
        {view !== 'explore' && (
          <div className="eyebrow">
            {view === 'saved'
              ? 'YOUR PERSONAL SHORTLIST'
              : view === 'suggestions'
                ? 'PICKED FROM YOUR INTERESTS'
                : 'IN THE POSTER HALL'}
          </div>
        )}
        <div className="heading-row">
          <div>
            <h1>
              {view === 'saved'
                ? 'Your very good pile.'
                : view === 'suggestions'
                  ? 'A few papers escaped your pile.'
                  : view === 'session'
                    ? session?.name ||
                      (loading ? 'Loading session…' : 'Session not found')
                    : 'We have Scholar Inbox at home.'}
            </h1>
            <p className="intro">
              {view === 'saved'
                ? 'Your saved papers, arranged around the conference.'
                : view === 'suggestions'
                  ? 'Private, on-device suggestions based on the papers you saved.'
                  : view === 'session' && session
                    ? `${dayLabel(session.startsAt)} · ${timeLabel(session)} · ${session.room || 'Room not available'}`
                    : 'Browse ECCV 2026, save your favourites, and find their posters.'}
            </p>
          </div>
          <div className="transfer">
            <BookmarkTransfer
              data={data}
              saved={saved}
              showSend={view === 'saved'}
              exportSaved={exportSaved}
            />
            {view === 'saved' && (
              <>
                <Button variant="outline" onClick={exportSaved}>
                  <Download size={16} />
                  Export
                </Button>
                <Button
                  variant="outline"
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={16} />
                  Import
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  aria-label="Import saved papers"
                  onChange={(e) => void importFile(e.target.files?.[0])}
                />
              </>
            )}
          </div>
        </div>
        {offline && (
          <output className="notice">
            <WifiOff size={16} /> You’re offline.{' '}
            {data
              ? 'Showing your downloaded conference data.'
              : 'Connect once to download the conference.'}
          </output>
        )}
        {storageIssue && (
          <p className="notice" role="alert">
            {storageIssue}
          </p>
        )}
        {recommendationStorageIssue && (
          <p className="notice" role="alert">
            {recommendationStorageIssue}
          </p>
        )}
        {notice && (
          <output className="notice">
            {notice}
            <button
              className="dismiss"
              aria-label="Dismiss notice"
              onClick={() => setNotice('')}
            >
              ×
            </button>
          </output>
        )}
        {error && (
          <p className="notice" role="alert">
            {error}
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </p>
        )}
        <div className={view === 'explore' ? 'browse-layout' : ''}>
          {(view === 'explore' || view === 'session') && (
            <>
              <label className="searchbox">
                <Search />
                <input
                  aria-label="Search papers"
                  placeholder="Search titles, authors, or research topics…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setLimit(50);
                  }}
                />
                <span>
                  {query !== searchQuery ? 'Searching…' : 'Keyword search'}
                </span>
              </label>
              {data && (
                <div
                  className={
                    view === 'session' ? 'filters session-filters' : 'filters'
                  }
                >
                  <div className="filter-heading">
                    <h2>
                      {view === 'session'
                        ? 'Filter this session'
                        : 'Filter the pile'}
                    </h2>
                    <button className="reset" onClick={reset}>
                      Reset all
                    </button>
                  </div>
                  {view === 'explore' && (
                    <>
                      <Filter
                        label="Day"
                        value={filters.day}
                        onChange={(v) => changeFilter('day', v)}
                        options={[
                          { value: 'all', label: 'All days' },
                          ...days.map((d) => ({
                            value: d,
                            label: dayLabel(d + 'T12:00:00+02:00'),
                          })),
                        ]}
                      />
                      <Filter
                        label="Session"
                        value={filters.session}
                        onChange={(v) => changeFilter('session', v)}
                        options={[
                          { value: 'all', label: 'All sessions' },
                          ...data.sessions
                            .filter((s) =>
                              data.presentations.some(
                                (p) => p.sessionId === s.id,
                              ),
                            )
                            .map((s) => ({ value: s.id, label: s.name })),
                        ]}
                      />
                      <Filter
                        label="Presentation type"
                        value={filters.type}
                        onChange={(v) => changeFilter('type', v)}
                        options={[
                          { value: 'all', label: 'All presentations' },
                          ...['poster', 'oral', 'spotlight'].map((t) => ({
                            value: t,
                            label: t[0].toUpperCase() + t.slice(1),
                          })),
                        ]}
                      />
                    </>
                  )}
                  <Filter
                    label="Topic"
                    value={filters.topic}
                    onChange={(v) => changeFilter('topic', v)}
                    options={[
                      { value: 'all', label: 'All topics' },
                      ...topics.map((t) => ({ value: t, label: t })),
                    ]}
                  />
                  <p className="filter-footnote">
                    Choose multiple options to include any of them. Different
                    filter groups narrow the results together.
                  </p>
                </div>
              )}
            </>
          )}
          {loading && !data && (
            <output className="loading" aria-label="Loading papers">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28 w-full rounded-lg" />
              ))}
            </output>
          )}
          {view === 'saved' && data && grouped && (
            <>
              <div className="resultbar">
                <b>
                  {saved.length} saved {saved.length === 1 ? 'paper' : 'papers'}
                </b>
                <span>BOOKMARKS, NOT ATTENDANCE COMMITMENTS</span>
              </div>
              <Tabs defaultValue="schedule" className="saved-views">
                <TabsList
                  aria-label="Saved paper view"
                  className="saved-view-toggle"
                >
                  <TabsTrigger value="schedule">Schedule</TabsTrigger>
                  <TabsTrigger value="papers">Paper list</TabsTrigger>
                </TabsList>
                <TabsContent value="schedule">
                  <SavedSchedule data={data} saved={saved} />
                  {(grouped.unscheduled.length > 0 ||
                    grouped.unknown.length > 0) && (
                    <p className="schedule-help">
                      Some saved papers have no schedule information. You can
                      find them in Paper list.
                    </p>
                  )}
                </TabsContent>
                <TabsContent value="papers">
                  {saved.length === 0 &&
                    empty(
                      'Start your shortlist',
                      'Save papers in Explore. Their sessions and poster locations will appear here.',
                    )}{' '}
                  {grouped.groups.map((g, i) => (
                    <section className="saved-group" key={g.session.id}>
                      {(!i ||
                        dayKey(grouped.groups[i - 1].session.startsAt) !==
                          dayKey(g.session.startsAt)) && (
                        <h2 className="day-title">
                          {dayLabel(g.session.startsAt)}
                        </h2>
                      )}
                      <a
                        className="session-heading"
                        href={'/session/' + g.session.id}
                      >
                        <div>
                          <b>{g.session.name}</b>
                          <span>
                            {timeLabel(g.session)} ·{' '}
                            {g.session.room || 'Room not available'} ·{' '}
                            {g.papers.length} saved
                          </span>
                        </div>
                        <ChevronRight size={20} />
                      </a>
                      <div className="paperlist">
                        {sortPosters(
                          g.papers,
                          data.presentations,
                          g.session.id,
                        ).map((p) => card(p, g.session))}
                      </div>
                    </section>
                  ))}
                  {grouped.unscheduled.length > 0 && (
                    <section>
                      <h2 className="day-title">Schedule not available</h2>
                      {grouped.unscheduled.map((p) => card(p))}
                    </section>
                  )}
                  {grouped.unknown.length > 0 && (
                    <section>
                      <h2 className="day-title">Unavailable papers</h2>
                      <p className="intro">
                        These bookmarks were preserved but are not in this
                        dataset.
                      </p>
                      {grouped.unknown.map((id) => (
                        <div className="unknown" key={id}>
                          <span>{id}</span>
                          <Button
                            variant="outline"
                            onClick={() => setBookmark(id, false)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </section>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
          {view === 'suggestions' && data && (
            <section
              className="personalized-suggestions suggestions-page"
              aria-label="Personalized paper suggestions"
            >
              {saved.length === 0 ? (
                empty(
                  'Save a few papers first',
                  'Suggestions learn from your shortlist without sending it anywhere. Find papers in Explore, then come back here.',
                )
              ) : (
                <>
                  <div className="suggestions-heading">
                    <div>
                      <div className="eyebrow">
                        <Sparkles size={14} /> YOU MAY ALSO LIKE
                      </div>
                      <h2>
                        Following {saved.length}{' '}
                        {saved.length === 1 ? 'saved paper' : 'saved papers'}
                      </h2>
                      <p>
                        Separate interests are mixed fairly. Already saved and
                        dismissed papers stay out of the list.
                      </p>
                    </div>
                    {dismissedRecommendations.length > 0 && (
                      <button onClick={clearDismissedRecommendations}>
                        Show dismissed again
                      </button>
                    )}
                  </div>
                  {recommendationLoading && (
                    <output className="recommendation-status">
                      Finding related papers…
                    </output>
                  )}
                  {recommendationError && !recommendationLoading && (
                    <output className="recommendation-status">
                      {recommendationError}
                    </output>
                  )}
                  {!recommendationLoading &&
                    !recommendationError &&
                    personalizedSuggestions.length === 0 && (
                      <p className="recommendation-status">
                        No more suggestions right now. Dismissed papers stay
                        hidden only on this device.
                      </p>
                    )}
                  {personalizedSuggestions.length > 0 && (
                    <div className="suggestion-list">
                      {personalizedSuggestions.map(suggestionCard)}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          {(view === 'explore' || view === 'session') && data && (
            <>
              {view === 'session' && session && (
                <div className="session-switch">
                  <span>
                    {sessionRows.filter((p) => saved.includes(p.id)).length}{' '}
                    {searchQuery.trim() || filters.topic.length
                      ? 'matching saved papers'
                      : 'saved in this session'}
                  </span>
                  <label htmlFor="include-unsaved">
                    <Switch
                      id="include-unsaved"
                      checked={allSession}
                      onCheckedChange={(checked) => {
                        setAllSession(checked);
                        setLimit(50);
                      }}
                    />{' '}
                    Include unsaved papers
                  </label>
                </div>
              )}
              <div className="resultbar" aria-live="polite">
                <b>
                  {visibleRows.length.toLocaleString()}{' '}
                  {visibleRows.length === 1 ? 'paper' : 'papers'}
                </b>
                <span>
                  {view === 'session'
                    ? 'SORTED BY POSTER NUMBER'
                    : 'MAIN CONFERENCE · 10–12 SEPTEMBER'}
                </span>
              </div>
              <div className="paperlist">
                {visibleRows.slice(0, limit).map((p) => card(p, session))}
              </div>
              {!visibleRows.length &&
                empty(
                  view === 'session' && !allSession
                    ? 'No saved papers in this session'
                    : 'No papers found',
                  view === 'session' && !allSession
                    ? 'Browse all session papers to build your shortlist.'
                    : 'Try a different query or reset your filters.',
                )}
              {visibleRows.length > limit && (
                <Button
                  className="load-more"
                  variant="outline"
                  onClick={() => setLimit((n) => n + 50)}
                >
                  Show 50 more · {Math.min(limit, visibleRows.length)} of{' '}
                  {visibleRows.length}
                </Button>
              )}
            </>
          )}
        </div>
        {data && (
          <div className="data-status">
            <span>
              {offlineReady ? (
                <>
                  <Check size={14} /> Ready for offline use
                </>
              ) : (
                'Device-local bookmarks'
              )}
            </span>
            <span>
              Source snapshot{' '}
              {new Intl.DateTimeFormat('en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Europe/Stockholm',
              }).format(new Date(data.retrievedAt))}{' '}
              CEST
            </span>
            <button onClick={() => void load()} disabled={loading || offline}>
              {loading ? 'Refreshing…' : 'Refresh data'}
            </button>
          </div>
        )}
      </main>
      <footer>
        <p className="footer-brand">
          Scholar Draftbox <span>— definitely the one we have at home.</span>
        </p>
        <p>
          An unofficial community project. Not affiliated with Scholar Inbox,
          ECCV, or ECVA.
        </p>
        <p>
          Saved papers stay in this browser. No accounts or tracking. All
          session times are Malmö time (Europe/Stockholm).
        </p>
        <p className="footer-community">
          Open source, questionable branding.{' '}
          <a
            href="https://github.com/bertaveira/scholar-draftbox"
            target="_blank"
            rel="noreferrer"
          >
            Code on GitHub
          </a>{' '}
          — contributions welcome.
        </p>
        <p className="footer-community">
          Complaints department:{' '}
          <a href="https://x.com/Bertaveira" target="_blank" rel="noreferrer">
            me on Twitter/X
          </a>
          . Management:{' '}
          <a
            href="https://bertaveira.github.io/"
            target="_blank"
            rel="noreferrer"
            aria-label="My personal website"
          >
            also me
          </a>
          .
        </p>
        <div>
          <a
            href="https://eccv.ecva.net/Conferences/2026/AcceptedPapers"
            target="_blank"
            rel="noreferrer"
          >
            Official paper list <ArrowUpRight size={12} />
          </a>
          <a
            href="https://eccv.ecva.net/virtual/2026/calendar"
            target="_blank"
            rel="noreferrer"
          >
            Official schedule <ArrowUpRight size={12} />
          </a>
        </div>
      </footer>
      <Sheet
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <SheetContent
          className="detail-panel"
          aria-describedby="paper-description"
        >
          <SheetHeader>
            <div className="eyebrow">PAPER DETAILS</div>
            <SheetTitle className="detail-title">{detail?.title}</SheetTitle>
            <SheetDescription id="paper-description">
              {detail?.authors.join(', ') || 'Authors not available'}
            </SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="detail-body">
              {paperActions(detail)}
              <div className="detail-topics">
                {detail.topics.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <h3>Abstract</h3>
              <p className="abstract">
                {detail.abstract ||
                  'No abstract is available yet. Check the official paper page for updates.'}
              </p>
              {detail.abstract && detail.abstractSource && (
                <a
                  className="abstract-source"
                  href={detail.abstractSource.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abstract from arXiv
                  {detail.abstractSource.version
                    ? ` · v${detail.abstractSource.version}`
                    : ''}
                  <ArrowUpRight size={14} />
                </a>
              )}
              <h3>Similar papers</h3>
              {recommendationLoading && (
                <p className="recommendation-status">Finding related papers…</p>
              )}
              {recommendationError && !recommendationLoading && (
                <p className="recommendation-status">
                  Similar papers unavailable.
                </p>
              )}
              {detailSimilar.length > 0 && (
                <div className="detail-similar">
                  {detailSimilar.map(({ paper }) => (
                    <button key={paper.id} onClick={() => setDetail(paper)}>
                      <b>{paper.title}</b>
                      <span>{paper.topics[0] || 'ECCV 2026'}</span>
                    </button>
                  ))}
                </div>
              )}
              <h3>At the conference</h3>
              {(byPaper.get(detail.id) || []).map((p) => {
                const s = p.sessionId ? sessions.get(p.sessionId) : undefined;
                return (
                  <div className="appearance" key={p.id}>
                    <b>
                      {p.type === 'poster'
                        ? `Poster ${p.posterNumber ? '#' + p.posterNumber : ''}`
                        : p.type[0].toUpperCase() + p.type.slice(1)}
                    </b>
                    {s ? (
                      <>
                        <a
                          href={'/session/' + s.id}
                          onClick={() => setDetail(null)}
                        >
                          {s.name} <ChevronRight size={14} />
                        </a>
                        <span>
                          {dayLabel(s.startsAt)} · {timeLabel(s)}
                        </span>
                        <span>{p.room || s.room || 'Room not available'}</span>
                      </>
                    ) : (
                      <span>Schedule not available</span>
                    )}
                  </div>
                );
              })}
              <a
                className="official-link"
                href={detail.officialUrl}
                target="_blank"
                rel="noreferrer"
              >
                Official paper page <ArrowUpRight size={16} />
              </a>
              {detail.paperUrl &&
                !detail.paperUrl.startsWith('https://arxiv.org/abs/') && (
                  <a
                    className="official-link"
                    href={detail.paperUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read paper <ArrowUpRight size={16} />
                  </a>
                )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
