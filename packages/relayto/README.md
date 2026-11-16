# relayto

The official SDK and CLI for sites published with [RELAYTO](https://relayto.com).

Every site published with RELAYTO, on a `*.relayto.com` address or on the publisher's
own domain, has a public, read-only API at `https://<site>/api/site/v1` (OpenAPI at
`https://<site>/openapi.json`). This package searches and reads it: the site's pages,
its hubs (curated collections) and the documents in its library, each with its text as
Markdown. No API key, no account.

It returns only what any visitor can open without signing in. Private, password and
sign-in pages answer "not public"; email- and notice-gated pages give their
description only.

- TypeScript types included, no runtime dependencies, Node.js 20.3 or later (ESM).
- Cursor pagination with async iterators, typed RFC 9457 errors, automatic retry of
  `429 Too Many Requests` after `Retry-After`.

## CLI

```sh
npx relayto search "open enrollment" --site benefits.relayto.com
npx relayto hubs --site benefits.relayto.com
npx relayto get https://benefits.relayto.com/e/what-is-open-enrollment-4uoe8tjxhumq6
```

Or install it: `npm install -g relayto`, then `relayto …`.

| Command | What it prints |
| --- | --- |
| `relayto search <query>` | pages, hubs and documents matching the words, best first (`--kind page\|hub\|content`) |
| `relayto hubs` | the site's hubs |
| `relayto hub <hub>` | a hub and its items (slug, URL or path) |
| `relayto pages` | the site's own pages |
| `relayto contents` | the documents in the site's library |
| `relayto get <url-or-slug>` | a document or page as Markdown; for a hub, its items |
| `relayto export <slug>...` | the Markdown of up to 10 documents (`--hub <hub>`: a hub's first 10) |
| `relayto site` | the site's name, description, API, OpenAPI, llms.txt and MCP addresses |

Options:

- `--site <host>`: the site's host name, for example `benefits.relayto.com` or the
  publisher's own domain. Defaults to `$RELAYTO_SITE`. Not needed when the argument of
  `get` or `hub` is a full URL on the site.
- `--json`: JSON for programs. Lists print `{ "data": [...], "pagination": { "hasMore",
  "nextCursor" } }`; errors print `{ "error": { ... } }` on stderr.
- `--limit <n>` (default 10), `--all`, `--cursor <cursor>`: how much of a list to print,
  and where to continue.
- `--sandbox`: the site's sandbox API, fixed sample data in the same shapes, for
  testing a script.

Text goes to stdout; notes (more results, gated pages) and errors go to stderr.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | success, including a search with no results |
| 1 | network failure, server error or other failure |
| 2 | bad command, option or site |
| 3 | not found |
| 4 | not public (private, password, sign-in, or a gated hub) |
| 5 | rate limited (120 requests a minute per IP), still after retrying |

## SDK

```sh
npm install relayto
```

```ts
import { RelaytoSite, NotFoundError, NotPublicError } from 'relayto';

const site = new RelaytoSite('benefits.relayto.com');

// One page of search results
const results = await site.search('wellness', { kind: 'content', limit: 5 });
for (const item of results.data) console.log(item.title, item.url);

// Every hub, following the cursors
for await (const hub of site.allHubs()) console.log(hub.title, hub.slug);

// A document with its Markdown
try {
  const doc = await site.getContent('what-is-open-enrollment-4uoe8tjxhumq6');
  console.log(doc.access === 'open' ? doc.markdown : `Description only: ${doc.url}`);
} catch (error) {
  if (error instanceof NotFoundError) console.log('No such document');
  else if (error instanceof NotPublicError) console.log('Not public; open it in a browser:', error.url);
  else throw error;
}

// A URL, path or slug, whatever it points at
const found = await site.resolve('https://benefits.relayto.com/hub/wellness-6ac9424f4eba5');
if (found.kind === 'hub') console.log(found.hub.itemCount, 'items');
```

| Method | API operation |
| --- | --- |
| `getSite()` | `GET /` (getSite) |
| `search(q, { kind, limit, cursor })` / `searchAll(q)` | `GET /search` (searchSite) |
| `listPages()` / `allPages()` | `GET /pages` (listPages) |
| `listHubs()` / `allHubs()` | `GET /hubs` (listHubs) |
| `getHub(slug)` | `GET /hubs/{hubSlug}` (getHub) |
| `listHubItems(slug)` / `allHubItems(slug)` | `GET /hubs/{hubSlug}/items` (listHubItems) |
| `listContents()` / `allContents()` | `GET /contents` (listContents) |
| `getContent(slug)` | `GET /contents/{contentSlug}` (getContent) |
| `createExport({ contents } \| { hub }, { idempotencyKey })` | `POST /exports` (createExport) |
| `getExport(id)` | `GET /exports/{exportId}` (getExport) |
| `export(request)` | createExport, then getExport |
| `resolve(urlOrPathOrSlug)` | finds the hub, document or page behind an address |

`list*` and `search` return one page (`{ data, pagination, links }`); `all*` and
`searchAll` are async iterators over every item (page size 50, or `limit`).

Options: `new RelaytoSite(site, { sandbox, fetch, userAgent, timeoutMs, maxRetries,
maxRetryAfterSeconds })`. `site.rateLimit` holds the last `RateLimit-*` headers.

Errors, all subclasses of `RelaytoError`:

| Class | When |
| --- | --- |
| `InvalidSiteError` | the site is not an https host name |
| `RelaytoConnectionError` | no answer: network, TLS, timeout, or a body that is not JSON |
| `RelaytoApiError` | any problem answer; has `status`, `code`, `hint` and `problem` (the RFC 9457 body) |
| `InvalidRequestError` | 400 `invalid_parameter`, `invalid_cursor`, `invalid_body` |
| `NotPublicError` | 403 `not_public`; `url` is the page to open in a browser |
| `NotFoundError` | 404 `not_found` |
| `RateLimitError` | 429 after the retries; `retryAfter` in seconds |

## For AI agents

The same sites serve a public MCP server at `https://<site>/mcp` (no sign-in). For
clients that only start local servers: `npx -y relayto-mcp --site <host>`
([relayto-mcp](https://www.npmjs.com/package/relayto-mcp)). Each site's
`https://<site>/llms.txt` lists its pages, and `<page URL>.md` is any page as Markdown.

## Links

- RELAYTO: https://relayto.com
- Source, issues, the MCP bridge and agent skills: https://github.com/relayto/relayto-mcp
- A site's API reference: `https://<site>/developers`

## License

MIT
