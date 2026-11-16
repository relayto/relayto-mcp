'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseSite, InvalidSiteError } = require('../lib/site');
const { parseArgs, platformBridgeArgs, UsageError } = require('../bin/relayto-mcp');

const vectors = require(path.join(__dirname, '..', '..', '..', 'test-fixtures', 'site-hosts.json'));

test('parseSite accepts host names and site root URLs', () => {
  for (const [input, expected] of Object.entries(vectors.valid)) {
    assert.equal(parseSite(input), expected, `input ${JSON.stringify(input)}`);
  }
});

test('parseSite rejects anything but an https host', () => {
  for (const input of vectors.invalid) {
    assert.throws(() => parseSite(input), InvalidSiteError, `input ${JSON.stringify(input)}`);
  }
  assert.throws(() => parseSite(undefined), InvalidSiteError);
});

test('parseArgs reads --site in both forms and keeps other arguments', () => {
  assert.deepEqual(parseArgs(['--site', 'benefits.relayto.com']), { site: 'benefits.relayto.com', rest: [] });
  assert.deepEqual(parseArgs(['--site=benefits.relayto.com']), { site: 'benefits.relayto.com', rest: [] });
  assert.deepEqual(parseArgs(['--debug', '3456']), { site: null, rest: ['--debug', '3456'] });
  assert.throws(() => parseArgs(['--site']), UsageError);
  assert.throws(() => parseArgs(['--site', '--debug']), UsageError);
  assert.throws(() => parseArgs(['--site', 'a.example.com', '--site=b.example.com']), UsageError);
});

test('sign-in mode passes the same arguments to mcp-remote as before', () => {
  assert.deepEqual(platformBridgeArgs('/x/proxy.js', 'https://mcp.relayto.com/mcp', []), [
    '/x/proxy.js',
    'https://mcp.relayto.com/mcp',
    '--transport',
    'http-only',
  ]);
  assert.deepEqual(platformBridgeArgs('/x/proxy.js', 'https://mcp.relayto.com/mcp', ['--transport', 'sse-only', '--debug']), [
    '/x/proxy.js',
    'https://mcp.relayto.com/mcp',
    '--transport',
    'sse-only',
    '--debug',
  ]);
});
