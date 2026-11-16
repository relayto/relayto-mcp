import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RelaytoSite,
  RelaytoError,
  RelaytoApiError,
  RelaytoConnectionError,
  InvalidRequestError,
  InvalidSiteError,
  NotFoundError,
  NotPublicError,
  RateLimitError,
  parseSite,
  VERSION,
} from '../dist/index.js';
import { BASE, HOST, content, fakeFetch, hub, item, json, paged, problem } from './helpers.mjs';

const vectors = JSON.parse(readFileSync(new URL('../../../test-fixtures/site-hosts.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('parseSite: same rules as relayto-mcp --site', () => {
  for (const [input, expected] of Object.entries(vectors.valid)) assert.equal(parseSite(input), expected, JSON.stringify(input));
  for (const input of vectors.invalid) assert.throws(() => parseSite(input), InvalidSiteError, JSON.stringify(input));
});

test('the constructor normalizes the site and rejects bad ones', () => {
  const site = new RelaytoSite('HTTPS://Docs.Example.com/');
  assert.equal(site.host, HOST);
  assert.equal(site.baseUrl, BASE);
  assert.equal(site.mcpUrl, `https://${HOST}/mcp`);
  assert.equal(new RelaytoSite(HOST, { sandbox: true }).baseUrl, `https://${HOST}/api/site/sandbox/v1`);
  assert.throws(() => new RelaytoSite('http://docs.example.com'), InvalidSiteError);
  assert.throws(() => new RelaytoSite('docs.example.com/api'), (e) => e instanceof InvalidSiteError && e instanceof RelaytoError);
});

test('VERSION matches package.json', () => {
  assert.equal(VERSION, pkg.version);
});

test('requests carry the right URL, query and headers', async () => {
  const { fetch, calls } = fakeFetch({ 'GET /search': (url) => paged([item('content', 'a')], url, { query: url.searchParams.get('q') }) });
  const site = new RelaytoSite(HOST, { fetch });
  const results = await site.search('annual report', { kind: 'content', limit: 5 });
  assert.equal(results.query, 'annual report');
  const call = calls[0];
  assert.equal(call.url.origin + call.url.pathname, `${BASE}/search`);
  assert.equal(call.url.searchParams.get('q'), 'annual report');
  assert.equal(call.url.searchParams.get('kind'), 'content');
  assert.equal(call.url.searchParams.get('limit'), '5');
  assert.equal(call.url.searchParams.has('cursor'), false);
  assert.equal(call.headers['user-agent'], `relayto/${VERSION} (+https://github.com/relayto/relayto-mcp)`);
  assert.match(call.headers.accept, /application\/json/);
  assert.deepEqual(site.rateLimit, { limit: 120, remaining: 119, reset: 60 });
});

test('getSite, getHub and getContent hit their paths; slugs are encoded', async () => {
  const { fetch, calls } = fakeFetch({
    'GET /': () => json({ name: 'Example', description: null, url: `https://${HOST}/`, apiVersion: '1.0.0', links: {} }),
    'GET /hubs/reports': () => json(hub('reports')),
    'GET /contents/a~b_c-1': () => json(content('a~b_c-1')),
  });
  const site = new RelaytoSite(HOST, { fetch });
  assert.equal((await site.getSite()).name, 'Example');
  assert.equal(calls[0].url.href, `${BASE}/`);
  assert.equal((await site.getHub('reports')).itemCount, 2);
  assert.equal((await site.getContent('a~b_c-1')).markdown, '# Title of a~b_c-1\n\nText of a~b_c-1.');
  await assert.rejects(site.getContent('a/../b'), NotFoundError);
  assert.equal(calls.at(-1).url.pathname, '/api/site/v1/contents/a%2F..%2Fb');
});

test('iterators follow cursors to the end', async () => {
  const hubs = Array.from({ length: 7 }, (_, i) => item('hub', `h${i}`));
  const { fetch, calls } = fakeFetch({ 'GET /hubs': (url) => paged(hubs, url) });
  const site = new RelaytoSite(HOST, { fetch });
  const seen = [];
  for await (const h of site.allHubs({ limit: 3 })) seen.push(h.slug);
  assert.deepEqual(seen, hubs.map((h) => h.slug));
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url.searchParams.get('cursor'), Buffer.from('3').toString('base64url'));
});

test('every list has a one-page method and an iterator', async () => {
  const items = [item('content', 'x'), item('content', 'y')];
  const { fetch } = fakeFetch({
    'GET /pages': (url) => paged(items, url),
    'GET /contents': (url) => paged(items, url),
    'GET /hubs/h/items': (url) => paged(items, url),
    'GET /search': (url) => paged(items, url, { query: 'q' }),
  });
  const site = new RelaytoSite(HOST, { fetch });
  const drain = async (it) => {
    const out = [];
    for await (const x of it) out.push(x.slug);
    return out;
  };
  assert.equal((await site.listPages()).data.length, 2);
  assert.equal((await site.listContents({ limit: 1 })).pagination.hasMore, true);
  assert.equal((await site.listHubItems('h')).data.length, 2);
  assert.deepEqual(await drain(site.allPages({ limit: 1 })), ['x', 'y']);
  assert.deepEqual(await drain(site.allContents()), ['x', 'y']);
  assert.deepEqual(await drain(site.allHubItems('h')), ['x', 'y']);
  assert.deepEqual(await drain(site.searchAll('q', { limit: 1 })), ['x', 'y']);
});

test('problem answers become typed errors', async () => {
  const { fetch } = fakeFetch({
    'GET /contents/bad': () => problem(400, 'invalid_parameter'),
    'GET /contents/secret': () => problem(403, 'not_public', { body: { url: `https://${HOST}/e/secret` } }),
    'GET /contents/gone': () => problem(404, 'not_found'),
    'GET /contents/boom': () => problem(500, 'internal_error'),
    'GET /contents/html': () => new Response('<h1>502</h1>', { status: 502, statusText: 'Bad Gateway', headers: { 'content-type': 'text/html' } }),
  });
  const site = new RelaytoSite(HOST, { fetch });
  await assert.rejects(site.getContent('bad'), (e) => e instanceof InvalidRequestError && e.code === 'invalid_parameter' && e.status === 400);
  await assert.rejects(site.getContent('secret'), (e) => e instanceof NotPublicError && e.url === `https://${HOST}/e/secret` && e.hint === 'Hint not_public');
  await assert.rejects(site.getContent('gone'), (e) => e instanceof NotFoundError && e.message === 'Detail not_found' && e.problem.type.endsWith('#error-not_found'));
  await assert.rejects(site.getContent('boom'), (e) => e instanceof RelaytoApiError && e.constructor === RelaytoApiError && e.status === 500);
  await assert.rejects(site.getContent('html'), (e) => e instanceof RelaytoApiError && e.status === 502 && e.code === 'internal_error' && /HTTP 502/.test(e.message));
});

test('429 is retried after Retry-After, then succeeds', async () => {
  const slept = [];
  const { fetch, calls } = fakeFetch({
    'GET /hubs': (url, init, n) => (n === 1 ? problem(429, 'rate_limited', { headers: { 'retry-after': '0' } }) : paged([item('hub', 'a')], url)),
  });
  const site = new RelaytoSite(HOST, { fetch });
  const t0 = Date.now();
  const page = await site.listHubs();
  assert.equal(page.data.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(slept, []);
});

test('429 without Retry-After waits for RateLimit-Reset', async () => {
  const { fetch, calls } = fakeFetch({
    'GET /hubs': (url, init, n) => (n === 1 ? problem(429, 'rate_limited', { headers: { 'ratelimit-reset': '0', 'ratelimit-remaining': '0', 'ratelimit-limit': '120' } }) : paged([], url)),
  });
  await new RelaytoSite(HOST, { fetch }).listHubs();
  assert.equal(calls.length, 2);
});

test('429 with a long Retry-After throws RateLimitError at once', async () => {
  const { fetch, calls } = fakeFetch({ 'GET /hubs': () => problem(429, 'rate_limited', { headers: { 'retry-after': '90' } }) });
  await assert.rejects(new RelaytoSite(HOST, { fetch }).listHubs(), (e) => e instanceof RateLimitError && e.retryAfter === 90);
  assert.equal(calls.length, 1);
});

test('429 stops after maxRetries', async () => {
  const { fetch, calls } = fakeFetch({ 'GET /hubs': () => problem(429, 'rate_limited', { headers: { 'retry-after': '0' } }) });
  await assert.rejects(new RelaytoSite(HOST, { fetch, maxRetries: 1 }).listHubs(), RateLimitError);
  assert.equal(calls.length, 2);
});

test('network failures and timeouts are RelaytoConnectionError', async () => {
  const failing = new RelaytoSite(HOST, {
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(failing.getSite(), (e) => e instanceof RelaytoConnectionError && /Could not reach https:\/\/docs\.example\.com: fetch failed/.test(e.message));

  const slow = new RelaytoSite(HOST, {
    timeoutMs: 20,
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
  });
  await assert.rejects(slow.getSite(), (e) => e instanceof RelaytoConnectionError && /no answer within 20 ms/.test(e.message));

  const notJson = new RelaytoSite(HOST, { fetch: async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) });
  await assert.rejects(notJson.getSite(), (e) => e instanceof RelaytoConnectionError && /not JSON/.test(e.message));
});

test("the caller's abort signal wins", async () => {
  const controller = new AbortController();
  const site = new RelaytoSite(HOST, {
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
  });
  const pending = site.getSite({ signal: controller.signal });
  controller.abort(new Error('stop'));
  await assert.rejects(pending, (e) => e.message === 'stop');
});

test('export posts the request with an idempotency key, then reads the result', async () => {
  const job = { id: 'abc.' + 'x'.repeat(43), status: 'accepted', statusUrl: `${BASE}/exports/abc`, request: { contents: ['a'] }, itemCount: null, items: null, error: null };
  const done = { ...job, status: 'completed', itemCount: 1, items: [{ slug: 'a', status: 'ok', kind: 'content', title: 'A', access: 'open', apiUrl: `${BASE}/contents/a`, markdown: '# A' }] };
  const { fetch, calls } = fakeFetch({
    'POST /exports': () => new Response(JSON.stringify(job), { status: 202, headers: { 'content-type': 'application/json', location: job.statusUrl } }),
    [`GET /exports/${job.id}`]: () => json(done),
  });
  const site = new RelaytoSite(HOST, { fetch });
  const result = await site.export({ contents: ['a'] }, { idempotencyKey: 'k-1' });
  assert.equal(result.status, 'completed');
  assert.equal(result.items[0].markdown, '# A');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { contents: ['a'] });
  assert.equal(calls[0].headers['content-type'], 'application/json');
  assert.equal(calls[0].headers['idempotency-key'], 'k-1');
});

test('resolve maps URLs, paths, .md addresses and slugs', async () => {
  const pages = [item('page', 'home-1', { url: `https://${HOST}/` }), item('page', 'about-2', { url: `https://${HOST}/company/about` })];
  const { fetch, calls } = fakeFetch({
    'GET /contents/report-1': () => json(content('report-1')),
    'GET /contents/home-1': () => json(content('home-1', { kind: 'page' })),
    'GET /contents/about-2': () => json(content('about-2', { kind: 'page' })),
    'GET /hubs/reports': () => json(hub('reports')),
    'GET /pages': (url) => paged(pages, url),
  });
  const site = new RelaytoSite(HOST, { fetch });
  assert.equal((await site.resolve(`https://${HOST}/e/report-1`)).content.slug, 'report-1');
  assert.equal((await site.resolve(`https://${HOST}/e/report-1.md?x=1#y`)).content.slug, 'report-1');
  assert.equal((await site.resolve('/hub/reports/')).hub.slug, 'reports');
  assert.equal((await site.resolve(`https://${HOST}/hub/reports.md`)).kind, 'hub');
  const home = await site.resolve(`https://${HOST}`);
  assert.equal(home.kind, 'page');
  assert.equal(home.content.slug, 'home-1');
  assert.equal((await site.resolve('/index.md')).content.slug, 'home-1');
  assert.equal((await site.resolve('/Company/About/')).content.slug, 'about-2');
  assert.equal((await site.resolve('report-1')).kind, 'content');
  const before = calls.length;
  assert.equal((await site.resolve('reports')).kind, 'hub');
  assert.deepEqual(calls.slice(before).map((c) => c.url.pathname), ['/api/site/v1/contents/reports', '/api/site/v1/hubs/reports']);
});

test('resolve refuses other sites and reports what is missing', async () => {
  const { fetch } = fakeFetch({ 'GET /pages': (url) => paged([], url) });
  const site = new RelaytoSite(HOST, { fetch });
  await assert.rejects(site.resolve('https://other.example.com/e/x'), (e) => e instanceof RelaytoError && /is on other\.example\.com, not on docs\.example\.com/.test(e.message));
  await assert.rejects(site.resolve('nothing-here'), (e) => e instanceof NotFoundError && /no page, document or hub "nothing-here"/.test(e.message));
  await assert.rejects(site.resolve('/no/such/page'), (e) => e instanceof NotFoundError && /answers at \/no\/such\/page/.test(e.message));
  await assert.rejects(site.resolve('not a slug!'), RelaytoError);
  await assert.rejects(site.resolve('  '), RelaytoError);
});

test('resolve passes on a 403 instead of trying a hub', async () => {
  const { fetch, calls } = fakeFetch({ 'GET /contents/private-1': () => problem(403, 'not_public') });
  await assert.rejects(new RelaytoSite(HOST, { fetch }).resolve('private-1'), NotPublicError);
  assert.equal(calls.length, 1);
});
