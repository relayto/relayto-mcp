import { isIP } from 'node:net';
import { RelaytoError } from './errors.js';

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Thrown when a site is not given as an https host name. */
export class InvalidSiteError extends RelaytoError {
  readonly input: string;

  constructor(input: string, reason: string) {
    super(`"${input}" is not a site host name: ${reason}. Use the host only, for example benefits.relayto.com`);
    this.name = 'InvalidSiteError';
    this.input = input;
  }
}

/**
 * Normalizes how a site was given (a host name such as `benefits.relayto.com`,
 * or the https URL of its root) to its lowercase ASCII host name. Rejects http,
 * ports, paths, queries, fragments, credentials, IP addresses and localhost.
 */
export function parseSite(input: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new InvalidSiteError(String(input ?? ''), 'it is empty');
  const raw = input.trim();
  let url: URL;
  if (raw.includes('://')) {
    try {
      url = new URL(raw);
    } catch {
      throw new InvalidSiteError(raw, 'it is not a valid URL');
    }
    if (url.protocol !== 'https:') throw new InvalidSiteError(raw, 'only https sites are supported');
  } else {
    if (/[\s/\\?#@:]/.test(raw)) throw new InvalidSiteError(raw, 'a host name has no path, port, credentials, query or fragment');
    try {
      url = new URL(`https://${raw}/`);
    } catch {
      throw new InvalidSiteError(raw, 'it is not a valid host name');
    }
  }
  if (url.username || url.password) throw new InvalidSiteError(raw, 'credentials are not allowed');
  if (url.port) throw new InvalidSiteError(raw, 'a port is not allowed');
  if (url.href !== `https://${url.host}/`) throw new InvalidSiteError(raw, 'a path, query or fragment is not allowed');

  let host = url.hostname;
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (isIP(host.replace(/^\[|\]$/g, ''))) throw new InvalidSiteError(raw, 'IP addresses are not allowed');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new InvalidSiteError(raw, 'localhost is not a published site');
  if (host.length > 253) throw new InvalidSiteError(raw, 'the host name is too long');
  const labels = host.split('.');
  if (labels.length < 2) throw new InvalidSiteError(raw, 'a site host name has at least one dot');
  if (!labels.every((label) => LABEL.test(label))) throw new InvalidSiteError(raw, 'it has characters a host name cannot have');
  if (/^[0-9]+$/.test(labels[labels.length - 1] ?? '')) throw new InvalidSiteError(raw, 'the top-level domain cannot be numeric');
  return host;
}
