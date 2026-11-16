import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, EXIT } from '../dist/cli.js';
import { VERSION } from '../dist/index.js';
import { HOST, content, fakeFetch, hub, io, item, json, paged, problem } from './helpers.mjs';

const many = Array.from({ length: 23 }, (_, i) => item('content', `doc-${i}`));

function api(extra = {}) {
  return fakeFetch({
    'GET /': () => json({ name: 'Example IR', description: 'What Example publishes.', url: `https://${HOST}/`, apiVersion: '1.0.0', links: { openapi: `https://${HOST}/openapi.json`, documentation: `https://${HOST}/developers`, llmsTxt: `https://${HOST}/llms.txt`, search: '', hubs: '', contents: '', pages: '' } }),
    'GET /search': (url) => paged(many, url, { query: url.searchParams.get('q') }),
    'GET /hubs': (url) => paged([item('hub', 'reports')], url),
    'GET /hubs/reports': () => json(hub('reports')),
    'GET /hubs/reports/items': (url) => paged(many.slice(0, 2), url),
    'GET /pages': (url) => paged([item('page', 'home', { url: `https://${HOST}/` })], url),
    'GET /contents': (url) => paged(many, url),
    'GET /contents/doc-1': () => json(content('doc-1')),
    'GET /contents/home': () => json(content('home', { kind: 'page' })),
    'GET /contents/gated': () => json(content('gated', { access: 'email-gated', textIncluded: false, markdown: '# Gated\n\nDescription only.' })),
    'GET /contents/secret': () => problem(403, 'not_public', { body: { url: `https://${HOST}/e/secret` } }),
    'GET /contents/busy': () => problem(429, 'rate_limited', { headers: { 'retry-after': '120' } }),
    'GET /contents/broken': () => problem(500, 'internal_error'),
    ...extra,
  });
}

async function cli(argv, { env = {}, routes } = {}) {
  const { fetch, calls } = api(routes);
  const captured = io(fetch, env);
  const code = await run(argv, captured.io);
  return { code, out: captured.stdout(), err: captured.stderr(), calls };
}

test('search prints numbered results and says when there are more', async () => {
  const r = await cli(['search', 'annual', 'report', '--site', HOST, '--limit', '3']);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out, /^1\. Title of doc-0 \[pdf\]\n {3}https:\/\/docs\.example\.com\/e\/doc-0\n {3}Summary of doc-0\n {3}slug: doc-0\n\n2\./);
  assert.match(r.out, /3\. Title of doc-2/);
  assert.doesNotMatch(r.out, /doc-3/);
  assert.match(r.err, /More: raise --limit, use --all, or continue with --cursor \S+/);
  assert.equal(r.calls[0].url.searchParams.get('q'), 'annual report');
  assert.equal(r.calls[0].url.searchParams.get('limit'), '3');
});

test('--json prints the items and where to continue', async () => {
  const r = await cli(['search', 'x', '--site', HOST, '--json', '--limit', '2', '--kind', 'content']);
  const body = JSON.parse(r.out);
  assert.equal(body.query, 'x');
  assert.deepEqual(body.data.map((i) => i.slug), ['doc-0', 'doc-1']);
  assert.equal(body.pagination.hasMore, true);
  const next = await cli(['search', 'x', '--site', HOST, '--json', '--limit', '2', '--cursor', body.pagination.nextCursor]);
  assert.deepEqual(JSON.parse(next.out).data.map((i) => i.slug), ['doc-2', 'doc-3']);
  assert.equal(r.calls[0].url.searchParams.get('kind'), 'content');
  assert.equal(r.err, '');
});

test('--all follows every page; --limit above 50 spans pages exactly', async () => {
  const all = await cli(['contents', '--site', HOST, '--all', '--json']);
  assert.equal(JSON.parse(all.out).data.length, 23);
  assert.equal(JSON.parse(all.out).pagination.hasMore, false);
  const some = await cli(['contents', '--site', HOST, '--limit', '22', '--json']);
  assert.equal(JSON.parse(some.out).data.length, 22);
  assert.equal(JSON.parse(some.out).pagination.hasMore, true);
});

test('get prints the Markdown; --json the whole object', async () => {
  const r = await cli(['get', 'doc-1', '--site', HOST]);
  assert.equal(r.code, EXIT.OK);
  assert.equal(r.out, '# Title of doc-1\n\nText of doc-1.\n');
  const j = await cli(['get', 'doc-1', '--site', HOST, '--json']);
  assert.equal(JSON.parse(j.out).slug, 'doc-1');
});

test('get takes the site from a full URL', async () => {
  const r = await cli(['get', `https://${HOST}/e/doc-1`]);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out, /Text of doc-1/);
  const home = await cli(['get', `https://${HOST}/`]);
  assert.match(home.out, /Text of home/);
});

test('get on a gated page prints the description and says why', async () => {
  const r = await cli(['get', 'gated', '--site', HOST]);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out, /Description only/);
  assert.match(r.err, /email-gated .* https:\/\/docs\.example\.com\/e\/gated/);
});

test('hub and get on a hub list its items', async () => {
  const r = await cli(['hub', `https://${HOST}/hub/reports`]);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out, /^Title of reports \[hub, 2 items\]\nhttps:\/\/docs\.example\.com\/hub\/reports\n\nAbout reports\n\n1\. Title of doc-0/);
  const j = await cli(['get', 'reports', '--site', HOST, '--json'], { routes: { 'GET /contents/reports': () => problem(404, 'not_found') } });
  const body = JSON.parse(j.out);
  assert.equal(body.hub.slug, 'reports');
  assert.equal(body.data.length, 2);
});

test('site, hubs and pages', async () => {
  const site = await cli(['site', '--site', HOST]);
  assert.match(site.out, /^Example IR\nhttps:\/\/docs\.example\.com\/\n\nWhat Example publishes\.\n\nAPI: +https:\/\/docs\.example\.com\/api\/site\/v1 \(v1\.0\.0\)/);
  assert.match(site.out, /MCP server: +https:\/\/docs\.example\.com\/mcp {2}\(or: npx -y relayto-mcp --site docs\.example\.com\)/);
  assert.match((await cli(['hubs', '--site', HOST])).out, /1\. Title of reports \[hub\]/);
  assert.match((await cli(['pages', '--site', HOST])).out, /1\. Title of home \[page\]/);
});

test('RELAYTO_SITE is the default site; --sandbox switches the base URL', async () => {
  const r = await cli(['hubs', '--sandbox'], { env: { RELAYTO_SITE: HOST } });
  assert.equal(r.code, EXIT.OK);
  assert.equal(r.calls[0].url.pathname, '/api/site/sandbox/v1/hubs');
});

test('export prints each document and skips what is not public', async () => {
  const job = { id: 'e.' + 'x'.repeat(43), status: 'accepted', statusUrl: '', request: { contents: ['doc-1', 'secret'] }, itemCount: null, items: null, error: null };
  const routes = {
    'POST /exports': () => new Response(JSON.stringify(job), { status: 202, headers: { 'content-type': 'application/json' } }),
    [`GET /exports/${job.id}`]: () =>
      json({ ...job, status: 'completed', itemCount: 2, items: [
        { slug: 'doc-1', status: 'ok', kind: 'content', title: 'D', access: 'open', apiUrl: '', markdown: '# D1' },
        { slug: 'secret', status: 'not_public', kind: null, title: null, access: null, apiUrl: null, markdown: null },
      ] }),
  };
  const r = await cli(['export', 'doc-1', 'secret', '--site', HOST], { routes });
  assert.equal(r.code, EXIT.OK);
  assert.equal(r.out, '# D1\n');
  assert.match(r.err, /Skipped secret: not public/);
  assert.deepEqual(r.calls[0].body, { contents: ['doc-1', 'secret'] });
  const h = await cli(['export', '--hub', 'reports', '--site', HOST, '--json'], { routes });
  assert.deepEqual(h.calls[0].body, { hub: 'reports' });
  assert.equal(JSON.parse(h.out).status, 'completed');
});

test('exit codes', async () => {
  assert.equal((await cli(['get', 'nope', '--site', HOST])).code, EXIT.NOT_FOUND);
  const secret = await cli(['get', 'secret', '--site', HOST]);
  assert.equal(secret.code, EXIT.NOT_PUBLIC);
  assert.match(secret.err, /Open it in a browser: https:\/\/docs\.example\.com\/e\/secret/);
  const busy = await cli(['get', 'busy', '--site', HOST]);
  assert.equal(busy.code, EXIT.RATE_LIMITED);
  assert.match(busy.err, /Try again in 120 s/);
  assert.equal((await cli(['get', 'broken', '--site', HOST])).code, EXIT.ERROR);
  const offline = io(async () => {
    throw new TypeError('fetch failed');
  });
  assert.equal(await run(['hubs', '--site', HOST], offline.io), EXIT.ERROR);
  assert.match(offline.stderr(), /Could not reach/);
});

test('usage errors exit 2 and make no request', async () => {
  for (const argv of [
    [],
    ['hubs'],
    ['frobnicate', '--site', HOST],
    ['hubs', '--site', 'http://docs.example.com'],
    ['hubs', '--site', 'docs.example.com/path'],
    ['hubs', '--site', HOST, '--limit', '0'],
    ['hubs', '--site', HOST, '--limit', '5', '--all'],
    ['hubs', '--site', HOST, '--bogus'],
    ['hubs', 'extra', '--site', HOST],
    ['search', '--site', HOST],
    ['search', 'x', '--kind', 'video', '--site', HOST],
    ['get', '--site', HOST],
    ['get', 'http://docs.example.com/e/x'],
    ['get', `https://other.example.com/e/x`, '--site', HOST],
    ['export', '--site', HOST],
    ['export', 'a', '--hub', 'h', '--site', HOST],
    ['export', ...Array.from({ length: 11 }, (_, i) => `s${i}`), '--site', HOST],
  ]) {
    const r = await cli(argv);
    assert.equal(r.code, EXIT.USAGE, argv.join(' '));
    if (argv.length && !argv.includes('https://other.example.com/e/x')) assert.equal(r.calls.length, 0, argv.join(' '));
  }
});

test('--json errors are JSON on stderr', async () => {
  const r = await cli(['get', 'secret', '--site', HOST, '--json']);
  assert.equal(r.out, '');
  const { error } = JSON.parse(r.err);
  assert.equal(error.exitCode, EXIT.NOT_PUBLIC);
  assert.equal(error.code, 'not_public');
  assert.equal(error.status, 403);
});

test('help and version', async () => {
  const help = await cli(['--help']);
  assert.equal(help.code, EXIT.OK);
  assert.match(help.out, /Usage: relayto <command>/);
  assert.match(help.out, /Exit codes:/);
  assert.equal((await cli(['-v'])).out, `${VERSION}\n`);
});

test('the bin runs under node and exits with the code', () => {
  const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
  const version = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), VERSION);
  const usage = spawnSync(process.execPath, [bin, 'hubs'], { encoding: 'utf8', env: { ...process.env, RELAYTO_SITE: '' } });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /which site\?/);
});
