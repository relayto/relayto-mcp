import { createRequire } from 'node:module';
import { RelaytoConnectionError, RelaytoError, NotFoundError, errorFromProblem } from './errors.js';
import { parseSite } from './site.js';
import type {
  Content,
  ExportJob,
  ExportRequest,
  Hub,
  Item,
  ItemKind,
  ItemList,
  Problem,
  RateLimit,
  SearchResults,
  Site,
} from './types.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

/** The package version, as sent in the default User-Agent. */
export const VERSION: string = pkg.version;

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_~-]*$/;

export interface RelaytoSiteOptions {
  /** Use the site's sandbox API (`/api/site/sandbox/v1`): fixed sample data, same shapes. */
  sandbox?: boolean;
  /** A fetch implementation; defaults to the global one (Node.js 20+). */
  fetch?: typeof globalThis.fetch;
  /** Sent as User-Agent. Defaults to `relayto/<version>`. */
  userAgent?: string;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** How many times to retry a 429 or 503 answer that says when to retry. Default 2. */
  maxRetries?: number;
  /** The longest wait, in seconds, the client accepts before a retry. Default 30. */
  maxRetryAfterSeconds?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ListOptions extends RequestOptions {
  /** Page size, 1-50. The API's default is 10; the iterators default to 50. */
  limit?: number;
  /** `pagination.nextCursor` of the previous page. */
  cursor?: string;
}

export interface SearchOptions extends ListOptions {
  /** Only return results of this kind. */
  kind?: ItemKind;
}

export interface ExportOptions extends RequestOptions {
  /** Makes retries safe to repeat (a UUID, for example). */
  idempotencyKey?: string;
}

/** What `resolve` found behind a URL, path or slug. */
export type Resolved = { kind: 'hub'; hub: Hub } | { kind: 'page' | 'content'; content: Content };

type Query = Record<string, string | number | undefined>;

interface Call extends RequestOptions {
  method?: 'GET' | 'POST';
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
}

function retryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function readRateLimit(headers: Headers): RateLimit | null {
  const num = (name: string): number | null => {
    const value = headers.get(name);
    if (value === null || value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const limit = num('ratelimit-limit');
  const remaining = num('ratelimit-remaining');
  const reset = num('ratelimit-reset');
  if (limit === null && remaining === null && reset === null) return null;
  return { limit, remaining, reset };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function pathOf(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    return path === '' ? '/' : path.toLowerCase();
  } catch {
    return url;
  }
}

/**
 * A client for the public, read-only API of one site published with RELAYTO
 * (`https://<site>/api/site/v1`). No API key. Every method reads; `createExport`
 * only starts a job that collects text.
 *
 * ```ts
 * const site = new RelaytoSite('benefits.relayto.com');
 * const results = await site.search('wellness');
 * for await (const hub of site.allHubs()) console.log(hub.title);
 * ```
 */
export class RelaytoSite {
  /** The site's host name, normalized. */
  readonly host: string;
  /** The API base URL, `https://<host>/api/site/v1` (or the sandbox). */
  readonly baseUrl: string;
  /** Rate-limit state from the last answer, or null before the first call. */
  rateLimit: RateLimit | null = null;

  readonly #fetch: typeof globalThis.fetch;
  readonly #userAgent: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #maxRetryAfterSeconds: number;

  /**
   * @param site The site's host name (`benefits.relayto.com`, or the publisher's own
   *   domain) or the https URL of its home page. Throws `InvalidSiteError` otherwise.
   */
  constructor(site: string, options: RelaytoSiteOptions = {}) {
    this.host = parseSite(site);
    this.baseUrl = `https://${this.host}/api/site/${options.sandbox ? 'sandbox/' : ''}v1`;
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new RelaytoError('No fetch implementation: use Node.js 20 or later, or pass options.fetch');
    this.#fetch = fetchImpl;
    this.#userAgent = options.userAgent ?? `relayto/${VERSION} (+https://github.com/relayto/relayto-mcp)`;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 30;
  }

  /** The site's public MCP server, for MCP clients (`https://<host>/mcp`). */
  get mcpUrl(): string {
    return `https://${this.host}/mcp`;
  }

  /** The site: name, description, home page and API links. (`getSite`) */
  getSite(options: RequestOptions = {}): Promise<Site> {
    return this.#call<Site>('/', options);
  }

  /** One page of search results over titles and summaries, best match first. (`searchSite`) */
  search(query: string, options: SearchOptions = {}): Promise<SearchResults> {
    const { kind, limit, cursor, signal } = options;
    return this.#call<SearchResults>('/search', { query: { q: query, kind, limit, cursor }, signal });
  }

  /** Every search result, page after page. */
  searchAll(query: string, options: SearchOptions = {}): AsyncGenerator<Item> {
    return this.#paginate((cursor, limit) => this.search(query, { ...options, cursor, limit }), options);
  }

  /** One page of the site's pages. (`listPages`) */
  listPages(options: ListOptions = {}): Promise<ItemList> {
    return this.#list('/pages', options);
  }

  /** Every page of the site. */
  allPages(options: ListOptions = {}): AsyncGenerator<Item> {
    return this.#paginate((cursor, limit) => this.listPages({ ...options, cursor, limit }), options);
  }

  /** One page of the site's hubs. (`listHubs`) */
  listHubs(options: ListOptions = {}): Promise<ItemList> {
    return this.#list('/hubs', options);
  }

  /** Every hub of the site. */
  allHubs(options: ListOptions = {}): AsyncGenerator<Item> {
    return this.#paginate((cursor, limit) => this.listHubs({ ...options, cursor, limit }), options);
  }

  /** A hub: title, description, addresses and item count. 403 if it is gated. (`getHub`) */
  getHub(hubSlug: string, options: RequestOptions = {}): Promise<Hub> {
    return this.#call<Hub>(`/hubs/${encodeURIComponent(hubSlug)}`, options);
  }

  /** One page of a hub's items. (`listHubItems`) */
  listHubItems(hubSlug: string, options: ListOptions = {}): Promise<ItemList> {
    return this.#list(`/hubs/${encodeURIComponent(hubSlug)}/items`, options);
  }

  /** Every item of a hub. */
  allHubItems(hubSlug: string, options: ListOptions = {}): AsyncGenerator<Item> {
    return this.#paginate((cursor, limit) => this.listHubItems(hubSlug, { ...options, cursor, limit }), options);
  }

  /** One page of the site's documents. (`listContents`) */
  listContents(options: ListOptions = {}): Promise<ItemList> {
    return this.#list('/contents', options);
  }

  /** Every document of the site. */
  allContents(options: ListOptions = {}): AsyncGenerator<Item> {
    return this.#paginate((cursor, limit) => this.listContents({ ...options, cursor, limit }), options);
  }

  /**
   * A document or page with its Markdown. When `access` is not `open`, `markdown`
   * holds only the description. 403 if it is private or behind a password or sign-in.
   * (`getContent`)
   */
  getContent(contentSlug: string, options: RequestOptions = {}): Promise<Content> {
    return this.#call<Content>(`/contents/${encodeURIComponent(contentSlug)}`, options);
  }

  /** Starts an export of up to 10 documents, or a hub's first 10. (`createExport`) */
  createExport(request: ExportRequest, options: ExportOptions = {}): Promise<ExportJob> {
    const headers: Record<string, string> = {};
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    return this.#call<ExportJob>('/exports', { method: 'POST', body: request, headers, signal: options.signal });
  }

  /** An export job and its result, read from the current content. (`getExport`) */
  getExport(exportId: string, options: RequestOptions = {}): Promise<ExportJob> {
    return this.#call<ExportJob>(`/exports/${encodeURIComponent(exportId)}`, options);
  }

  /** Starts an export and returns its result. */
  async export(request: ExportRequest, options: ExportOptions = {}): Promise<ExportJob> {
    const job = await this.createExport(request, options);
    return this.getExport(job.id, { signal: options.signal });
  }

  /**
   * Finds what a page URL, a path on this site or a slug points at: a hub, or a
   * document or page with its Markdown. Accepts `/e/<slug>`, `/hub/<slug>`, `.md`
   * addresses and the site's own page paths (`/`, `/about`).
   */
  async resolve(target: string, options: RequestOptions = {}): Promise<Resolved> {
    const text = target.trim();
    if (!text) throw new RelaytoError('Nothing to look up: give a URL, a path or a slug');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      let url: URL;
      try {
        url = new URL(text);
      } catch {
        throw new RelaytoError(`"${text}" is not a valid URL`);
      }
      const host = url.hostname.toLowerCase().replace(/\.$/, '');
      if (host !== this.host) throw new RelaytoError(`${text} is on ${host}, not on ${this.host}`);
      return this.#byPath(url.pathname, options);
    }
    if (text.startsWith('/')) return this.#byPath(text.split(/[?#]/)[0] ?? '/', options);
    if (SLUG.test(text)) return this.#bySlug(text, options);
    throw new RelaytoError(`"${text}" is not a URL, a path on the site or a slug`);
  }

  async #bySlug(slug: string, options: RequestOptions): Promise<Resolved> {
    try {
      const content = await this.getContent(slug, options);
      return { kind: content.kind === 'page' ? 'page' : 'content', content };
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
    try {
      return { kind: 'hub', hub: await this.getHub(slug, options) };
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      throw new NotFoundError(
        { ...error.problem, detail: `There is no page, document or hub "${slug}" on ${this.host}.` },
        error.rateLimit,
      );
    }
  }

  async #byPath(rawPath: string, options: RequestOptions): Promise<Resolved> {
    let path = rawPath;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      // keep it as it is
    }
    path = path.replace(/\/+$/, '').replace(/\.md$/i, '');
    if (path === '/index' || path === '') path = '/';
    const segments = path.split('/').filter(Boolean);
    const e = segments.lastIndexOf('e');
    if (e !== -1 && segments[e + 1]) {
      const content = await this.getContent(segments[e + 1] as string, options);
      return { kind: content.kind === 'page' ? 'page' : 'content', content };
    }
    const hub = segments.lastIndexOf('hub');
    if (hub !== -1 && segments[hub + 1]) return { kind: 'hub', hub: await this.getHub(segments[hub + 1] as string, options) };

    const wanted = path.toLowerCase();
    for await (const page of this.allPages(options)) {
      if (pathOf(page.url) === wanted) {
        const content = await this.getContent(page.slug, options);
        return { kind: 'page', content };
      }
    }
    if (segments.length === 1 && SLUG.test(segments[0] as string)) return this.#bySlug(segments[0] as string, options);
    throw new NotFoundError({
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      detail: `Nothing on ${this.host} answers at ${path}.`,
      code: 'not_found',
      hint: 'Use a URL from search or a list, or a slug.',
    });
  }

  #list(path: string, options: ListOptions): Promise<ItemList> {
    const { limit, cursor, signal } = options;
    return this.#call<ItemList>(path, { query: { limit, cursor }, signal });
  }

  async *#paginate(fetchPage: (cursor: string | undefined, limit: number) => Promise<ItemList>, options: ListOptions): AsyncGenerator<Item> {
    const limit = options.limit ?? 50;
    let cursor = options.cursor;
    for (;;) {
      const page = await fetchPage(cursor, limit);
      yield* page.data;
      if (!page.pagination.hasMore || !page.pagination.nextCursor) return;
      cursor = page.pagination.nextCursor;
    }
  }

  async #call<T>(path: string, call: Call = {}): Promise<T> {
    const url = new URL(this.baseUrl + (path === '/' ? '/' : path));
    for (const [key, value] of Object.entries(call.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const method = call.method ?? 'GET';
    const headers: Record<string, string> = {
      accept: 'application/json, application/problem+json',
      'user-agent': this.#userAgent,
      ...call.headers,
    };
    let body: string | undefined;
    if (call.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(call.body);
    }

    for (let attempt = 0; ; attempt += 1) {
      const timeout = AbortSignal.timeout(this.#timeoutMs);
      const signal = call.signal ? AbortSignal.any([call.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await this.#fetch(url, { method, headers, body, signal });
      } catch (error) {
        if (call.signal?.aborted) throw call.signal.reason;
        const reason = timeout.aborted ? `no answer within ${this.#timeoutMs} ms` : error instanceof Error ? error.message : String(error);
        throw new RelaytoConnectionError(`Could not reach ${url.origin}: ${reason}`, { cause: error });
      }
      this.rateLimit = readRateLimit(response.headers) ?? this.rateLimit;

      if (response.ok) {
        try {
          return (await response.json()) as T;
        } catch (error) {
          throw new RelaytoConnectionError(`${url.origin} sent an answer that is not JSON (HTTP ${response.status})`, { cause: error });
        }
      }

      const retryAfter = retryAfterSeconds(response.headers.get('retry-after'));
      const wait = retryAfter ?? (response.status === 429 ? this.rateLimit?.reset ?? null : null);
      if ((response.status === 429 || response.status === 503) && attempt < this.#maxRetries && wait !== null && wait <= this.#maxRetryAfterSeconds) {
        await response.body?.cancel();
        await sleep(wait * 1000, call.signal);
        continue;
      }
      throw errorFromProblem(await this.#problem(response, url), retryAfter, this.rateLimit);
    }
  }

  async #problem(response: Response, url: URL): Promise<Problem> {
    const text = await response.text().catch(() => '');
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('json')) {
      try {
        const parsed = JSON.parse(text) as Partial<Problem>;
        if (parsed && typeof parsed === 'object') {
          return {
            ...parsed,
            type: parsed.type ?? 'about:blank',
            title: parsed.title ?? response.statusText,
            status: typeof parsed.status === 'number' ? parsed.status : response.status,
            detail: parsed.detail ?? `HTTP ${response.status} from ${url.origin}${url.pathname}`,
            code: parsed.code ?? fallbackCode(response.status),
          };
        }
      } catch {
        // not JSON after all
      }
    }
    return {
      type: 'about:blank',
      title: response.statusText || `HTTP ${response.status}`,
      status: response.status,
      detail: `HTTP ${response.status} from ${url.origin}${url.pathname}`,
      code: fallbackCode(response.status),
    };
  }
}

function fallbackCode(status: number): string {
  if (status === 400) return 'invalid_parameter';
  if (status === 403) return 'not_public';
  if (status === 404) return 'not_found';
  if (status === 405) return 'method_not_allowed';
  if (status === 429) return 'rate_limited';
  return 'internal_error';
}
