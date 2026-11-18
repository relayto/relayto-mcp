# RELAYTO MCP servers, SDK, CLI, skills and agent plugin

Connect AI agents and developers to [RELAYTO](https://relayto.com), the platform that
turns PDFs, decks, reports and web pages into interactive content, organizes it into
hubs, publishes it on `*.relayto.com` or your own domain and measures it page by page.

Developer docs: [RELAYTO API, MCP server & SDK](https://relayto.com/hub/api).

This repository has everything an agent needs:

- **Every site published with RELAYTO** serves a public, read-only MCP server at
  `https://<site>/mcp` and a REST API at `https://<site>/api/site/v1`, with no sign-in.
  See [Read any site published with RELAYTO](#read-any-site-published-with-relayto).
- **The RELAYTO platform MCP server**: `https://mcp.relayto.com/mcp`, hosted by RELAYTO.
  Sign in with your RELAYTO account and work in your workspace.
- **[`relayto-mcp`](packages/relayto-mcp) on npm**: both servers for clients that only
  start local servers (`npx -y relayto-mcp --site <host>`, or `npx -y relayto-mcp`).
- **[`relayto`](packages/relayto) on npm**: the SDK and CLI for the site API
  (`npx relayto search "<query>" --site <host>`).
- **Agent Skills** for building RELAYTO web pages and reading sites published on RELAYTO.
- **An Agent Plugin** (`plugin.json` + `mcp.json`) that bundles the platform server and
  the skills, also packaged for Claude Code (`.claude-plugin/`).
- **Agent rules** for coding tools: [AGENTS.md](AGENTS.md), `.claude/CLAUDE.md`,
  `.cursor/rules/`, `.windsurf/rules/`, `.github/copilot-instructions.md`.

## Read any site published with RELAYTO

Every site published with RELAYTO, on a `*.relayto.com` address or on the publisher's
own domain, offers the same public, read-only ways in. Replace `<site>` with its host
name, for example `benefits.relayto.com`. They return only what any visitor can open
without signing in.

| | |
| --- | --- |
| MCP server | `https://<site>/mcp` (Streamable HTTP, no sign-in). Tools: `search_content`, `list_hubs`, `get_content` |
| MCP Registry | `com.relayto/site-content` (remote URL template `https://{site}/mcp`) |
| Stdio bridge | `npx -y relayto-mcp --site <site>` |
| REST API | `https://<site>/api/site/v1`, OpenAPI at `https://<site>/openapi.json`, reference at `https://<site>/developers` |
| CLI | `npx relayto search "<query>" --site <site>`, `relayto hubs`, `relayto get <url-or-slug>` |
| SDK | `npm install relayto`, then `new RelaytoSite('<site>')` |
| For LLMs | `https://<site>/llms.txt`, and any page as Markdown at `<page URL>.md` |

```sh
# Claude Code: one site's MCP server
claude mcp add --transport http benefits https://benefits.relayto.com/mcp

# A stdio-only client
npx -y relayto-mcp --site benefits.relayto.com

# The terminal
npx relayto search "open enrollment" --site benefits.relayto.com
npx relayto get https://benefits.relayto.com/e/what-is-open-enrollment-4uoe8tjxhumq6
```

```ts
import { RelaytoSite } from 'relayto';

const site = new RelaytoSite('benefits.relayto.com');
for await (const hub of site.allHubs()) console.log(hub.title, hub.url);
```

See [packages/relayto](packages/relayto) for the full CLI and SDK reference.

## RELAYTO platform MCP server

| | |
| --- | --- |
| Endpoint | `https://mcp.relayto.com/mcp` |
| Transport | Streamable HTTP |
| Sign-in | OAuth 2.1 with PKCE (S256) and dynamic client registration; you pick the workspace when you sign in |
| MCP Registry | `com.relayto/mcp` |
| npm | [`relayto-mcp`](https://www.npmjs.com/package/relayto-mcp) |

What it can do, as the signed-in user and within that user's permissions:

- **Find**: search contents by title or by topic, search hubs, list a hub's items.
- **Publish**: create content from a PDF link, a web link, raw HTML, an image, a video or
  a written post; edit pages, titles, slugs and settings.
- **Organize**: create hubs, add, nest, reorder and rename items, remove items from a hub.
- **Control access**: public, unlisted, private, password or email gate, per content or
  hub; invite people to a hub by email.
- **Build pages**: host CSS, JS, fonts and images on the RELAYTO CDN; create forms and
  read their submissions.
- **Measure**: content, hub and workspace analytics: visitors, pages read, referrers,
  devices, locations.

The tools never delete contents or hubs.

### Connect

**Claude Code**

```sh
claude mcp add --transport http relayto https://mcp.relayto.com/mcp
```

**Claude (web and desktop)**: Settings → Connectors → Add custom connector →
`https://mcp.relayto.com/mcp`.

**Cursor** (`~/.cursor/mcp.json`)

```json
{ "mcpServers": { "relayto": { "url": "https://mcp.relayto.com/mcp" } } }
```

**VS Code** (`.vscode/mcp.json`)

```json
{ "servers": { "relayto": { "type": "http", "url": "https://mcp.relayto.com/mcp" } } }
```

**Any client that starts local (stdio) servers** (Node.js 20.18.1 or later)

```json
{ "mcpServers": { "relayto": { "command": "npx", "args": ["-y", "relayto-mcp"] } } }
```

The first connection opens RELAYTO's sign-in page in your browser.

## Skills

```sh
npx skills add relayto/relayto-mcp
```

In Claude Code, install the server and the skills together as a plugin:

```
/plugin install relayto --marketplace relayto/relayto-mcp
```

| Skill | What it teaches an agent |
| --- | --- |
| [relayto-web-content](skills/relayto-web-content/SKILL.md) | Build a hand-made HTML page and publish it to RELAYTO: assets in Workspace Files, the viewer's rules, links that open a document on a page, a thumbnail, checks |
| [relayto-web-components](skills/relayto-web-components/SKILL.md) | Make that page editable in RELAYTO's web-content editor: the component schema, field markers, a page script that works with the editor, and a validator |
| [relayto-read-published-site](skills/relayto-read-published-site/SKILL.md) | Read and cite any site published on RELAYTO through its MCP server, API, llms.txt and Markdown, no account needed |

The web-page skills need the platform MCP server (`https://mcp.relayto.com/mcp`, see
[AGENTS.md](AGENTS.md#connect-the-mcp-server)) and admin rights in the workspace, since
Workspace Files uploads are admin-only.

## Repository layout

| Path | What |
| --- | --- |
| `servers/mcp/server.json` | MCP Registry entry `com.relayto/mcp`: the platform server, remote only |
| `servers/mcp/server-card.json` | Its server card, served at `https://mcp.relayto.com/mcp/server-card` |
| `servers/site-content/server.json` | MCP Registry entry `com.relayto/site-content`: every site's server (`https://{site}/mcp`) and the `relayto-mcp` package with `--site` |
| `packages/relayto-mcp/` | npm `relayto-mcp`: stdio bridge (`--site`: built in, no dependencies; sign-in mode: mcp-remote) |
| `packages/relayto/` | npm `relayto`: TypeScript SDK and CLI for the site API, no runtime dependencies |
| `skills/` | Agent Skills |
| `plugin.json`, `mcp.json`, `.claude-plugin/`, `.mcp.json` | Agent Plugin manifests |
| `scripts/validate.mjs` | Checks every manifest against its schema and the files against each other |
| `scripts/smoke.mjs` | Smoke test of the SDK against live sites |

```sh
npm install
npm run check        # validate.mjs, build, then both packages' unit tests
npm run smoke        # SDK against benefits.relayto.com (RELAYTO_SMOKE_SITES for others)
```

## Security

- The MCP server only acts for a signed-in RELAYTO user, in the workspace they chose,
  with their permissions. Sign-in happens on RELAYTO's own page; agents never see your
  password.
- In sign-in mode, `relayto-mcp` caches OAuth tokens in `~/.mcp-auth` on your machine.
  Delete that folder to sign out. With `--site` it stores nothing and sends no
  credentials.
- The site servers, the site API, `relayto` and `relayto-mcp --site` only ever return
  what a site's visitors can open without signing in.
- Report security issues to support@relayto.com.

## Links

- Developer docs: https://relayto.com/hub/api
- MCP server guide: https://relayto.com/explore/relayto-mcp-server
- Site API guide: https://relayto.com/explore/relayto-site-api
- SDK and CLI guide: https://relayto.com/explore/relayto-sdk

## License

[MIT](LICENSE)
