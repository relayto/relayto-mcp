// A fake site API for unit tests: a fetch function that routes by path.

export const HOST = 'docs.example.com';
export const BASE = `https://${HOST}/api/site/v1`;

export function item(kind, slug, extra = {}) {
  const path = kind === 'hub' ? `/hub/${slug}` : kind === 'page' ? `/${slug}` : `/e/${slug}`;
  return {
    kind,
    slug,
    title: `Title of ${slug}`,
    summary: `Summary of ${slug}`,
    format: kind === 'hub' ? null : 'pdf',
    url: `https://${HOST}${path}`,
    markdownUrl: `https://${HOST}${path}.md`,
    apiUrl: `${BASE}/${kind === 'hub' ? 'hubs' : 'contents'}/${slug}`,
    updated: '2026-11-01T10:00:00Z',
    ...extra,
  };
}

export function content(slug, extra = {}) {
  return {
    ...item('content', slug),
    subtitle: null,
    description: `About ${slug}`,
    pageCount: 3,
    access: 'open',
    textIncluded: true,
    indexable: true,
    publisher: { name: 'Example', url: `https://${HOST}/` },
    markdown: `# Title of ${slug}\n\nText of ${slug}.`,
    ...extra,
  };
}

export function hub(slug, extra = {}) {
  return {
    ...item('hub', slug),
    description: `About ${slug}`,
    itemCount: 2,
    itemsUrl: `${BASE}/hubs/${slug}/items`,
    publisher: { name: 'Example', url: `https://${HOST}/` },
    ...extra,
  };
}

export function problem(status, code, extra = {}) {
  return new Response(
    JSON.stringify({ type: `https://${HOST}/developers#error-${code}`, title: 'Problem', status, detail: `Detail ${code}`, code, hint: `Hint ${code}`, ...extra.body }),
    { status, headers: { 'content-type': 'application/problem+json', ...extra.headers } },
  );
}

export function json(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'ratelimit-limit': '120', 'ratelimit-remaining': '119', 'ratelimit-reset': '60', ...headers },
  });
}

// Splits `items` into pages of `limit` with base64 offsets as cursors, like the API.
export function paged(items, url, extra = {}) {
  const limit = Number(url.searchParams.get('limit') ?? 10);
  const offset = url.searchParams.get('cursor') ? Number(Buffer.from(url.searchParams.get('cursor'), 'base64url').toString()) : 0;
  const data = items.slice(offset, offset + limit);
  const hasMore = offset + limit < items.length;
  const nextCursor = hasMore ? Buffer.from(String(offset + limit)).toString('base64url') : null;
  return json({ ...extra, data, pagination: { limit, hasMore, nextCursor }, links: { self: url.href, next: null } });
}

// routes: { 'GET /search': (url, init) => Response, ... }. Records every call.
export function fakeFetch(routes) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    calls.push({ url, method, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined, signal: init.signal });
    const path = url.pathname.replace(/^\/api\/site\/(sandbox\/)?v1/, '') || '/';
    const route = routes[`${method} ${path}`] ?? routes[`${method} *`];
    if (!route) return problem(404, 'not_found');
    return route(url, init, calls.length);
  };
  return { fetch, calls };
}

// Collects what the CLI writes.
export function io(fetch, env = {}) {
  const out = [];
  const err = [];
  return {
    io: { stdout: { write: (c) => out.push(c) }, stderr: { write: (c) => err.push(c) }, env, fetch },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}
