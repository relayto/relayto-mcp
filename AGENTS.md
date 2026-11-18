# AGENTS.md: RELAYTO for AI coding agents

Instructions for coding agents (Claude Code, Codex, Cursor, Windsurf, Copilot and
others) that work with RELAYTO, and for agents editing this repository.

RELAYTO (https://relayto.com) publishes PDFs, decks, reports and web pages as
interactive content, groups them into hubs, serves them on RELAYTO subdomains or a
company's own domain, and measures them page by page.

## Two ways in. Pick by whose content it is

1. **Public content on a site published with RELAYTO.** No account. Every such site
   serves a read-only MCP server at `https://<host>/mcp` (`search_content`,
   `list_hubs`, `get_content`; stdio: `npx -y relayto-mcp --site <host>`), a REST API
   at `https://<host>/api/site/v1` (CLI and SDK: `npx relayto … --site <host>`, the
   `relayto` npm package), `https://<host>/llms.txt`, and the Markdown version of any
   page (`<page URL>.md`, or the page URL with `Accept: text/markdown`). Details: the
   `relayto-read-published-site` skill. Don't scrape the JavaScript viewer, and don't
   try to read content the publisher has gated (private, password, email form,
   unlisted): every one of these leaves it out on purpose.
2. **A RELAYTO workspace the user belongs to.** Use the RELAYTO MCP server at
   `https://mcp.relayto.com/mcp` (Streamable HTTP, OAuth sign-in with the user's
   RELAYTO account). It can search, create and edit contents, build hubs, set privacy,
   invite people, host files, create forms and read analytics, always as the signed-in
   user. Connect it as below; the web-page skills below build on it.

## Connect the MCP server

```sh
# Claude Code
claude mcp add --transport http relayto https://mcp.relayto.com/mcp
```

```json
// Cursor (~/.cursor/mcp.json) and most clients with remote MCP support
{ "mcpServers": { "relayto": { "url": "https://mcp.relayto.com/mcp" } } }
```

```json
// Clients that only start local servers: the npm bridge (Node.js 20.18.1+)
{ "mcpServers": { "relayto": { "command": "npx", "args": ["-y", "relayto-mcp"] } } }
```

## Skills in this repository

| Skill | Use it to |
| --- | --- |
| `skills/relayto-web-content` | build a hand-made HTML page and publish it to RELAYTO: Workspace Files, the viewer's rules, document links, thumbnail, checks |
| `skills/relayto-web-components` | make that page editable in RELAYTO's web-content editor (component schema, markers, page script, validator) |
| `skills/relayto-read-published-site` | read and cite a RELAYTO-published site without an account |

Install them with `npx skills add relayto/relayto-mcp`, or load the whole repository as
an Agent Plugin (`plugin.json`, `mcp.json`).

## Rules that keep agents out of trouble

- Search before you create, so you update the existing content instead of making a
  duplicate.
- Privacy changes, hub removals, settings overwrites, file overwrites and invitations
  have effects people outside the chat see at once. State the change and get a clear yes
  first.
- Ids and slugs are different things: hub membership tools take content and hub ids
  (`objectID` in search results); settings, privacy, pages and analytics take slugs.
- Links: `/e/<slug>` is a content and `/hub/<slug>` is a hub. Build them with
  `getUrlBySlug` rather than by hand.
- Never ask for the user's RELAYTO password and never put tokens in files or chat.
- Report only changes the server confirmed.

## Working on this repository

Layout:

- `skills/<name>/SKILL.md`: Agent Skills (https://agentskills.io/specification). The
  `name` in the frontmatter must equal the folder name; keep `description` under 1024
  characters and say when to use the skill.
- `plugin.json` + `mcp.json`: the Agent Plugins manifest
  (https://agent-plugins.org/specification). `extensions.com.openai` holds the ChatGPT
  directory listing.
- `servers/mcp/server.json`: the official MCP Registry entry `com.relayto/mcp`, the
  platform server, remote only.
- `servers/mcp/server-card.json`: its server card, served by the RELAYTO MCP server at
  `https://mcp.relayto.com/mcp/server-card`.
- `servers/site-content/server.json`: the MCP Registry entry `com.relayto/site-content`:
  every site's server (`https://{site}/mcp`) and the `relayto-mcp` package with `--site`.
- `packages/relayto-mcp/`: the `relayto-mcp` npm package, a stdio bridge (`--site`:
  built in, no dependencies; without it: mcp-remote with OAuth). Its `mcpName` is
  `com.relayto/site-content`: the registry lets one package version back one entry.
- `packages/relayto/`: the `relayto` npm package, the TypeScript SDK and CLI for the
  site API, with no runtime dependencies.
- `test-fixtures/site-hosts.json`: the `--site` rules both packages must agree on.
- `.claude-plugin/` + `.mcp.json`: the same plugin in Claude Code's format, and its
  marketplace entry.
- `.claude/CLAUDE.md`, `.cursor/rules/`, `.windsurf/rules/`,
  `.github/copilot-instructions.md`: short versions of this file for each tool.

When you change something:

- A registry version can't be republished, so bump `version` for every metadata change:
  `servers/site-content/server.json` together with `packages/relayto-mcp` (its
  `packages[0].version` too); `servers/mcp/server.json` together with
  `server-card.json`, `plugin.json` and `.claude-plugin/plugin.json`. `relayto` has its
  own version.
- Keep `description` in both `server.json` files and the card at 100 characters or
  fewer.
- Describe tools only as the live server behaves. Check the tool list
  (`tools/list` after signing in) before documenting a tool or parameter.
- Don't add endpoints, URLs or claims that don't answer today.
- Run `npm install && npm run check` (validator, build, unit tests) before opening a
  pull request, and `npm run smoke` after changing the SDK.
