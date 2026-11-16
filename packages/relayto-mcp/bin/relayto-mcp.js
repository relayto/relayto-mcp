#!/usr/bin/env node
'use strict';

// relayto-mcp: RELAYTO's MCP servers for clients that only start local (stdio)
// servers.
//
//   npx -y relayto-mcp --site <host>   the public, read-only MCP server of one site
//                                      published with RELAYTO (https://<host>/mcp).
//                                      No sign-in; bridged by lib/site-bridge.js.
//   npx -y relayto-mcp                 RELAYTO's platform MCP server
//                                      (https://mcp.relayto.com/mcp) with OAuth
//                                      sign-in, bridged by mcp-remote.
//
// Nothing but the MCP stream may be written to stdout. Diagnostics go to stderr.

const { spawn } = require('node:child_process');
const path = require('node:path');
const { parseSite } = require('../lib/site');

const DEFAULT_URL = 'https://mcp.relayto.com/mcp';
const pkg = require('../package.json');

function usage() {
  return [
    `relayto-mcp ${pkg.version}: RELAYTO MCP servers over stdio`,
    '',
    'Read a site published with RELAYTO (no sign-in):',
    '  npx -y relayto-mcp --site <host>',
    '  Connects to https://<host>/mcp, the site\'s public read-only MCP server.',
    '  <host> is the site\'s host name only, for example benefits.relayto.com',
    '  or the publisher\'s own domain: https only, no path, port or credentials.',
    '',
    'Work in your RELAYTO workspace (sign-in):',
    '  npx -y relayto-mcp [mcp-remote options]',
    `  Connects to ${DEFAULT_URL} and signs you in with your RELAYTO account.`,
    '  Extra arguments are passed to mcp-remote, for example:',
    '    --debug              write a debug log to ~/.mcp-auth',
    '    --host 127.0.0.1     host used in the OAuth callback URL',
    '    3456                 fixed port for the OAuth callback',
    '',
    'Environment (sign-in mode only):',
    '  RELAYTO_MCP_URL       another RELAYTO MCP endpoint (HTTPS only)',
    '  MCP_REMOTE_CONFIG_DIR where OAuth tokens are cached (default ~/.mcp-auth)',
    '',
    'Exit codes: 0 when the client closes the connection, 1 on a failure, 2 on bad arguments.',
    '',
    'Docs: https://github.com/relayto/relayto-mcp',
  ].join('\n');
}

class UsageError extends Error {}

// Splits argv into the --site value (if any) and everything else.
function parseArgs(argv) {
  const rest = [];
  let site = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--site') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) throw new UsageError('--site needs a value, for example --site benefits.relayto.com');
      if (site !== null) throw new UsageError('--site was given more than once');
      site = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--site=')) {
      if (site !== null) throw new UsageError('--site was given more than once');
      site = arg.slice('--site='.length);
    } else {
      rest.push(arg);
    }
  }
  return { site, rest };
}

function resolveServerUrl() {
  const raw = process.env.RELAYTO_MCP_URL;
  if (!raw) return DEFAULT_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`RELAYTO_MCP_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`RELAYTO_MCP_URL must use https: ${raw}`);
  }
  return url.toString();
}

function resolveBridge() {
  const manifestPath = require.resolve('mcp-remote/package.json');
  const manifest = require(manifestPath);
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin && manifest.bin['mcp-remote'];
  if (!bin) throw new Error('mcp-remote does not declare its mcp-remote binary');
  return path.join(path.dirname(manifestPath), bin);
}

// The argv mcp-remote gets in sign-in mode (exported for tests).
function platformBridgeArgs(bridge, serverUrl, args) {
  const bridgeArgs = [bridge, serverUrl];
  if (!args.includes('--transport')) bridgeArgs.push('--transport', 'http-only');
  bridgeArgs.push(...args);
  return bridgeArgs;
}

function runSite(site, rest) {
  if (rest.length) throw new UsageError(`unexpected argument with --site: ${rest.join(' ')}`);
  const { runSiteBridge } = require('../lib/site-bridge');
  const log = (line) => process.stderr.write(`relayto-mcp: ${line}\n`);
  log(`connecting to https://${site}/mcp (public, read-only, no sign-in)`);
  runSiteBridge({
    site,
    input: process.stdin,
    output: process.stdout,
    log,
    userAgent: `relayto-mcp/${pkg.version} (+https://github.com/relayto/relayto-mcp)`,
  }).then(
    // Exit once everything written to stdout has been flushed (pipes are async).
    () => process.stdout.write('', () => process.exit(0)),
    (error) => {
      log(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0));
}

function runPlatform(args) {
  const serverUrl = resolveServerUrl();
  const bridge = resolveBridge();
  const child = spawn(process.execPath, platformBridgeArgs(bridge, serverUrl, args), { stdio: 'inherit' });
  const forwarded = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const forward = (signal) => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  for (const signal of forwarded) process.on(signal, forward);
  child.on('error', (error) => {
    process.stderr.write(`relayto-mcp: could not start mcp-remote: ${error.message}\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      // Die the way the bridge died, so the client sees the same signal.
      for (const s of forwarded) process.removeListener(s, forward);
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code === null ? 1 : code);
  });
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return 0;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stderr.write(`${pkg.version}\n`);
    return 0;
  }
  const { site, rest } = parseArgs(argv);
  if (site !== null) runSite(parseSite(site), rest);
  else runPlatform(rest);
  return null;
}

if (require.main === module) {
  try {
    const code = main(process.argv.slice(2));
    if (code !== null) process.exit(code);
  } catch (error) {
    const usageError = error instanceof UsageError || (error && error.name === 'InvalidSiteError');
    process.stderr.write(`relayto-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    if (usageError) process.stderr.write('Run relayto-mcp --help for usage.\n');
    process.exit(usageError ? 2 : 1);
  }
}

module.exports = { parseArgs, platformBridgeArgs, UsageError };
