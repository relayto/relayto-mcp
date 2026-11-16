'use strict';

// A stdio <-> Streamable HTTP bridge for the public, read-only MCP server every
// site published with RELAYTO serves at https://<site>/mcp. No sign-in, no
// dependencies.
//
// The MCP client writes one JSON-RPC message per line on our stdin. Each message
// is POSTed to the site's endpoint; whatever the server answers (a JSON body or
// an SSE stream) is written back to stdout, one message per line. Nothing else
// may be written to stdout. When the HTTP call fails, a request still gets a
// JSON-RPC error answer, so the client never waits forever.

const readline = require('node:readline');

const DEFAULTS = {
  timeoutMs: 60_000,
  maxRetries: 2,
  maxRetryAfterSeconds: 30,
};

// MCP 2026-07-28 (stateless) puts the protocol version in every request's
// params._meta and requires the Streamable HTTP headers to repeat it, along with
// the method and, for these methods, the tool/prompt name or resource URI.
const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
const NAME_PARAM = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
  'resources/subscribe': 'uri',
  'resources/unsubscribe': 'uri',
};
const HEADER_SAFE = /^[\x20-\x7E]{1,2048}$/;

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INTERNAL_ERROR = -32603;
// Implementation-defined server error range (-32000 to -32099).
const BRIDGE_HTTP_ERROR = -32000;

function isRequest(message) {
  return message && typeof message === 'object' && typeof message.method === 'string' && 'id' in message && message.id !== null;
}

function errorResponse(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

function retryAfterSeconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

// Parses a text/event-stream body and calls onMessage(data) for each event that
// carries data. Works on a web ReadableStream (fetch Response.body).
async function readSse(body, onData) {
  const decoder = new TextDecoder();
  let buffer = '';
  let data = [];
  const flush = () => {
    if (data.length) onData(data.join('\n'));
    data = [];
  };
  const handleLine = (line) => {
    if (line === '') return flush();
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    return undefined;
  };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.search(/\r\n|\r|\n/)) !== -1) {
      const line = buffer.slice(0, index);
      const newline = buffer.startsWith('\r\n', index) ? 2 : 1;
      buffer = buffer.slice(index + newline);
      handleLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer) handleLine(buffer);
  flush();
}

class SiteBridge {
  constructor(options) {
    this.endpoint = options.endpoint;
    this.fetch = options.fetch || globalThis.fetch;
    this.userAgent = options.userAgent;
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? DEFAULTS.maxRetryAfterSeconds;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.write = options.write;
    this.log = options.log || (() => {});
    this.protocolVersion = null;
    this.sessionId = null;
    this.initializing = null;
    this.inFlight = new Set();
  }

  send(message) {
    this.write(`${JSON.stringify(message)}\n`);
  }

  // Handles one line from stdin. Returns a promise that settles when the answer
  // (if any) has been written.
  handleLine(line) {
    const text = line.trim();
    if (!text) return Promise.resolve();
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      this.send(errorResponse(null, JSONRPC_PARSE_ERROR, `Parse error: ${error.message}`));
      return Promise.resolve();
    }
    const task = this.forward(text, message);
    this.inFlight.add(task);
    task.finally(() => this.inFlight.delete(task));
    return task;
  }

  async forward(text, message) {
    const isInitialize = message && message.method === 'initialize';
    let release;
    if (isInitialize) {
      this.initializing = new Promise((resolve) => {
        release = resolve;
      });
    } else if (this.initializing) {
      await this.initializing;
    }
    try {
      await this.post(text, message, isInitialize);
    } catch (error) {
      if (isRequest(message)) {
        this.send(errorResponse(message.id, JSONRPC_INTERNAL_ERROR, `relayto-mcp could not reach ${this.endpoint}: ${error.message}`));
      } else {
        this.log(`could not forward ${message && message.method ? message.method : 'a message'}: ${error.message}`);
      }
    } finally {
      if (release) {
        this.initializing = null;
        release();
      }
    }
  }

  // HTTP headers for one message: the version it declares in params._meta (else
  // the one negotiated by initialize), its method and its name or URI.
  headers(message) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.userAgent) headers['user-agent'] = this.userAgent;
    const params = message && typeof message.params === 'object' && message.params !== null ? message.params : {};
    const declared = params._meta && typeof params._meta[META_PROTOCOL_VERSION] === 'string' ? params._meta[META_PROTOCOL_VERSION] : null;
    const version = declared || this.protocolVersion;
    if (version && HEADER_SAFE.test(version)) headers['mcp-protocol-version'] = version;
    if (message && typeof message.method === 'string' && HEADER_SAFE.test(message.method)) {
      headers['mcp-method'] = message.method;
      const key = NAME_PARAM[message.method];
      if (key && typeof params[key] === 'string' && HEADER_SAFE.test(params[key])) headers['mcp-name'] = params[key];
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    return headers;
  }

  async post(text, message, isInitialize) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers(message),
        body: text,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const sessionId = response.headers.get('mcp-session-id');
      if (sessionId) this.sessionId = sessionId;

      if (response.status === 429 && attempt < this.maxRetries) {
        const wait = retryAfterSeconds(response.headers.get('retry-after'));
        if (wait !== null && wait <= this.maxRetryAfterSeconds) {
          await response.body?.cancel();
          this.log(`rate limited by ${new URL(this.endpoint).host}; retrying in ${wait}s`);
          await this.sleep(wait * 1000);
          continue;
        }
      }
      return this.relay(response, message, isInitialize);
    }
  }

  async relay(response, message, isInitialize) {
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const emit = (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.log(`ignored a non-JSON message from the server: ${raw.slice(0, 200)}`);
        return;
      }
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (isInitialize && item && item.id === message.id && item.result && typeof item.result.protocolVersion === 'string') {
          this.protocolVersion = item.result.protocolVersion;
        }
        this.send(item);
      }
    };

    if (response.status === 202 || response.status === 204) {
      await response.body?.cancel();
      return;
    }

    if (response.ok && contentType.startsWith('text/event-stream')) {
      await readSse(response.body, emit);
      return;
    }

    const body = await response.text();
    if (response.ok && contentType.includes('json')) {
      if (body.trim()) emit(body);
      return;
    }

    // An HTTP error. Pass on a JSON-RPC error the server put in the body; else
    // answer the request ourselves.
    if (contentType.includes('json')) {
      try {
        const parsed = JSON.parse(body);
        if (parsed && parsed.jsonrpc === '2.0' && parsed.error && 'id' in parsed) {
          this.send(isRequest(message) && parsed.id === null ? { ...parsed, id: message.id } : parsed);
          return;
        }
      } catch {
        // fall through
      }
    }
    if (!isRequest(message)) {
      this.log(`${message.method || 'message'}: HTTP ${response.status} from ${this.endpoint}`);
      return;
    }
    const data = { status: response.status };
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) data.retryAfter = retryAfter;
    if (body) data.body = body.slice(0, 2000);
    const reason = response.status === 429 ? 'rate limited, try again later' : response.statusText || 'request failed';
    this.send(errorResponse(message.id, BRIDGE_HTTP_ERROR, `HTTP ${response.status} from ${this.endpoint}: ${reason}`, data));
  }

  // Best effort: tell the server the session is over, if it gave us one.
  async close() {
    if (!this.sessionId) return;
    try {
      const response = await this.fetch(this.endpoint, {
        method: 'DELETE',
        headers: this.headers(null),
        signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
    } catch {
      // ignore
    }
  }

  async drain() {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight]);
  }
}

// Runs the bridge until stdin closes and every answer has been written.
async function runSiteBridge({ site, input, output, log, fetch, userAgent, timeoutMs }) {
  const endpoint = `https://${site}/mcp`;
  const bridge = new SiteBridge({
    endpoint,
    fetch,
    userAgent,
    timeoutMs,
    write: (chunk) => output.write(chunk),
    log,
  });
  const lines = readline.createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) bridge.handleLine(line);
  await bridge.drain();
  await bridge.close();
  return bridge;
}

module.exports = { SiteBridge, runSiteBridge, readSse, retryAfterSeconds };
