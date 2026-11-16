import { parseArgs } from 'node:util';
import { RelaytoSite, VERSION, type ListOptions } from './client.js';
import { NotFoundError, NotPublicError, RateLimitError, RelaytoApiError, RelaytoError } from './errors.js';
import { InvalidSiteError, parseSite } from './site.js';
import type { Content, ExportRequest, Hub, Item, ItemKind, ItemList, Site } from './types.js';

/** Exit codes of the `relayto` command. */
export const EXIT = {
  OK: 0,
  /** Network failure, server error or anything unexpected. */
  ERROR: 1,
  /** Bad command, option or site. */
  USAGE: 2,
  /** 404: no such page, document, hub or site. */
  NOT_FOUND: 3,
  /** 403: it exists but is not public. */
  NOT_PUBLIC: 4,
  /** 429: rate limited, still after retrying. */
  RATE_LIMITED: 5,
} as const;

export interface CliIo {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  env: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
}

const HELP = `relayto ${VERSION}: search and read any site published with RELAYTO, from the terminal.

Usage: relayto <command> [arguments] --site <host> [options]

Commands:
  search <query>        Search the site's pages, hubs and documents
  hubs                  List the hubs (curated collections)
  hub <hub>             Show a hub and list its items (slug, URL or path)
  pages                 List the site's own pages
  contents              List the documents in the site's library
  get <url-or-slug>     Print a document or page as Markdown (a hub: its items)
  export <slug>...      Print the Markdown of up to 10 documents at once
  export --hub <hub>    ... or of a hub's first 10 documents
  site                  Show the site's name, description and API links
  help                  Show this help

Options:
  --site <host>         The site, e.g. benefits.relayto.com or the publisher's own
                        domain. Default: $RELAYTO_SITE. Not needed when the argument
                        of get or hub is a full URL on the site.
  --json                Print JSON for programs instead of text
  --limit <n>           How many items to print (default 10)
  --all                 Print every item, following the pages to the end
  --cursor <cursor>     Continue a list where an earlier --json answer stopped
  --kind <kind>         search only: page, hub or content
  --sandbox             Use the site's sandbox API (fixed sample data)
  -h, --help            Show this help
  -v, --version         Show the version

Exit codes:
  0  success (also a search with no results)
  1  network failure, server error or other failure
  2  bad command, option or site
  3  not found
  4  not public (private, password, sign-in or a gated hub)
  5  rate limited (120 requests a minute per IP), still after retrying

Examples:
  npx relayto search "open enrollment" --site benefits.relayto.com
  npx relayto hubs --site benefits.relayto.com --json
  npx relayto get https://benefits.relayto.com/e/<slug>

The API behind it: https://<host>/api/site/v1 (OpenAPI at https://<host>/openapi.json).
Docs: https://github.com/relayto/relayto-mcp/tree/main/packages/relayto
`;

class UsageError extends Error {}

const COMMANDS = new Set(['search', 'hubs', 'hub', 'pages', 'contents', 'get', 'export', 'site', 'help']);
const KINDS: readonly ItemKind[] = ['page', 'hub', 'content'];

interface Options {
  site?: string;
  json: boolean;
  limit?: string;
  all: boolean;
  cursor?: string;
  kind?: string;
  sandbox: boolean;
  hub?: string;
  help: boolean;
  version: boolean;
}

function parse(argv: string[]): { command: string | undefined; args: string[]; options: Options } {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        site: { type: 'string' },
        json: { type: 'boolean', default: false },
        limit: { type: 'string' },
        all: { type: 'boolean', default: false },
        cursor: { type: 'string' },
        kind: { type: 'string' },
        sandbox: { type: 'boolean', default: false },
        hub: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const [command, ...args] = parsed.positionals;
  return { command, args, options: parsed.values as Options };
}

function limitOf(options: Options): number | null {
  if (options.all) {
    if (options.limit !== undefined) throw new UsageError('use --limit or --all, not both');
    return null;
  }
  if (options.limit === undefined) return 10;
  const n = Number(options.limit);
  if (!Number.isInteger(n) || n < 1 || n > 10_000) throw new UsageError(`--limit must be a whole number from 1 to 10000, not "${options.limit}"`);
  return n;
}

interface Collected {
  items: Item[];
  hasMore: boolean;
  nextCursor: string | null;
}

// Fetches pages until `max` items (or all of them), never more than needed, so
// nextCursor continues exactly after the last printed item.
async function collect(fetchPage: (opts: ListOptions) => Promise<ItemList>, max: number | null, cursor: string | undefined): Promise<Collected> {
  const items: Item[] = [];
  let next = cursor;
  for (;;) {
    const want = max === null ? 50 : Math.min(50, max - items.length);
    const page = await fetchPage({ limit: want, cursor: next });
    items.push(...page.data);
    const more = page.pagination.hasMore && !!page.pagination.nextCursor;
    if (!more) return { items, hasMore: false, nextCursor: null };
    next = page.pagination.nextCursor ?? undefined;
    if (max !== null && items.length >= max) return { items, hasMore: true, nextCursor: next ?? null };
  }
}

function itemLines(items: Item[], start = 1): string {
  return items
    .map((item, i) => {
      const label = item.kind === 'content' ? (item.format ?? 'document') : item.kind;
      const lines = [`${start + i}. ${item.title || '(untitled)'} [${label}]`, `   ${item.url}`];
      if (item.summary) lines.push(`   ${item.summary}`);
      lines.push(`   slug: ${item.slug}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

function siteText(site: Site, client: RelaytoSite): string {
  const lines = [site.name, site.url];
  if (site.description) lines.push('', site.description);
  lines.push(
    '',
    `API:            ${client.baseUrl} (v${site.apiVersion})`,
    `OpenAPI:        ${site.links.openapi}`,
    `Documentation:  ${site.links.documentation}`,
    `llms.txt:       ${site.links.llmsTxt}`,
    `MCP server:     ${client.mcpUrl}  (or: npx -y relayto-mcp --site ${client.host})`,
  );
  return lines.join('\n');
}

function hubText(hub: Hub): string {
  const lines = [`${hub.title} [hub, ${hub.itemCount} item${hub.itemCount === 1 ? '' : 's'}]`, hub.url];
  if (hub.description) lines.push('', hub.description);
  return lines.join('\n');
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  const out = (text: string) => io.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  const note = (text: string) => io.stderr.write(`${text}\n`);
  let json = argv.includes('--json');

  try {
    const { command, args, options } = parse(argv);
    json = options.json;
    if (options.version) {
      out(VERSION);
      return EXIT.OK;
    }
    if (options.help || command === 'help') {
      out(HELP);
      return EXIT.OK;
    }
    if (!command) {
      io.stderr.write(HELP);
      return EXIT.USAGE;
    }
    if (!COMMANDS.has(command)) throw new UsageError(`unknown command "${command}"`);

    // The site: --site, else a full URL argument of get/hub, else $RELAYTO_SITE.
    let siteInput = options.site;
    const target = args[0];
    if (!siteInput && (command === 'get' || command === 'hub') && target && /^https?:\/\//i.test(target)) {
      let url: URL;
      try {
        url = new URL(target);
      } catch {
        throw new UsageError(`"${target}" is not a valid URL`);
      }
      if (url.protocol !== 'https:') throw new UsageError('only https sites are supported');
      siteInput = url.hostname;
    }
    siteInput ??= io.env.RELAYTO_SITE;
    if (!siteInput) throw new UsageError('which site? Add --site <host>, for example --site benefits.relayto.com, or set RELAYTO_SITE');
    const client = new RelaytoSite(parseSite(siteInput), { sandbox: options.sandbox, fetch: io.fetch });

    const max = limitOf(options);
    const printList = (collected: Collected, extra: Record<string, unknown> = {}) => {
      if (json) {
        out(JSON.stringify({ ...extra, data: collected.items, pagination: { hasMore: collected.hasMore, nextCursor: collected.nextCursor } }, null, 2));
        return;
      }
      out(collected.items.length ? itemLines(collected.items) : 'Nothing found.');
      if (collected.hasMore) note(`More: raise --limit, use --all, or continue with --cursor ${collected.nextCursor}`);
    };
    const noArgs = () => {
      if (args.length) throw new UsageError(`${command} takes no arguments`);
    };

    switch (command) {
      case 'site': {
        noArgs();
        const site = await client.getSite();
        out(json ? JSON.stringify(site, null, 2) : siteText(site, client));
        return EXIT.OK;
      }
      case 'search': {
        const query = args.join(' ').trim();
        if (!query) throw new UsageError('search needs words to look for: relayto search "<query>" --site <host>');
        if (query.length > 200) throw new UsageError('the query is longer than 200 characters');
        let kind: ItemKind | undefined;
        if (options.kind !== undefined) {
          if (!KINDS.includes(options.kind as ItemKind)) throw new UsageError(`--kind must be page, hub or content, not "${options.kind}"`);
          kind = options.kind as ItemKind;
        }
        const collected = await collect((o) => client.search(query, { ...o, kind }), max, options.cursor);
        printList(collected, { query });
        return EXIT.OK;
      }
      case 'hubs':
        noArgs();
        printList(await collect((o) => client.listHubs(o), max, options.cursor));
        return EXIT.OK;
      case 'pages':
        noArgs();
        printList(await collect((o) => client.listPages(o), max, options.cursor));
        return EXIT.OK;
      case 'contents':
        noArgs();
        printList(await collect((o) => client.listContents(o), max, options.cursor));
        return EXIT.OK;
      case 'hub': {
        if (args.length !== 1) throw new UsageError('hub takes one hub slug, URL or path');
        const resolved = await client.resolve(args[0] as string);
        if (resolved.kind !== 'hub') throw new UsageError(`${args[0]} is a ${resolved.kind}, not a hub: use relayto get`);
        const items = await collect((o) => client.listHubItems(resolved.hub.slug, o), max, options.cursor);
        if (json) {
          out(JSON.stringify({ hub: resolved.hub, data: items.items, pagination: { hasMore: items.hasMore, nextCursor: items.nextCursor } }, null, 2));
        } else {
          out(`${hubText(resolved.hub)}\n\n${items.items.length ? itemLines(items.items) : 'This hub has no public items.'}`);
          if (items.hasMore) note(`More: raise --limit, use --all, or continue with --cursor ${items.nextCursor}`);
        }
        return EXIT.OK;
      }
      case 'get': {
        if (args.length !== 1) throw new UsageError('get takes one URL, path or slug');
        const resolved = await client.resolve(args[0] as string);
        if (resolved.kind === 'hub') {
          const items = await collect((o) => client.listHubItems(resolved.hub.slug, o), max, options.cursor);
          if (json) out(JSON.stringify({ hub: resolved.hub, data: items.items, pagination: { hasMore: items.hasMore, nextCursor: items.nextCursor } }, null, 2));
          else out(`${hubText(resolved.hub)}\n\n${items.items.length ? itemLines(items.items) : 'This hub has no public items.'}`);
          return EXIT.OK;
        }
        const content: Content = resolved.content;
        if (json) {
          out(JSON.stringify(content, null, 2));
        } else {
          out(content.markdown);
          if (content.access !== 'open') note(`Only the description is available: this page is ${content.access} on the site. Open it in a browser: ${content.url}`);
        }
        return EXIT.OK;
      }
      case 'export': {
        let request: ExportRequest;
        if (options.hub !== undefined) {
          if (args.length) throw new UsageError('use slugs or --hub, not both');
          request = { hub: options.hub };
        } else {
          if (!args.length) throw new UsageError('export needs 1 to 10 slugs, or --hub <hub>');
          if (args.length > 10) throw new UsageError('export takes at most 10 slugs at a time');
          request = { contents: args };
        }
        const job = await client.export(request);
        if (json) {
          out(JSON.stringify(job, null, 2));
          return EXIT.OK;
        }
        const items = job.items ?? [];
        const ok = items.filter((item) => item.status === 'ok' && item.markdown !== null);
        for (const item of items) if (item.status !== 'ok') note(`Skipped ${item.slug}: ${item.status === 'not_public' ? 'not public' : 'not found'}`);
        out(ok.length ? ok.map((item) => item.markdown).join('\n\n---\n\n') : 'Nothing to export.');
        return ok.length || !items.length ? EXIT.OK : items.every((item) => item.status === 'not_public') ? EXIT.NOT_PUBLIC : EXIT.NOT_FOUND;
      }
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (error) {
    return report(error, json, io);
  }
}

function report(error: unknown, json: boolean, io: CliIo): number {
  let code: number = EXIT.ERROR;
  if (error instanceof UsageError || error instanceof InvalidSiteError) code = EXIT.USAGE;
  else if (error instanceof NotFoundError) code = EXIT.NOT_FOUND;
  else if (error instanceof NotPublicError) code = EXIT.NOT_PUBLIC;
  else if (error instanceof RateLimitError) code = EXIT.RATE_LIMITED;
  else if (error instanceof RelaytoError && !(error instanceof RelaytoApiError) && error.name === 'RelaytoError') code = EXIT.USAGE;

  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    const body: Record<string, unknown> = { exitCode: code, message };
    if (error instanceof RelaytoApiError) Object.assign(body, { status: error.status, code: error.code, hint: error.hint, problem: error.problem });
    if (error instanceof RateLimitError) body.retryAfter = error.retryAfter;
    io.stderr.write(`${JSON.stringify({ error: body })}\n`);
    return code;
  }
  io.stderr.write(`relayto: ${message}\n`);
  if (error instanceof RelaytoApiError && error.hint) io.stderr.write(`hint: ${error.hint}\n`);
  if (error instanceof NotPublicError && error.url) io.stderr.write(`Open it in a browser: ${error.url}\n`);
  if (error instanceof RateLimitError && error.retryAfter !== null) io.stderr.write(`Try again in ${error.retryAfter} s.\n`);
  if (code === EXIT.USAGE) io.stderr.write('Run relayto --help for usage.\n');
  return code;
}
