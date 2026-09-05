import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
mkdirSync('.test-output', { recursive: true });
for (const name of ['conference', 'storage', 'webmcp', 'loader', 'transfer']) {
  const source = readFileSync(`lib/${name}.ts`, 'utf8');
  const js = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replace(/from ['"](.\/[^'"]+)['"]/g, "from '$1.js'");
  writeFileSync(`.test-output/${name}.js`, js);
}
const {
  validateDataset,
  createSearch,
  emptyFilters,
  parseProfile,
  profile,
  dayKey,
  groupSaved,
  sortPosters,
  posterSchedule,
  conferenceSchedule,
  layoutSchedule,
} = await import('../.test-output/conference.js');
const data = JSON.parse(readFileSync('public/data/conference.json', 'utf8'));
const store = new Map();
const callbacks = new Map();
globalThis.window = { addEventListener: (name, fn) => callbacks.set(name, fn) };
globalThis.localStorage = {
  getItem: (key) => store.get(key) || null,
  setItem: (key, value) => store.set(key, value),
};
const storage = await import('../.test-output/storage.js');
const { createTools, registerTools } =
  await import('../.test-output/webmcp.js');
void test('real dataset validates with complete poster assignments and repeat presentations', () => {
  validateDataset(data);
  assert.ok(data.papers.length > 2500);
  assert.equal(
    data.presentations.filter((p) => p.type === 'poster').length,
    data.papers.length,
  );
  assert.ok(data.presentations.some((p) => p.type === 'oral'));
  assert.ok(data.presentations.some((p) => p.type === 'spotlight'));
  assert.ok(data.presentations.every((p) => p.sessionId));
});
void test('keyword search handles exact titles, accents, authors and acronyms', () => {
  const search = createSearch(data);
  const p = data.papers.find((p) => p.officialId === '4419');
  assert.equal(search(p.title)[0].id, p.id);
  assert.ok(search('Clementine Grethen').some((x) => x.id === p.id));
  assert.ok(search('SLAM').some((p) => p.title.includes('SLAM')));
  assert.ok(search('VLA').length > 0);
});
void test('combined filters must match the same presentation', () => {
  const p = data.presentations.find((p) => p.type === 'oral');
  const session = data.sessions.find((s) => s.id === p.sessionId);
  const search = createSearch(data);
  const rows = search('', {
    ...emptyFilters,
    type: ['oral'],
    session: [session.id],
    day: [dayKey(session.startsAt)],
  });
  assert.ok(rows.some((x) => x.id === p.paperId));
  assert.equal(
    search('', { ...emptyFilters, type: ['poster'], session: [session.id] })
      .length,
    0,
  );
  const topic = rows[0].topics[0];
  assert.ok(
    search('', { ...emptyFilters, type: ['oral'], topic: [topic] }).every((p) =>
      p.topics.includes(topic),
    ),
  );
});
void test('Stockholm day differs from UTC where appropriate', () =>
  assert.equal(dayKey('2026-09-09T23:30:00Z'), '2026-09-10'));
void test('saving once appears in oral and poster groups, unknowns survive', () => {
  const p = data.presentations.find((p) => p.type === 'oral');
  const g = groupSaved(data, [p.paperId, 'eccv-2026-999999']);
  assert.ok(g.groups.length >= 2);
  assert.deepEqual(g.unknown, ['eccv-2026-999999']);
  const modified = structuredClone(data);
  modified.presentations = modified.presentations.filter(
    (x) => x.paperId !== p.paperId,
  );
  assert.equal(groupSaved(modified, [p.paperId]).unscheduled[0].id, p.paperId);
});
void test('posters sort numerically, missing poster numbers sort last', () => {
  const papers = data.papers.slice(0, 3);
  const pres = papers.map((p, i) => ({
    paperId: p.id,
    sessionId: 'x',
    posterNumber: ['10', '2', null][i],
  }));
  assert.deepEqual(
    sortPosters(papers, pres, 'x').map((x) => x.id),
    [papers[1].id, papers[0].id, papers[2].id],
  );
});
void test('invalid profiles are rejected; imports merge without duplicates', () => {
  storage.initializeStorage();
  const id = data.papers[0].id;
  storage.setBookmark(id, true);
  storage.importProfile(profile([id, 'eccv-2026-999999']));
  assert.deepEqual(storage.getSaved(), [id, 'eccv-2026-999999']);
  assert.deepEqual(
    parseProfile(JSON.parse(store.get('eccv-scout.profile.v1'))),
    storage.getSaved(),
  );
  const before = storage.getSaved();
  assert.throws(() =>
    storage.importProfile({ schemaVersion: 9, savedPaperIds: [] }),
  );
  assert.equal(storage.getSaved(), before);
  assert.throws(() => parseProfile(profile(['<script>'])));
});
void test('cross-tab updates and storage failure preserve usable in-memory state', () => {
  const id = data.papers[1].id;
  localStorage.setItem('eccv-scout.profile.v1', JSON.stringify(profile([id])));
  callbacks.get('storage')({ key: 'eccv-scout.profile.v1' });
  assert.deepEqual(storage.getSaved(), [id]);
  const original = localStorage.setItem.bind(localStorage);
  localStorage.setItem = () => {
    throw Error('quota');
  };
  storage.setBookmark(data.papers[2].id, true);
  assert.ok(storage.getStorageIssue());
  assert.equal(storage.getSaved().length, 2);
  localStorage.setItem = original;
});
void test('malformed datasets reject duplicate IDs, broken refs and reversed times', () => {
  for (const mutate of [
    (d) => d.papers.push(d.papers[0]),
    (d) => (d.presentations[0].paperId = 'missing'),
    (d) => (d.sessions[0].endsAt = d.sessions[0].startsAt),
    (d) => (d.papers[0].officialUrl = 'javascript:alert(1)'),
  ]) {
    const d = structuredClone(data);
    mutate(d);
    assert.throws(() => validateDataset(d));
  }
});
void test('WebMCP tools use shared state and reject invalid input', () => {
  const tools = createTools(data);
  assert.deepEqual(
    tools.map((t) => t.name),
    ['search_papers', 'set_paper_bookmark'],
  );
  assert.equal(tools[0].annotations.readOnlyHint, true);
  const id = data.papers[3].id;
  assert.deepEqual(tools[1].execute({ paperId: id, saved: true }), {
    paperId: id,
    saved: true,
  });
  assert.ok(storage.getSaved().includes(id));
  assert.ok(
    tools[0]
      .execute({ query: data.papers[3].title })
      .papers.some((p) => p.id === id && p.saved),
  );
  const before = storage.getSaved();
  assert.throws(() => tools[1].execute({ paperId: 'bad', saved: true }));
  assert.equal(storage.getSaved(), before);
  const registered = [];
  const unregister = registerTools(data, {
    registerTool: (tool, options) => registered.push({ tool, options }),
  });
  assert.equal(registered.length, 2);
  unregister();
  assert.ok(registered.every((x) => x.options.signal.aborted));
});
void test('loader keeps the complete prior snapshot when a refresh is invalid or offline', async () => {
  const entries = new Map([
    ['/data/conference.json', new Response(JSON.stringify(data))],
  ]);
  const cache = {
    put: async (k, v) => entries.set(k, v),
    match: async (k) => entries.get(k)?.clone(),
  };
  globalThis.caches = {
    open: async () => cache,
    match: async (k) => cache.match(k),
  };
  window.caches = caches;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ schemaVersion: 99 }));
  const { loadConference } = await import('../.test-output/loader.js');
  let result = await loadConference();
  assert.equal(result.cached, true);
  assert.equal(result.data.version, data.version);
  globalThis.fetch = async () => {
    throw Error('offline');
  };
  result = await loadConference();
  assert.equal(result.data.papers.length, data.papers.length);
  globalThis.fetch = async () => new Response(JSON.stringify(data));
  result = await loadConference();
  assert.equal(result.cached, false);
  assert.equal(
    (await entries.get('/data/conference.json').clone().json()).version,
    data.version,
  );
});

void test('poster overview includes empty sessions, counts unique saved papers, and excludes oral sessions', () => {
  const empty = posterSchedule(data, []);
  assert.equal(empty.length, 6);
  assert.ok(empty.every((s) => s.savedCount === 0 && s.total > 0));
  assert.deepEqual(
    empty.map((s) => dayKey(s.session.startsAt)),
    [
      '2026-09-10',
      '2026-09-10',
      '2026-09-11',
      '2026-09-11',
      '2026-09-12',
      '2026-09-12',
    ],
  );
  const first = data.presentations.find(
    (p) => p.type === 'poster' && p.sessionId === empty[0].session.id,
  );
  const repeated = structuredClone(data);
  repeated.presentations.push({ ...first, id: 'duplicate-appearance' });
  const result = posterSchedule(repeated, [
    first.paperId,
    first.paperId,
    'eccv-2026-999999',
  ]);
  assert.equal(result[0].savedCount, 1);
  assert.equal(result[0].total, empty[0].total);
  assert.ok(result.slice(1).every((s) => s.savedCount === 0));
  assert.equal(
    posterSchedule(data, []).reduce((sum, s) => sum + s.savedCount, 0),
    0,
  );
});

void test('schedule includes only requested event kinds while counting saved oral appearances', () => {
  const oral = data.presentations.find((p) => p.type === 'oral');
  const schedule = conferenceSchedule(data, [oral.paperId]);
  assert.ok(schedule.length < data.sessions.length);
  assert.deepEqual(new Set(schedule.map(s => s.kind)), new Set(['oral', 'spotlight', 'keynote', 'poster', 'break']));
  assert.equal(schedule.filter((s) => s.kind === 'keynote').length, 3);
  assert.ok(schedule.some((s) => s.kind === 'break'));
  assert.equal(
    schedule.find((s) => s.session.id === oral.sessionId).savedCount,
    1,
  );
  assert.ok(
    schedule
      .filter((s) => s.kind === 'keynote')
      .every((s) => s.total === 0 && s.savedCount === 0),
  );
  assert.ok(
    schedule.every(
      (s, i) =>
        i === 0 || s.session.startsAt >= schedule[i - 1].session.startsAt,
    ),
  );
});

void test('multi-select unions values, intersects groups, and preserves the opened session boundary', () => {
  const papers = data.papers.slice(0, 4).map((p, i) => ({...p, id:`eccv-2026-${i+1}`, topics:[['Vision'],['Robotics'],['Vision','Robotics'],['Language']][i]}));
  const sessions = [
    {...data.sessions[0], id:'a', startsAt:'2026-09-10T09:00:00+02:00'},
    {...data.sessions[0], id:'b', startsAt:'2026-09-11T09:00:00+02:00'},
  ];
  const presentations = [[0,'a','poster'],[1,'a','poster'],[2,'b','poster'],[2,'a','oral'],[3,'b','poster']].map(([i,sessionId,type], index) => ({...data.presentations[0],id:`p${index}`,paperId:papers[i].id,sessionId,type}));
  const search = createSearch({...data,papers,sessions,presentations});
  const ids = filters => search('', {...emptyFilters,...filters}).map(p=>p.id);
  assert.deepEqual(ids({topic:['Vision','Robotics']}), papers.slice(0,3).map(p=>p.id));
  assert.deepEqual(ids({topic:['Vision','Robotics'],day:['2026-09-10'],type:['poster']}), papers.slice(0,2).map(p=>p.id));
  assert.deepEqual(ids({topic:['Vision','Robotics'],day:['2026-09-10'],type:['poster','oral']}), papers.slice(0,3).map(p=>p.id));
  assert.deepEqual(ids({topic:['Vision','Robotics'],session:['b']}), [papers[2].id]);
  assert.equal(ids({session:['a','b'],day:['2026-09-10','2026-09-11']}).length,4);
  assert.equal(ids({topic:[]}).length,4);
});


void test('timetable separates overlaps, reuses lanes at boundaries, and handles missing times', () => {
  const base = conferenceSchedule(data, [])[0];
  const event = (id, start, end) => ({...base, session: {...base.session, id,
    startsAt: start ? `2026-09-10T${start}:00+02:00` : null,
    endsAt: end ? `2026-09-10T${end}:00+02:00` : null}});
  const result = layoutSchedule([
    event('long', '09:00', '10:30'), event('parallel', '09:00', '10:00'),
    event('third', '09:30', '10:00'), event('reuse', '10:00', '11:00'),
    event('solo', '11:00', '12:00'), event('unknown', null, null),
  ]);
  assert.equal(result.startMinute, 540);
  assert.equal(result.endMinute, 720);
  assert.deepEqual(result.untimed.map(e => e.session.id), ['unknown']);
  const byId = Object.fromEntries(result.placed.map(p => [p.entry.session.id, p]));
  assert.equal(byId.long.end - byId.long.start, 90);
  assert.equal(byId.long.lanes, 3);
  assert.equal(byId.reuse.lane, byId.parallel.lane);
  assert.equal(byId.solo.lanes, 1);
  for (const a of result.placed) for (const b of result.placed) {
    if (a !== b && a.start < b.end && b.start < a.end) assert.notEqual(a.lane, b.lane);
  }
});

void test('real conference parallel sessions occupy separate timetable lanes', () => {
  const entries = conferenceSchedule(data, []).filter(e => dayKey(e.session.startsAt) === '2026-09-10');
  const {placed} = layoutSchedule(entries);
  const morning = placed.filter(p => p.start === 540 && ['oral','spotlight'].includes(p.entry.kind));
  assert.equal(morning.length, 3);
  assert.equal(new Set(morning.map(p => p.lane)).size, 3);
  for (const a of placed) for (const b of placed) {
    if (a !== b && a.start < b.end && b.start < a.end) assert.notEqual(a.lane, b.lane);
  }
});


const {encodeTransfer, decodeTransfer, transferUrl, transferSummary} = await import('../.test-output/transfer.js');
void test('QR transfer roundtrips stable IDs including unknown bookmarks and deduplicates', () => {
  const ids = [data.papers[0].id, 'eccv-2026-999999', 'eccv-2026-00023'];
  const url = new URL(transferUrl('http://192.168.1.10:3001/?old=yes#old', [...ids, ids[0]]));
  assert.equal(url.pathname, '/saved');
  assert.equal(url.search, '');
  assert.deepEqual(decodeTransfer(url.hash), ids);
  assert.deepEqual(transferSummary(ids, [ids[0]], new Set([ids[0]])), {added:2, existing:1, unavailable:2});
  assert.equal(decodeTransfer('#unrelated'), null);
});
void test('invalid QR imports do not mutate saved state; confirmed transfers merge repeatedly', () => {
  storage.setSaved([data.papers[0].id]);
  const before = [...storage.getSaved()];
  for (const bad of ['#draftbox=2.123', '#draftbox=1.', '#draftbox=1.abc', '#draftbox=1.123..456', '#draftbox=1.' + '9'.repeat(60000)]) {
    assert.throws(() => {const ids = decodeTransfer(bad); storage.importProfile(profile(ids));});
    assert.deepEqual(storage.getSaved(), before);
  }
  const incoming = decodeTransfer(encodeTransfer([data.papers[1].id, 'eccv-2026-999999']));
  assert.deepEqual(storage.getSaved(), before); // preview does not save
  storage.importProfile(profile(incoming));
  storage.importProfile(profile(incoming));
  assert.deepEqual(storage.getSaved(), [...before, ...incoming]);
});
void test('QR generation rejects unreachable addresses, unsafe schemes, and oversized lists', async () => {
  const ids = data.papers.slice(0, 80).map(p => p.id);
  for (const address of ['http://localhost:3000', 'http://127.0.0.1', 'http://[::1]', 'http://0.0.0.0', 'javascript:alert(1)', 'https://user:pass@example.com'])
    assert.throws(() => transferUrl(address, ids));
  assert.throws(() => transferUrl('https://example.com', []));
  assert.throws(() => transferUrl('https://example.com', data.papers.map(p => p.id)));
  const QRCode = (await import('qrcode')).default;
  const qr = QRCode.create(transferUrl('https://example.com', ids), {errorCorrectionLevel:'M'});
  assert.ok(qr.modules.size > 0);
  assert.ok(qr.version <= 25);
});
