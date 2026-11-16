// Types of the public site API (OpenAPI 3.1 at https://<site>/openapi.json, v1).

/** `page`: a page of the site; `hub`: a collection; `content`: a document in the library. */
export type ItemKind = 'page' | 'hub' | 'content';

/** What a page or document is; null for hubs. */
export type ItemFormat = 'pdf' | 'document' | 'web-page' | 'article' | 'video' | 'audio' | 'image' | 'link' | 'other';

/**
 * `open`: the text is in `markdown`. `email-gated` and `notice-gated`: visitors
 * leave an email address or confirm a notice first, so only the description is given.
 */
export type Access = 'open' | 'email-gated' | 'notice-gated';

/** A page, hub or document of the site, as lists and search return it. */
export interface Item {
  kind: ItemKind;
  /** Pass to `getContent` (pages and contents) or `getHub` (hubs). */
  slug: string;
  title: string;
  /** Subtitle or description, plain text, at most 300 characters. */
  summary: string | null;
  format: ItemFormat | null;
  /** The interactive page on the site, for people. */
  url: string;
  /** The Markdown version of the page, for agents. */
  markdownUrl: string;
  /** This resource in the API. */
  apiUrl: string;
  /** Last update, UTC, ISO 8601. */
  updated: string | null;
}

export interface Pagination {
  limit: number;
  hasMore: boolean;
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}

export interface Links {
  self: string;
  next: string | null;
}

/** One page of a list. */
export interface ItemList {
  data: Item[];
  pagination: Pagination;
  links: Links;
}

/** One page of search results, best match first. */
export interface SearchResults extends ItemList {
  query: string;
}

export interface Publisher {
  name: string;
  url: string;
}

/** A document or page of the site with its Markdown version. */
export interface Content extends Item {
  subtitle: string | null;
  description: string | null;
  /** Number of pages (slides) of the document. */
  pageCount: number;
  access: Access;
  /** Whether `markdown` holds the full text. */
  textIncluded: boolean;
  /** Whether the site lets search engines index the page. */
  indexable: boolean;
  publisher: Publisher;
  /** The Markdown version of the page, as served at `markdownUrl`. */
  markdown: string;
}

/** A hub (curated collection) of the site. */
export interface Hub extends Item {
  description: string | null;
  /** Number of public items in the hub. */
  itemCount: number;
  /** The hub's items in the API (`listHubItems`). */
  itemsUrl: string;
  publisher: Publisher;
}

export interface SiteLinks {
  openapi: string;
  documentation: string;
  llmsTxt: string;
  search: string;
  hubs: string;
  contents: string;
  pages: string;
}

/** The site an API serves. */
export interface Site {
  name: string;
  description: string | null;
  /** Home page of the site. */
  url: string;
  apiVersion: string;
  links: SiteLinks;
}

/** What to export: 1-10 document or page slugs, or one hub (its first 10 documents). */
export type ExportRequest = { contents: string[]; hub?: never } | { hub: string; contents?: never };

export interface ExportItem {
  slug: string;
  /** `not_public`: private or behind a password or sign-in; `not_found`: no such document. */
  status: 'ok' | 'not_public' | 'not_found';
  kind: 'page' | 'content' | null;
  title: string | null;
  access: Access | null;
  apiUrl: string | null;
  /** Null unless `status` is `ok`. */
  markdown: string | null;
}

/** An export job. `items` is null in the `createExport` answer. */
export interface ExportJob {
  id: string;
  status: 'accepted' | 'completed' | 'failed';
  statusUrl: string;
  request: ExportRequest;
  itemCount: number | null;
  items: ExportItem[] | null;
  error: string | null;
}

/** Stable error codes the API documents. Others may be added within v1. */
export type ProblemCode =
  | 'invalid_parameter'
  | 'invalid_cursor'
  | 'not_public'
  | 'not_found'
  | 'invalid_body'
  | 'method_not_allowed'
  | 'rate_limited'
  | 'internal_error'
  | (string & {});

/** An RFC 9457 problem detail, as the API sends it. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: ProblemCode;
  /** What to do about it. */
  hint?: string;
  /** For `not_public`: the page to open in a browser. */
  url?: string;
  [extension: string]: unknown;
}

/** The rate-limit state of the last answer (`RateLimit-*` headers). */
export interface RateLimit {
  /** Requests allowed per window. */
  limit: number | null;
  /** Requests left in this window. */
  remaining: number | null;
  /** Seconds until the window resets. */
  reset: number | null;
}
