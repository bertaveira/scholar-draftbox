import { readFile } from 'node:fs/promises';
import path from 'node:path';
const worker = await readFile('dist/client/sw.js', 'utf8');
const files = JSON.parse(worker.match(/const PRECACHE=(.*);\n/)[1]);
const origin = 'http://localhost:3000';
for (let i = 0; i < files.length; i += 6) {
  await Promise.all(
    files.slice(i, i + 6).map(async (file) => {
      const response = await fetch(origin + file);
      if (!response.ok) throw Error(`${file}: ${response.status}`);
      const actual = Buffer.from(await response.arrayBuffer());
      const outputPath =
        file === '/'
          ? '/index.html'
          : path.extname(file)
            ? file
            : file + '.html';
      const expected = await readFile('dist/client' + outputPath);
      if (!actual.equals(expected)) throw Error(`Asset mismatch: ${file}`);
    }),
  );
}
for (const route of ['/', '/saved', '/session/session-6156']) {
  const page = await fetch(origin + route);
  if (
    page.status !== 200 ||
    !page.headers.get('content-type').includes('text/html')
  )
    throw Error(`Missing HTML route ${route}`);
  const html = await page.text();
  if (route === '/saved' && !/<a[^>]*aria-current="page"[^>]*href="\/saved"/.test(html))
    throw Error('Saved route did not render with Saved navigation active');
  if (route === '/' && (!html.includes('We have Scholar Inbox at home.') || html.includes('Good papers. Budget packaging.') || html.includes('budget-stamp')))
    throw Error('Explorer header regression');
  const rsc = await fetch(origin + route + '?_rsc=verification', {
    headers: { rsc: '1' },
  });
  if (
    rsc.status !== 200 ||
    !rsc.headers.get('content-type').includes('text/x-component')
  )
    throw Error(`Missing navigation payload ${route}`);
}
const sw = await fetch(origin + '/sw.js');
if (sw.status !== 200 || !sw.headers.get('content-type').includes('javascript'))
  throw Error('Service worker unavailable');
console.log(
  `Verified ${files.length} offline assets, 3 HTML routes, 3 navigation payloads, and service worker delivery.`,
);
