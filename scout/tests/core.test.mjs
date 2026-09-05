import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
mkdirSync('.test-output', { recursive: true });
for (const name of ['conference', 'storage', 'webmcp', 'loader']) {
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
test('real dataset validates with complete poster assignments and repeat presentations', () => {
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
test('keyword search handles exact titles, accents, authors and acronyms', () => {
  const search = createSearch(data);
  const p = data.papers.find((p) => p.officialId === '4419');
  assert.equal(search(p.title)[0].id, p.id);
  assert.ok(search('Clementine Grethen').some((x) => x.id === p.id));
  assert.ok(search('SLAM').some((p) => p.title.includes('SLAM')));
  assert.ok(search('VLA').length > 0);
});
test('combined filters must match the same presentation', () => {
  const p = data.presentations.find((p) => p.type === 'oral');
  const session = data.sessions.find((s) => s.id === p.sessionId);
  const search = createSearch(data);
  const rows = search('', {
    ...emptyFilters,
    type: 'oral',
    session: session.id,
    day: dayKey(session.startsAt),
  });
  assert.ok(rows.some((x) => x.id === p.paperId));
  assert.equal(
    search('', { ...emptyFilters, type: 'poster', session: session.id }).length,
    0,
  );
  const topic = rows[0].topics[0];
  assert.ok(
    search('', { ...emptyFilters, type: 'oral', topic }).every((p) =>
      p.topics.includes(topic),
    ),
  );
});
test('Stockholm day differs from UTC where appropriate', () =>
  assert.equal(dayKey('2026-09-09T23:30:00Z'), '2026-09-10'));
test('saving once appears in oral and poster groups, unknowns survive', () => {
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
test('posters sort numerically, missing poster numbers sort last', () => {
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
test('invalid profiles are rejected; imports merge without duplicates', () => {
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
test('cross-tab updates and storage failure preserve usable in-memory state', () => {
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
test('malformed datasets reject duplicate IDs, broken refs and reversed times', () => {
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
test('WebMCP tools use shared state and reject invalid input', () => {
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
test('loader keeps the complete prior snapshot when a refresh is invalid or offline', async () => {
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
