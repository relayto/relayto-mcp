# RELAYTO: instructions for GitHub Copilot

Follow [AGENTS.md](../AGENTS.md). In short:

- Public content on a site published with RELAYTO: its MCP server `https://<host>/mcp`
  (stdio: `npx -y relayto-mcp --site <host>`), its API via `npx relayto … --site <host>`
  or the `relayto` SDK, or `https://<host>/llms.txt` and each page's Markdown. No account.
  Gated content (private, password, email form, unlisted) is left out on purpose.
- A RELAYTO workspace the user belongs to: the RELAYTO MCP server,
  `https://mcp.relayto.com/mcp` (Streamable HTTP, OAuth sign-in), or `npx -y relayto-mcp`.
- Search before creating; confirm privacy changes, removals, overwrites and invitations.
- Hub membership tools take ids (`objectID`); settings, privacy, pages and analytics take
  slugs. Build links with `getUrlBySlug`.
- In this repository, follow the versioning rules in AGENTS.md and run `npm run check`.
