# relayto-mcp

RELAYTO's MCP servers for MCP clients that start local (stdio) servers.

[RELAYTO](https://relayto.com) publishes PDFs, decks, reports and web pages as
interactive content, on `*.relayto.com` addresses and on publishers' own domains.
This package gives a local MCP client two ways in:

| | Read a published site | Work in your RELAYTO workspace |
| --- | --- | --- |
| Command | `npx -y relayto-mcp --site <host>` | `npx -y relayto-mcp` |
| Connects to | `https://<host>/mcp`, the site's public MCP server | `https://mcp.relayto.com/mcp`, RELAYTO's platform server |
| Sign-in | none | your RELAYTO account (OAuth, in the browser) |
| Tools | `search_content`, `list_hubs`, `get_content` (read-only) | search, create, organize, share and measure content |
| MCP Registry | `com.relayto/site-content` | `com.relayto/mcp` |

If your client supports remote MCP servers (Claude, ChatGPT, Cursor, VS Code and
others do), connect it straight to the URL in the table instead; you don't need this
package.

## Read a site published with RELAYTO

```json
{
  "mcpServers": {
    "benefits": {
      "command": "npx",
      "args": ["-y", "relayto-mcp", "--site", "benefits.relayto.com"]
    }
  }
}
```

`--site` takes the site's host name only: a `*.relayto.com` address or the publisher's
own domain, https only, with no path, port or credentials (`--site=<host>` works too).
The bridge forwards every MCP message to `https://<host>/mcp` and writes the answers
back. It needs no sign-in, stores nothing on disk, and works with clients on any MCP
version the site's server supports, including stateless 2026-07-28 sessions.

The site's server returns only public material: private, password, sign-in and
email-gated pages are never served. Its tools:

- `search_content`: find documents, hubs and pages by topic.
- `list_hubs`: browse the hubs (curated collections) and pages, or one hub's items.
- `get_content`: read a page as Markdown, in chunks for long ones.

The same site also has a REST API (`https://<host>/api/site/v1`) and a CLI and SDK
for it: [`relayto`](https://www.npmjs.com/package/relayto).

## Work in your RELAYTO workspace

```json
{
  "mcpServers": {
    "relayto": {
      "command": "npx",
      "args": ["-y", "relayto-mcp"]
    }
  }
}
```

On first start a browser window opens on RELAYTO's sign-in page; pick the workspace to
use and approve access. Tokens are cached in `~/.mcp-auth` (or `MCP_REMOTE_CONFIG_DIR`);
delete that folder to sign out everywhere.

The tools come from the hosted server, so they stay current without updating this
package: search contents and hubs, create content from a PDF URL, a link, HTML or a
blog post, edit pages and settings, build and reorder hubs, set privacy (public,
unlisted, private, password, email gate), invite people to a hub, host workspace files,
create forms and read their submissions, and read content, hub and workspace
analytics. Every call runs as the signed-in user, with that user's permissions in the
chosen workspace.

Extra arguments go to [mcp-remote](https://github.com/punkpeye/mcp-remote), which does
the stdio-to-HTTP bridging and the OAuth flow in this mode:

```sh
npx -y relayto-mcp --debug        # write a debug log to ~/.mcp-auth
npx -y relayto-mcp 3456           # fixed port for the OAuth callback
```

## Requirements and exit codes

Node.js 20.18.1 or later. `relayto-mcp --help` prints the usage. Exit codes: 0 when
the client closes the connection, 1 on a failure, 2 on bad arguments (for example an
invalid `--site`). Only MCP messages are written to stdout; diagnostics go to stderr.

## Links

- RELAYTO: https://relayto.com
- Source: https://github.com/relayto/relayto-mcp
- Skills, agent rules and plugin: https://github.com/relayto/agent-skills
- MCP Registry: `com.relayto/site-content` (this package) and `com.relayto/mcp`

## License

MIT
