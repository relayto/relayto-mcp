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
