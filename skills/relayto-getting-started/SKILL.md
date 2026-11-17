---
name: relayto-getting-started
description: Connect an AI client to the RELAYTO MCP server (https://mcp.relayto.com/mcp), sign in, pick the right RELAYTO workspace and run a first task. Use when the user wants to set up RELAYTO in Claude, ChatGPT, Cursor, VS Code or another MCP client, asks which workspace the agent is working in, or when a RELAYTO tool call fails with an authentication or permission error.
license: MIT
metadata:
  publisher: RELAYTO
  homepage: https://relayto.com
---

# Getting started with the RELAYTO MCP server

RELAYTO is a platform for publishing PDFs, decks, reports and web pages as interactive
content, grouped into hubs and shared from a company's own domain with page-level
analytics. The RELAYTO MCP server lets an agent do that work for a signed-in RELAYTO
user.

- Endpoint: `https://mcp.relayto.com/mcp` (Streamable HTTP)
- Sign-in: OAuth 2.1 with PKCE and dynamic client registration. The user signs in with
  their RELAYTO account in the browser and chooses a workspace.
- Every tool runs as that user, with that user's permissions in the chosen workspace.

## Workflow

1. If RELAYTO tools such as `selectWorkspace` are already listed, the client is
   connected: go to step 4.
2. Connect the client (Connect a client).
3. The user signs in on RELAYTO's page in the browser and picks a workspace. Wait for
   that; sign-in never happens in the chat.
4. Confirm the workspace (Pick the workspace) and name it to the user.
5. Run a read-only first task (First tasks), then use the task skill for the job.

## Connect a client

Prefer a direct remote connection; fall back to the `relayto-mcp` npm bridge only for
clients that can start local (stdio) servers but not remote ones.

| Client | How |
| --- | --- |
| Claude Code | `claude mcp add --transport http relayto https://mcp.relayto.com/mcp`, then run `/mcp` to sign in |
| Claude (web, desktop) | Settings → Connectors → Add custom connector → `https://mcp.relayto.com/mcp` |
| Cursor | `~/.cursor/mcp.json`: `{"mcpServers": {"relayto": {"url": "https://mcp.relayto.com/mcp"}}}` |
| VS Code | `.vscode/mcp.json`: `{"servers": {"relayto": {"type": "http", "url": "https://mcp.relayto.com/mcp"}}}` |
| Any stdio-only client | `{"mcpServers": {"relayto": {"command": "npx", "args": ["-y", "relayto-mcp"]}}}` (Node.js 20.18.1+) |

The first connection opens RELAYTO's sign-in page. After approval the client lists the
RELAYTO tools.

## Pick the workspace

The workspace is chosen during sign-in and stays active for the session.

1. Do not ask the user to pick a workspace again unless they ask to switch.
2. To see which workspace is active, or to list the others, call `selectWorkspace`
   with no arguments.
3. To switch, call `selectWorkspace` with the workspace `slug` from that list. All later
   calls use the new workspace.
4. To run one search, create, edit, hub, privacy, file, form or analytics call in
   another workspace without switching, pass that workspace's slug as `workspace`.
   `getUrlBySlug` has no `workspace` argument and builds links for the active
   workspace, so switch with `selectWorkspace` before building a link to an item in
   another workspace.

## Inputs and outputs

- Inputs: which client the user runs, and nothing secret. `selectWorkspace` takes an
  optional `slug`; `getUrlBySlug` takes only `slug` and `itemType` (`content` or `hub`)
  and always uses the active workspace.
- Outputs: once signed in, the client lists the RELAYTO tools. `selectWorkspace` with no
  arguments lists the user's workspaces; with a `slug` it switches. Search tools return
  `objectID`, `slug` and `title` for each match. `getUrlBySlug` returns the shareable
  link: `/e/<slug>` for a content, `/hub/<slug>` for a hub.

## First tasks that are safe to try

All of these only read:

- "What's in my RELAYTO workspace?" → `searchContents` or `searchHubs` with a broad query,
  or `getWorkspaceAnalytics` to see the most visited contents.
- "Find our decks about onboarding" → `searchContentsWithAI` (topic) or `searchContents`
  (title words).
- "Give me the link" → `getUrlBySlug` with `itemType: "content"` for a content
  (`/e/<slug>`) or `itemType: "hub"` for a hub (`/hub/<slug>`).

For writing, use the task skills in this repository: `relayto-publish-content`,
`relayto-hubs-and-access` and `relayto-analytics`.

## Example

User: "Set up RELAYTO in Claude Code and show me our most visited contents."

1. Run `claude mcp add --transport http relayto https://mcp.relayto.com/mcp`, then
   `/mcp`; the user signs in and picks a workspace in the browser.
2. `selectWorkspace` `{}` → the user's workspaces; tell the user which one is active.
3. `getWorkspaceAnalytics` `{"orderBy": "visits", "limit": "5"}` → the five most visited
   contents with slug, title and visits.
4. `getUrlBySlug` `{"slug": "<slug>", "itemType": "content"}` for each → their links.

## Validation

- The RELAYTO tools are listed after sign-in. A 401 means sign-in did not finish or has
  expired (When a call fails).
- Your first answer names the active workspace, so the user can catch a wrong one before
  anything is changed.
- Links come from `getUrlBySlug`, never assembled by hand, called while the workspace
  that holds the item is active.
- Report only what the tools returned, and report a failed call as failed.

## When a call fails

| Symptom | What to do |
| --- | --- |
| 401, "access token was rejected" | Ask the user to reconnect RELAYTO in their client. For the npm bridge, delete `~/.mcp-auth` and start again. |
| 403, "not allowed" | The user's role in this workspace doesn't allow it. Tell them which action needs which role; offer `selectWorkspace` if they meant another workspace. |
| 404 | The slug doesn't match anything the user can see. Search again and use the slug from the result. |
| 409 on `updateContentPages` | Someone changed the content meanwhile. Read it again and reapply the change. |
| 429 | Wait a few seconds; send fewer items per call. |

Never ask the user for their RELAYTO password or paste tokens into the chat: sign-in only
happens in RELAYTO's own page.
