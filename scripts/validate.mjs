#!/usr/bin/env node
// Validates every publishable file in this repository against its spec:
//   servers/*/server.json   official MCP Registry schema (2025-12-11) + registry rules,
//                           including the npm mcpName arrangement between the entries
//   servers/mcp/server-card.json   MCP Server Card schema (v1, ext-server-card)
//   plugin.json        Agent Plugins 1.0.0 manifest schema + ChatGPT directory limits
//   mcp.json           Agent Plugins 1.0.0 MCP schema
//   skills/*/SKILL.md  Agent Skills frontmatter rules
//   packages/*/package.json   what the registry and ora need from the two npm packages
// and that the files agree with each other. Exits non-zero on any problem.
//
// Usage: npm install && node scripts/validate.mjs

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const Ajv2020 = require('ajv/dist/2020').default;
const Ajv07 = require('ajv').default;
const addFormats = require('ajv-formats').default ?? require('ajv-formats');

const problems = [];
const passed = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);
const ok = (msg) => passed.push(msg);
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const schema = (name) => readJson(`scripts/schemas/${name}`);

function compile(s) {
  const draft = String(s.$schema || '');
  const ajv = draft.includes('2020-12')
    ? new Ajv2020({ allErrors: true, strict: false })
    : new Ajv07({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(s);
}

function check(where, data, s) {
  const validate = compile(s);
  if (validate(data)) {
    ok(`${where} matches ${s.$id || s.title || 'its schema'}`);
    return true;
  }
  for (const e of validate.errors) fail(where, `${e.instancePath || '/'} ${e.message}`);
  return false;
}

const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

function pngSize(file) {
  const b = readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// ---- servers/*/server.json (MCP Registry) -----------------------------------
// The registry schema file wraps ServerDetail; validate against that definition.
const regSchema = schema('server.schema.2025-12-11.json');
const ENTRIES = {
  platform: { file: 'servers/mcp/server.json', name: 'com.relayto/mcp' },
  site: { file: 'servers/site-content/server.json', name: 'com.relayto/site-content' },
};
const PACKAGES = {
  'relayto-mcp': { dir: 'packages/relayto-mcp', bin: 'relayto-mcp' },
  relayto: { dir: 'packages/relayto', bin: 'relayto' },
};
const REPO_URL = 'https://github.com/relayto/relayto-mcp';
const templateVars = (u) => [...u.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const filled = (u) => u.replace(/\{[^}]+\}/g, 'placeholder.example.com');

const servers = {};
for (const [key, entry] of Object.entries(ENTRIES)) {
  const where = entry.file;
  const server = readJson(where);
  servers[key] = server;
  check(where, server, { ...regSchema, $ref: '#/definitions/ServerDetail' });
  if (server.name !== entry.name) fail(where, `name ${server.name} is not ${entry.name} (other workers and the site links use exactly this name)`);
  if (!/^com\.relayto(\.[a-z0-9-]+)*\//.test(server.name)) fail(where, `name ${server.name} is not in the com.relayto namespace`);
  if (server.description.length > 100) fail(where, 'description is over 100 characters');
  if (!server.title || !(server.icons || []).length) fail(where, 'title and icons are needed for registry branding');
  for (const icon of server.icons || []) if (!isHttps(icon.src)) fail(where, `icon ${icon.src} is not https`);
  if (server.websiteUrl && !isHttps(server.websiteUrl)) fail(where, 'websiteUrl must be https');
  for (const remote of server.remotes || []) {
    // Same rules as the registry: https after filling template variables, every
    // variable defined, no localhost.
    if (!isHttps(filled(remote.url))) fail(where, `remote ${remote.url} is not https`);
    const used = templateVars(remote.url);
    const defined = Object.keys(remote.variables || {});
    for (const v of used) if (!defined.includes(v)) fail(where, `remote ${remote.url} uses {${v}}, which variables does not define`);
    for (const v of defined) if (!used.includes(v)) fail(where, `variables.${v} is not used in ${remote.url}`);
    for (const [v, def] of Object.entries(remote.variables || {})) {
      if (!def.description || def.description.length < 20) fail(where, `variables.${v} needs a clear description`);
      if (def.isRequired !== true) fail(where, `variables.${v} must be isRequired (there is no sensible default site)`);
    }
  }
  ok(`${where} is ${server.name}, valid against the registry schema and rules`);
}

// repository: this repo holds the bridge and SDK packages, the skills and the entries,
// not either server's source (rt-mcp-proxy and the backend are private). So only what
// is built from this repo points at it: the npm packages, and the site-content entry's
// package (the registry schema has no per-package repository, so the entry's own
// repository with subfolder packages/relayto-mcp is that pointer). The platform entry
// and the server cards carry none.
if ('repository' in servers.platform) fail(ENTRIES.platform.file, 'must not have repository: the repo does not hold the platform server\'s source');
{
  const repo = servers.site.repository;
  if (!repo || repo.url !== REPO_URL || repo.source !== 'github' || repo.subfolder !== PACKAGES['relayto-mcp'].dir) {
    fail(ENTRIES.site.file, `repository must be {url: ${REPO_URL}, source: github, subfolder: ${PACKAGES['relayto-mcp'].dir}}, the package it lists`);
  } else if (!existsSync(join(root, repo.subfolder))) fail(ENTRIES.site.file, `repository.subfolder ${repo.subfolder} does not exist`);
}
ok('repository: only the site-content entry (its relayto-mcp package) and the npm packages point at this repo');

// The platform entry: a fixed remote, no template, no package (see the mcpName rule).
const platform = servers.platform;
if ((platform.remotes || []).length !== 1 || platform.remotes[0].url !== 'https://mcp.relayto.com/mcp') fail(ENTRIES.platform.file, 'must have exactly the remote https://mcp.relayto.com/mcp');
if ((platform.packages || []).length) fail(ENTRIES.platform.file, 'must not list packages: relayto-mcp declares mcpName com.relayto/site-content, so the registry would reject it here');

// The site entry: the per-site URL template, and the relayto-mcp package with --site.
const site = servers.site;
const siteRemote = (site.remotes || [])[0];
if (!siteRemote || siteRemote.url !== 'https://{site}/mcp' || (site.remotes || []).length !== 1) fail(ENTRIES.site.file, 'must have exactly the remote https://{site}/mcp');
const siteArg = (site.packages || []).find((p) => p.identifier === 'relayto-mcp')?.packageArguments?.find((a) => a.name === '--site');
if (!siteArg || siteArg.type !== 'named' || siteArg.isRequired !== true) fail(ENTRIES.site.file, 'the relayto-mcp package must take a required named --site argument');

// ---- server card (platform) --------------------------------------------------
const card = readJson('servers/mcp/server-card.json');
// The ext-server-card schema file only holds $defs; validate against the ServerCard one.
check('servers/mcp/server-card.json', card, { ...schema('server-card.schema.v1.json'), $ref: '#/$defs/ServerCard' });
for (const key of ['name', 'title', 'description', 'version', 'websiteUrl']) {
  if (JSON.stringify(card[key]) !== JSON.stringify(platform[key])) fail('servers/mcp/server-card.json', `${key} differs from servers/mcp/server.json`);
}
if (JSON.stringify(card.remotes) !== JSON.stringify(platform.remotes)) fail('servers/mcp/server-card.json', 'remotes differ from servers/mcp/server.json');
if (JSON.stringify(card.icons) !== JSON.stringify(platform.icons)) fail('servers/mcp/server-card.json', 'icons differ from servers/mcp/server.json');
if (!card.title || !card.description || !(card.icons || []).length) fail('servers/mcp/server-card.json', 'title, description and icons are all needed for registry branding');
if ('tools' in card) fail('servers/mcp/server-card.json', 'a v1 server card must not list tools');
if ('repository' in card) fail('servers/mcp/server-card.json', 'must not have repository: the repo does not hold the server\'s source');

// ---- npm packages --------------------------------------------------------------
const pkgs = {};
for (const [name, spec] of Object.entries(PACKAGES)) {
  const where = `${spec.dir}/package.json`;
  const pkg = readJson(where);
  pkgs[name] = pkg;
  if (pkg.name !== name) fail(where, `name ${pkg.name} is not ${name}`);
  if (!pkg.bin || pkg.bin[spec.bin] === undefined) fail(where, `no bin "${spec.bin}", so npx cannot start it (ora counts a package only when its latest version declares a bin)`);
  if (pkg.homepage !== 'https://relayto.com') fail(where, 'homepage must be https://relayto.com (how ora ties the package to RELAYTO)');
  if (pkg.repository?.url !== `git+${REPO_URL}.git`) fail(where, `repository.url must be git+${REPO_URL}.git`);
  if (pkg.repository?.directory !== spec.dir) fail(where, `repository.directory must be ${spec.dir}`);
  if (pkg.bugs?.url !== `${REPO_URL}/issues`) fail(where, 'bugs.url must be the repo issues page');
  if (pkg.license !== 'MIT' || !existsSync(join(root, spec.dir, 'LICENSE'))) fail(where, 'license must be MIT with a LICENSE file');
  if (!existsSync(join(root, spec.dir, 'README.md'))) fail(where, 'README.md is missing');
  if (pkg.publishConfig?.access !== 'public') fail(where, 'publishConfig.access must be public');
  for (const [dep, range] of Object.entries(pkg.dependencies || {})) {
    if (!/^\d+\.\d+\.\d+$/.test(range)) fail(where, `${dep} is not pinned to an exact version (${range})`);
  }
  for (const [dep, range] of Object.entries(pkg.devDependencies || {})) {
    if (!/^\d+\.\d+\.\d+$/.test(range)) fail(where, `devDependency ${dep} is not pinned to an exact version (${range})`);
  }
  for (const f of pkg.files || []) if (!['README.md', 'LICENSE'].includes(f) && !existsSync(join(root, spec.dir, f.replace(/\/$/, ''))) && f !== 'dist/') fail(where, `files entry ${f} does not exist`);
  ok(`${where}: bin ${spec.bin}, homepage, repository, license and pinned dependencies`);
}

// relayto-mcp: the MCP bridge. Its mcpName decides which registry entry may list it.
const bridge = pkgs['relayto-mcp'];
const bridgeDir = PACKAGES['relayto-mcp'].dir;
if (!/\bmcp\b/.test(bridge.name.replace(/[-_/@]/g, ' '))) fail(`${bridgeDir}/package.json`, 'package name has no "mcp" word (ora looks for one)');
for (const target of Object.values(bridge.bin || {})) if (!existsSync(join(root, bridgeDir, target))) fail(`${bridgeDir}/package.json`, `bin target ${target} is missing`);

// The registry checks, at publish, that each npm package's mcpName equals the
// name of the entry that lists it (exact string match, one name per version).
const listing = {};
for (const [key, server] of Object.entries(servers)) {
  for (const p of server.packages || []) {
    if (p.registryType !== 'npm') continue;
    (listing[p.identifier] ||= []).push(key);
    const pkg = pkgs[p.identifier];
    const where = ENTRIES[key].file;
    if (!pkg) {
      fail(where, `lists npm package ${p.identifier}, which is not in this repository`);
      continue;
    }
    if (pkg.mcpName !== server.name) fail(where, `lists ${p.identifier}, whose mcpName is ${pkg.mcpName}, not ${server.name}: the registry rejects the publish`);
    if (p.version !== pkg.version) fail(where, `packages[${p.identifier}].version ${p.version} != package.json ${pkg.version}`);
    if (p.transport?.type !== 'stdio') fail(where, `${p.identifier} transport must be stdio`);
    if (p.registryBaseUrl && p.registryBaseUrl !== 'https://registry.npmjs.org') fail(where, 'registryBaseUrl must be https://registry.npmjs.org');
  }
}
for (const [id, keys] of Object.entries(listing)) if (keys.length > 1) fail('servers', `${id} is listed by ${keys.length} entries; one package version has one mcpName`);
if (bridge.mcpName !== ENTRIES.site.name) fail(`${bridgeDir}/package.json`, `mcpName must be ${ENTRIES.site.name}, the entry that lists it`);
if (site.version !== bridge.version) fail(ENTRIES.site.file, `version ${site.version} != relayto-mcp ${bridge.version} (bump both together)`);
ok('mcpName arrangement: relayto-mcp backs com.relayto/site-content only; com.relayto/mcp is remote-only');

// relayto: the SDK and CLI. No runtime dependencies, typed, ESM.
const sdk = pkgs.relayto;
const sdkDir = PACKAGES.relayto.dir;
if (Object.keys(sdk.dependencies || {}).length) fail(`${sdkDir}/package.json`, 'the SDK must not have runtime dependencies');
if (sdk.type !== 'module' || sdk.exports?.['.']?.types !== './dist/index.d.ts' || sdk.types !== './dist/index.d.ts') fail(`${sdkDir}/package.json`, 'must be ESM with types at ./dist/index.d.ts');
if (sdk.scripts?.prepack !== 'npm run build') fail(`${sdkDir}/package.json`, 'prepack must build, so npm pack and publish never ship a stale dist/');
const sdkBin = sdk.bin?.relayto;
if (typeof sdkBin !== 'string' || !existsSync(join(root, sdkDir, 'src', sdkBin.replace(/^dist\//, '').replace(/\.js$/, '.ts')))) fail(`${sdkDir}/package.json`, `bin ${sdkBin} has no source in src/`);
if (sdk.keywords?.includes('mcp')) fail(`${sdkDir}/package.json`, 'the SDK is not an MCP server; keep "mcp" out of its keywords');
ok('relayto: ESM, typed, no runtime dependencies, builds on pack');

// ---- plugin.json + mcp.json (Agent Plugins, ChatGPT directory) -------------
const plugin = readJson('plugin.json');
check('plugin.json', plugin, schema('agent-plugins-plugin.schema.1.0.0.json'));
const mcp = readJson('mcp.json');
check('mcp.json', mcp, schema('agent-plugins-mcp.schema.1.0.0.json'));
if (plugin.version !== platform.version) fail('plugin.json', `version ${plugin.version} != servers/mcp/server.json ${platform.version}`);
const claudePlugin = readJson('.claude-plugin/plugin.json');
if (claudePlugin.version !== platform.version) fail('.claude-plugin/plugin.json', `version ${claudePlugin.version} != servers/mcp/server.json ${platform.version}`);
if (claudePlugin.name !== plugin.name) fail('.claude-plugin/plugin.json', `name ${claudePlugin.name} != plugin.json ${plugin.name}`);
// Homepages: one RELAYTO address everywhere, the entries' websiteUrl (relayto.com/mcp
// is not a page today).
for (const [where, manifest] of [['plugin.json', plugin], ['.claude-plugin/plugin.json', claudePlugin]]) {
  if (manifest.homepage !== platform.websiteUrl) fail(where, `homepage ${manifest.homepage} != ${platform.websiteUrl} (servers/mcp/server.json websiteUrl)`);
}
const claudeMcp = readJson('.mcp.json');
for (const remote of platform.remotes) {
  if (!Object.values(claudeMcp.mcpServers).some((s) => s.url === remote.url)) fail('.mcp.json', `does not list ${remote.url}`);
}
const mcpUrls = Object.values(mcp.mcpServers).map((s) => s.url);
for (const remote of platform.remotes) if (!mcpUrls.includes(remote.url)) fail('mcp.json', `does not list ${remote.url}`);

const openai = plugin.extensions?.['com.openai'];
if (openai) {
  const ui = openai.interface || {};
  const limits = { displayName: 30, shortDescription: 30, longDescription: 4000, developerName: 80 };
  for (const [key, max] of Object.entries(limits)) {
    if (!ui[key]) fail('plugin.json', `com.openai.interface.${key} is required`);
    else if (ui[key].length > max) fail('plugin.json', `com.openai.interface.${key} is over ${max} characters`);
  }
  if (/\b(mcp|plugin)\b/i.test(ui.displayName || '')) fail('plugin.json', 'displayName must not append "MCP" or "Plugin"');
  const prompts = [].concat(ui.defaultPrompt || []);
  if (prompts.length > 3) fail('plugin.json', 'more than 3 defaultPrompt entries');
  for (const p of prompts) if (p.length > 128 || p.includes('@')) fail('plugin.json', `defaultPrompt "${p}" is too long or has an @mention`);
  for (const c of ui.capabilities || []) if (c.length > 120) fail('plugin.json', `capability "${c}" is over 120 characters`);
  if ((ui.capabilities || []).length > 20) fail('plugin.json', 'more than 20 capabilities');
  for (const key of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    if (ui[key] !== undefined && !isHttps(ui[key])) fail('plugin.json', `${key} must be https`);
  }
  for (const key of ['brandColor', 'brandColorDark']) {
    if (ui[key] !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(ui[key])) fail('plugin.json', `${key} must be #RRGGBB`);
  }
  for (const key of ['logo', 'logoDark', 'composerIcon', 'composerIconDark']) {
    if (ui[key] === undefined) continue;
    if (!ui[key].startsWith('./')) fail('plugin.json', `${key} must be a ./ path`);
    const file = join(root, ui[key]);
    if (!existsSync(file)) {
      fail('plugin.json', `${key} file ${ui[key]} is missing`);
      continue;
    }
    const size = pngSize(file);
    if (!size || size.width !== size.height || size.width < 48 || size.width > 4096) fail('plugin.json', `${key} must be a square PNG between 48 and 4096 px`);
    if (statSync(file).size > 5 * 1024 * 1024) fail('plugin.json', `${key} is over 5 MiB`);
  }
  if (openai.onboardingSkill && !existsSync(join(root, openai.onboardingSkill))) fail('plugin.json', `onboardingSkill ${openai.onboardingSkill} is missing`);
  const cases = openai.review?.test_cases;
  if (cases) {
    if ((cases.positive || []).length !== 5) fail('plugin.json', 'ChatGPT review needs exactly five positive test cases');
    if ((cases.negative || []).length !== 3) fail('plugin.json', 'ChatGPT review needs exactly three negative test cases');
  }
  ok('plugin.json com.openai listing is within the ChatGPT directory limits');
}

// ---- skills ----------------------------------------------------------------
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const out = {};
  let parent = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const nested = line.match(/^ {2}([A-Za-z0-9_-]+):\s*(.*)$/);
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested && parent) out[parent][nested[1]] = nested[2];
    else if (top) {
      if (top[2] === '') {
        parent = top[1];
        out[parent] = {};
      } else {
        parent = null;
        out[top[1]] = top[2];
      }
    } else return { __error: `cannot parse line "${line}"` };
  }
  return out;
}

const skillDirs = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory());
const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
for (const dir of skillDirs) {
  const where = `skills/${dir.name}/SKILL.md`;
  const file = join(root, where);
  if (!existsSync(file)) {
    fail(where, 'missing');
    continue;
  }
  const fm = frontmatter(readFileSync(file, 'utf8'));
  if (!fm) {
    fail(where, 'no YAML frontmatter');
    continue;
  }
  if (fm.__error) fail(where, fm.__error);
  for (const key of Object.keys(fm)) if (!allowed.has(key)) fail(where, `unknown frontmatter field ${key}`);
  const name = fm.name || '';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) fail(where, `name "${name}" breaks the Agent Skills name rules`);
  if (name !== dir.name) fail(where, `name "${name}" != folder "${dir.name}"`);
  const description = fm.description || '';
  if (!description || description.length > 1024) fail(where, `description must be 1-1024 characters (has ${description.length})`);
  if (fm.compatibility && fm.compatibility.length > 500) fail(where, 'compatibility is over 500 characters');
  if (fm.metadata?.homepage && fm.metadata.homepage !== platform.websiteUrl) fail(where, `metadata.homepage ${fm.metadata.homepage} != ${platform.websiteUrl}`);
}
ok(`${skillDirs.length} skills checked against the Agent Skills frontmatter rules`);

// ---- report ----------------------------------------------------------------
for (const line of passed) console.log(`ok   ${line}`);
for (const line of problems) console.log(`FAIL ${line}`);
console.log(problems.length ? `\n${problems.length} problem(s)` : '\nall checks passed');
process.exit(problems.length ? 1 : 0);
