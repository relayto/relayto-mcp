import type { Problem, RateLimit } from './types.js';

/** Base class of every error this package throws. */
export class RelaytoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RelaytoError';
  }
}

/** The request never got an answer: DNS, TLS, connection, timeout or an unreadable body. */
export class RelaytoConnectionError extends RelaytoError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RelaytoConnectionError';
  }
}

/**
 * The site API answered with an RFC 9457 problem (4xx or 5xx). `problem` holds the
 * body as sent; `code` is its stable machine-readable code.
 */
export class RelaytoApiError extends RelaytoError {
  readonly status: number;
  readonly code: string;
  readonly problem: Problem;
  readonly hint: string | undefined;
  readonly rateLimit: RateLimit | null;

  constructor(problem: Problem, rateLimit: RateLimit | null = null) {
    super(problem.detail || problem.title || `HTTP ${problem.status}`);
    this.name = 'RelaytoApiError';
    this.status = problem.status;
    this.code = problem.code;
    this.problem = problem;
    this.hint = problem.hint;
    this.rateLimit = rateLimit;
  }
}

/** 400: a parameter, cursor or body the API does not accept. */
export class InvalidRequestError extends RelaytoApiError {
  constructor(problem: Problem, rateLimit: RateLimit | null = null) {
    super(problem, rateLimit);
    this.name = 'InvalidRequestError';
  }
}

/** 404: no such page, hub, document or export on this site, or the site itself is unknown. */
export class NotFoundError extends RelaytoApiError {
  constructor(problem: Problem, rateLimit: RateLimit | null = null) {
    super(problem, rateLimit);
    this.name = 'NotFoundError';
  }
}

/**
 * 403: it exists but is not public (private, password, sign-in or a gated hub).
 * `url` is the page to open in a browser, when the API gives one.
 */
export class NotPublicError extends RelaytoApiError {
  readonly url: string | undefined;

  constructor(problem: Problem, rateLimit: RateLimit | null = null) {
    super(problem, rateLimit);
    this.name = 'NotPublicError';
    this.url = problem.url;
  }
}

/** 429, after the client's own retries. `retryAfter` is in seconds, when the API said. */
export class RateLimitError extends RelaytoApiError {
  readonly retryAfter: number | null;

  constructor(problem: Problem, retryAfter: number | null, rateLimit: RateLimit | null = null) {
    super(problem, rateLimit);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/** Picks the error class for a problem answer. */
export function errorFromProblem(problem: Problem, retryAfter: number | null, rateLimit: RateLimit | null): RelaytoApiError {
  switch (problem.status) {
    case 400:
      return new InvalidRequestError(problem, rateLimit);
    case 403:
      return new NotPublicError(problem, rateLimit);
    case 404:
      return new NotFoundError(problem, rateLimit);
    case 429:
      return new RateLimitError(problem, retryAfter, rateLimit);
    default:
      return new RelaytoApiError(problem, rateLimit);
  }
}
