'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { SiteBridge, runSiteBridge, retryAfterSeconds } = require('../lib/site-bridge');

const ENDPOINT = 'https://site.example.com/mcp';

function sseBody(text) {
  return new ReadableStream({
    start(controller) {
      // Split the stream at awkward places to exercise the parser's buffering.
      const bytes = new TextEncoder().encode(text);
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  });
}

function makeBridge(responder, extra = {}) {
  const calls = [];
  const out = [];
  const logs = [];
  const bridge = new SiteBridge({
    endpoint: ENDPOINT,
    userAgent: 'relayto-mcp/test',
    fetch: async (url, init) => {
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
      return responder(calls.length, init);
    },
    write: (chunk) => out.push(chunk),
    log: (line) => logs.push(line),
    sleep: async (ms) => logs.push(`slept ${ms}`),
    ...extra,
  });
  const messages = () => out.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { bridge, calls, out, logs, messages };
}

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };

test('forwards a request and writes the JSON answer as one line', async () => {
  const answer = { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'x', version: '1' }, capabilities: {} } };
  const { bridge, calls, out, messages } = makeBridge(() => Response.json(answer));
  await bridge.handleLine(JSON.stringify(initialize));
  assert.equal(calls[0].url, ENDPOINT);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(calls[0].init.headers.accept, 'application/json, text/event-stream');
  assert.equal(calls[0].init.headers['user-agent'], 'relayto-mcp/test');
  assert.equal(calls[0].init.headers['mcp-protocol-version'], undefined);
  assert.deepEqual(messages(), [answer]);
  assert.equal(out.length, 1);
  assert.ok(out[0].endsWith('\n') && !out[0].slice(0, -1).includes('\n'));
});

test('sends the negotiated protocol version and session id afterwards', async () => {
  const { bridge, calls } = makeBridge((n) => {
    if (n === 1) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'x', version: '1' } } }), {
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'abc123' },
      });
    }
    return new Response(null, { status: 202 });
  });
  await bridge.handleLine(JSON.stringify(initialize));
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.equal(calls[1].init.headers['mcp-protocol-version'], '2025-11-25');
  assert.equal(calls[1].init.headers['mcp-session-id'], 'abc123');
});

test('sends Mcp-Method, and Mcp-Name for tools, prompts and resources', async () => {
  const { bridge, calls } = makeBridge(() => Response.json({ jsonrpc: '2.0', id: 1, result: {} }));
  await bridge.handleLine(JSON.stringify(initialize));
  assert.equal(calls[0].init.headers['mcp-method'], 'initialize');
  assert.equal(calls[0].init.headers['mcp-name'], undefined);
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_content', arguments: { query: 'x' } } }));
  assert.equal(calls[1].init.headers['mcp-method'], 'tools/call');
  assert.equal(calls[1].init.headers['mcp-name'], 'search_content');
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'https://site.example.com/llms.txt' } }));
  assert.equal(calls[2].init.headers['mcp-name'], 'https://site.example.com/llms.txt');
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'https://site.example.com/é' } }));
  assert.equal(calls[3].init.headers['mcp-name'], undefined, 'a value that is not header-safe is left out');
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list', params: { name: 'not-a-tool-call' } }));
  assert.equal(calls[4].init.headers['mcp-name'], undefined);
});

test('MCP 2026-07-28: the version in params._meta goes in the header, without initialize', async () => {
  const { bridge, calls } = makeBridge((n) =>
    n === 1
      ? Response.json({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'x', version: '1' } } })
      : Response.json({ jsonrpc: '2.0', id: n, result: {} }),
  );
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
  const stateless = makeBridge(() => Response.json({ jsonrpc: '2.0', id: 7, result: {} }));
  await stateless.bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_content', arguments: { url: '/e/x' }, _meta: meta } }));
  assert.equal(stateless.calls[0].init.headers['mcp-protocol-version'], '2026-07-28');
  assert.equal(stateless.calls[0].init.headers['mcp-method'], 'tools/call');
  assert.equal(stateless.calls[0].init.headers['mcp-name'], 'get_content');
  // A message's own _meta version wins over the one initialize negotiated.
  await bridge.handleLine(JSON.stringify(initialize));
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: meta } }));
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }));
  assert.equal(calls[1].init.headers['mcp-protocol-version'], '2026-07-28');
  assert.equal(calls[2].init.headers['mcp-protocol-version'], '2025-06-18');
});

test('relays every message of an SSE answer, in order', async () => {
  const progress = { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 1, progress: 1 } };
  const result = { jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: 'line one\nline two' }] } };
  const sse = `: comment\r\nevent: message\r\ndata: ${JSON.stringify(progress)}\r\n\r\nid: 2\ndata: ${JSON.stringify(result)}\n\n`;
  const { bridge, messages } = makeBridge(() => new Response(sseBody(sse), { headers: { 'content-type': 'text/event-stream' } }));
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'search_content', arguments: { query: 'x' } } }));
  assert.deepEqual(messages(), [progress, result]);
});

test('a notification answered with 202 writes nothing', async () => {
  const { bridge, out } = makeBridge(() => new Response(null, { status: 202 }));
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.deepEqual(out, []);
});

test('an HTTP error answers the request with a JSON-RPC error', async () => {
  const { bridge, messages } = makeBridge(() => new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway', headers: { 'content-type': 'text/html' } }));
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'tools/list' }));
  const [message] = messages();
  assert.equal(message.id, 'a');
  assert.equal(message.error.code, -32000);
  assert.match(message.error.message, /HTTP 502/);
  assert.equal(message.error.data.status, 502);
});

test('a JSON-RPC error in an HTTP error body is passed on', async () => {
  const error = { jsonrpc: '2.0', id: 3, error: { code: -32602, message: 'Unknown tool' } };
  const { bridge, messages } = makeBridge(() => new Response(JSON.stringify(error), { status: 400, headers: { 'content-type': 'application/json' } }));
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope' } }));
  assert.deepEqual(messages(), [error]);
});

test('a network failure answers the request instead of hanging', async () => {
  const { bridge, messages } = makeBridge(() => {
    throw new TypeError('fetch failed');
  });
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }));
  const [message] = messages();
  assert.equal(message.id, 9);
  assert.equal(message.error.code, -32603);
  assert.match(message.error.message, /could not reach https:\/\/site\.example\.com\/mcp: fetch failed/);
});

test('429 with a short Retry-After is retried', async () => {
  const answer = { jsonrpc: '2.0', id: 4, result: { tools: [] } };
  const { bridge, calls, logs, messages } = makeBridge((n) =>
    n === 1 ? new Response('{}', { status: 429, headers: { 'retry-after': '2', 'content-type': 'application/problem+json' } }) : Response.json(answer),
  );
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list' }));
  assert.equal(calls.length, 2);
  assert.ok(logs.includes('slept 2000'));
  assert.deepEqual(messages(), [answer]);
});

test('429 with a long Retry-After is answered as an error at once', async () => {
  const { bridge, calls, messages } = makeBridge(() => new Response('{}', { status: 429, headers: { 'retry-after': '120', 'content-type': 'application/problem+json' } }));
  await bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }));
  assert.equal(calls.length, 1);
  const [message] = messages();
  assert.match(message.error.message, /HTTP 429 .*rate limited/);
  assert.equal(message.error.data.retryAfter, '120');
});

test('a line that is not JSON gets a parse error', async () => {
  const { bridge, calls, messages } = makeBridge(() => Response.json({}));
  await bridge.handleLine('{not json');
  assert.equal(calls.length, 0);
  assert.equal(messages()[0].error.code, -32700);
  assert.equal(messages()[0].id, null);
});

test('requests wait for initialize to finish', async () => {
  let releaseInit;
  const order = [];
  const { bridge } = makeBridge(async (n, init) => {
    const body = JSON.parse(init.body);
    order.push(`start ${body.method}`);
    if (body.method === 'initialize') {
      await new Promise((resolve) => {
        releaseInit = resolve;
      });
      order.push('end initialize');
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'x', version: '1' } } });
    }
    return Response.json({ jsonrpc: '2.0', id: body.id, result: {} });
  });
  const first = bridge.handleLine(JSON.stringify(initialize));
  const second = bridge.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start initialize']);
  releaseInit();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start initialize', 'end initialize', 'start tools/list']);
});

test('runSiteBridge reads stdin to the end and writes every answer', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (c) => chunks.push(c));
  const fetch = async (url, init) => {
    assert.equal(url, 'https://benefits.relayto.com/mcp');
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const body = JSON.parse(init.body);
    if (!('id' in body)) return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: '2.0', id: body.id, result: { echo: body.method } });
  };
  const done = runSiteBridge({ site: 'benefits.relayto.com', input, output, fetch, log: () => {} });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\r\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n\n`);
  input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}`);
  await done;
  const lines = Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(
    lines.sort((a, b) => a.id - b.id),
    [
      { jsonrpc: '2.0', id: 1, result: { echo: 'ping' } },
      { jsonrpc: '2.0', id: 2, result: { echo: 'tools/list' } },
    ],
  );
});

test('retryAfterSeconds reads seconds and HTTP dates', () => {
  assert.equal(retryAfterSeconds('5'), 5);
  assert.equal(retryAfterSeconds(null), null);
  assert.equal(retryAfterSeconds('soon'), null);
  const inTen = new Date(Date.now() + 10_000).toUTCString();
  assert.ok(retryAfterSeconds(inTen) >= 9 && retryAfterSeconds(inTen) <= 11);
});
