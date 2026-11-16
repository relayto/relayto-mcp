#!/usr/bin/env node
// Smoke test of the relayto SDK against live sites published with RELAYTO. Every
// call reads (createExport only collects text), about 15 requests per site, well
// under the API's 120 a minute.
//
// Usage: npm run build && RELAYTO_SMOKE_SITES="benefits.relayto.com other.example.com" node scripts/smoke.mjs
// Default site: benefits.relayto.com (RELAYTO's own demo site). Exits 1 on any failure.

import { RelaytoSite, NotFoundError } from '../packages/relayto/dist/index.js';

const sites = (process.env.RELAYTO_SMOKE_SITES || 'benefits.relayto.com').split(/[\s,]+/).filter(Boolean);
let failures = 0;
const t0 = Date.now();
const log = (line) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2).padStart(6)}s] ${line}`);

async function step(label, fn) {
  try {
    const detail = await fn();
    log(`ok   ${label}${detail ? `: ${detail}` : ''}`);
  } catch (error) {
    failures += 1;
    log(`FAIL ${label}: ${error?.name}: ${error?.message}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

for (const host of sites) {
  const site = new RelaytoSite(host, { userAgent: 'relayto-smoke-test (+https://github.com/relayto/relayto-mcp)' });
  log(`== ${site.host} (${site.baseUrl})`);
  let sample = null;
  let hubSlug = null;

  await step('getSite', async () => {
    const s = await site.getSite();
    expect(s.name && s.url && s.links.openapi, 'missing name, url or links');
    return `${s.name} <${s.url}> api ${s.apiVersion}`;
  });

  await step('listPages + listHubs + listContents (one page each)', async () => {
    const [pages, hubs, contents] = [await site.listPages({ limit: 5 }), await site.listHubs({ limit: 5 }), await site.listContents({ limit: 5 })];
    sample = contents.data[0] ?? pages.data[0] ?? null;
    hubSlug = hubs.data[0]?.slug ?? null;
    expect(sample, 'the site lists no pages and no contents');
    return `pages ${pages.data.length}${pages.pagination.hasMore ? '+' : ''}, hubs ${hubs.data.length}${hubs.pagination.hasMore ? '+' : ''}, contents ${contents.data.length}${contents.pagination.hasMore ? '+' : ''}`;
  });

  await step('allHubs iterates every page (page size 10)', async () => {
    let n = 0;
    for await (const h of site.allHubs({ limit: 10 })) {
      expect(h.kind === 'hub' && h.slug, 'bad hub item');
      n += 1;
    }
    return `${n} hubs`;
  });

  await step('search for a word from a title', async () => {
    const word = (sample?.title.match(/[\p{L}\p{N}]{4,}/u) ?? [sample?.title ?? 'report'])[0];
    const results = await site.search(word, { limit: 3 });
    expect(results.data.length > 0, `no results for "${word}"`);
    return `"${word}" -> ${results.data.length} result(s), first "${results.data[0].title}" [${results.data[0].kind}]`;
  });

  if (hubSlug) {
    await step('getHub + listHubItems', async () => {
      const hub = await site.getHub(hubSlug);
      const items = await site.listHubItems(hubSlug, { limit: 3 });
      return `"${hub.title}" itemCount ${hub.itemCount}, first page ${items.data.length}`;
    });
  }

  await step('getContent', async () => {
    const doc = await site.getContent(sample.slug);
    expect(typeof doc.markdown === 'string' && doc.markdown.length > 0, 'empty markdown');
    return `"${doc.title}" [${doc.kind}, ${doc.access}] ${doc.markdown.length} chars of Markdown`;
  });

  await step('resolve the item URL', async () => {
    const found = await site.resolve(sample.url);
    const slug = found.kind === 'hub' ? found.hub.slug : found.content.slug;
    expect(slug === sample.slug, `resolved to ${slug}, expected ${sample.slug}`);
    return `${sample.url} -> ${found.kind} ${slug}`;
  });

  await step('a missing slug is NotFoundError', async () => {
    try {
      await site.getContent('relayto-smoke-test-no-such-slug');
    } catch (error) {
      expect(error instanceof NotFoundError && error.code === 'not_found', `got ${error?.name}`);
      return `${error.status} ${error.code}: ${error.message}`;
    }
    throw new Error('no error');
  });

  await step('export one document', async () => {
    const job = await site.export({ contents: [sample.slug] });
    expect(job.status === 'completed' && job.items?.length === 1, `status ${job.status}`);
    return `${job.status}, item ${job.items[0].slug}: ${job.items[0].status}`;
  });

  if (site.host === 'benefits.relayto.com') {
    await step('the README examples still exist', async () => {
      const doc = await site.getContent('what-is-open-enrollment-4uoe8tjxhumq6');
      const hub = await site.resolve('https://benefits.relayto.com/hub/wellness-6ac9424f4eba5');
      expect(hub.kind === 'hub', 'wellness hub is gone');
      return `"${doc.title}", hub "${hub.hub.title}"`;
    });
  }

  log(`rate limit after: ${JSON.stringify(site.rateLimit)}`);
}

log(failures ? `${failures} failure(s)` : 'all smoke checks passed');
process.exit(failures ? 1 : 0);
