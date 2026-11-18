---
name: relayto-web-content
description: Build a hand-made HTML page and publish it to RELAYTO as web content through the RELAYTO MCP server. Host its CSS, JS, fonts and images in the workspace's Workspace Files, write it so it renders correctly in RELAYTO's viewer (a shadow root under the toolbar) and stays editable in the web-content editor, link it to other RELAYTO contents (open a PDF in the viewer on a given page, in a lightbox, inside a hub), give it a thumbnail, create or update the content, and check it published and in the editor. Use it whenever you build, publish, update or debug a landing page, microsite, one-pager or interactive section that lives in RELAYTO, even if the request only says "put this page on RELAYTO", "upload my HTML", "make a RELAYTO landing page", "host the assets", "link the page to our documents" or "the page looks different in RELAYTO".
license: MIT
metadata:
  publisher: RELAYTO
  homepage: https://relayto.com
---

# Web content for RELAYTO

A RELAYTO web content is one HTML page stored on a content and drawn by RELAYTO's viewer, with
RELAYTO's toolbar, AI chat, analytics and editor around it. This skill is the whole path from an
empty folder to a published, editable page. Editability itself (the component schema, the
`data-rt-*` markers, the page script's contract with the editor) is the `relayto-web-components`
skill: load it before writing markup, and follow it for every component.

## 0. Preflight

- **The RELAYTO MCP server.** You need its tools (`createContent`, `uploadWorkspaceFile`,
  `listWorkspaceFiles`, `updateContentPages`, `createNewHub`…). If they are missing, stop and tell
  the user to connect `https://mcp.relayto.com/mcp` (sign-in with their RELAYTO account; in Claude it
  is the "RELAYTO AI" connector, in Claude Code `claude mcp add --transport http relayto
  https://mcp.relayto.com/mcp`).
- **The workspace.** Decide it once and pass `workspace: "<slug>"` on every call, rather than
  switching the session with `selectWorkspace`: a page and its assets in two workspaces is the
  hardest mistake to notice.
- **Admin rights.** `listWorkspaceFiles` returns `canManage`. Uploading Workspace Files is for
  workspace admins only. If `canManage` is false, stop and explain: the user needs a workspace
  admin to make them admin, or to run this for them. Do not fall back to inlining images or fonts
  into the HTML: the editor and the chat index both work through the stored HTML, and megabytes
  of base64 make both slow and fragile.

## 1. Lay out the files

Work locally first, in a folder per page version:

```
<page>/
  index.html        the page: content and component markers only
  styles.css        all CSS
  app.js            all JS (one IIFE)
  assets/           images, logo, fonts (woff2)
```

In Workspace Files mirror it under one folder per page **version**, e.g.
`pages/<page-slug>/<yyyymmdd>/css/styles.css`, `…/js/app.js`, `…/img/…`, `…/fonts/…`.
Overwriting a file keeps its URL and every page linking it picks up the new version, which is
what you want while iterating on one version, and exactly what you don't want for an earlier
version someone has already been sent. A new version gets a new folder.

Lay the local folder out exactly like the version folder (`css/`, `js/`, `img/`, `fonts/` next to
`index.html`), so `url(../fonts/…)` in the CSS resolves the same locally and published. Only the
HTML needs absolute URLs when you publish: on RELAYTO it is served at `/e/<slug>`, where relative
paths point nowhere.

Keep CSS and JS in their own files rather than inline. The stored HTML is then only content and
markers, which is what editors change in the editor, and a later restyle overwrites `styles.css`
without touching HTML someone has edited. Link an empty `css/overrides.css` after `styles.css`
from the start: every byte you upload passes through the conversation, and a QA fix is then a few
lines instead of the whole stylesheet again.

## 2. Write the page for RELAYTO's viewer

The viewer draws a full HTML document in a **shadow root** inside the app, under the RELAYTO
toolbar, and runs its scripts in the app's own window against a stand-in `document` and `window`.
Most pages just work. These rules cover the ones that don't:

- **A full document.** Start with `<!doctype html><html lang=…><head>…</head><body>…</body></html>`.
  Only a full document gets the shadow-root renderer, in-app link routing and running scripts in
  the page; a fragment is put in an iframe instead.
- **`html`, `body`, `:root`, `rem` and `@font-face` work.** The viewer points root selectors at
  stand-in elements, moves `@font-face` rules to the document (a shadow root ignores them) and
  rewrites `rem` when the page sets its own root font size. Linked stylesheets are fetched and
  inlined; their relative `url()`s resolve against the sheet. Workspace Files are served with
  `Access-Control-Allow-Origin: *`, so linking `styles.css` from there works.
- **Don't size by the window.** `100vh` and `innerHeight` are the browser window, which is taller
  than the box the page scrolls in (the toolbar sits above it). A `100vh` hero overshoots and its
  bottom edge hides under the fold. Use `min-height: min(100svh - 64px, 920px)` or let content set
  the height. A design system that sizes its screens in `svh` can keep them and fit only the first
  screen to the box in the viewer: `[data-rt-html] .hero { height: calc(100svh - 64px); }`
  (`[data-rt-html]` is the viewer's stand-in for `<html>`, so the rule never applies elsewhere).
- **A fixed header pins to the page's box.** The viewer makes the box the containing block of
  `position: fixed`, so a fixed bar at `top: 0` sits under RELAYTO's 64 px bar (which also holds a
  hub's top bar), like a sticky one. Keep it one opaque bar; a sticky nav works the same way.
- **Keep the top-right corner clear.** When the workspace has a call-to-action button ("Contact
  us"), RELAYTO floats it at the top right of the page's box on every screen, over the page's own
  header actions. Leave about 130 × 60 px free there (padding on the header bar), on phones too.
- **Keep the bottom-right corner clear.** RELAYTO's floating controls (AI chat, CTA, fullscreen)
  sit there, and the proactive chat bubble opens there on desktop about 10 seconds after load. Don't
  put a primary action, a chart legend or the share price in the bottom-right 120 × 120 px of any
  screen-filling section.
- **One IIFE, no globals.** Page globals land on the app's `window` and outlive the page. Wrap
  `app.js` in `(() => { … })();`, use `const`/`let`, and never rely on `document.write` or on a
  vendor script that finds itself through `document.currentScript` (embed snippets like
  TradingView's do: build their iframe yourself, see `references/embeds.md`).
- **`#section` links scroll in the page.** The viewer catches a click on `href="#results"` and
  scrolls the box to the element with that id (less the page's `scroll-padding-top` and the target's
  `scroll-margin-top`, so a fixed nav's height works as usual). Scripts that read `location.hash` or
  build `#` URLs themselves see the app's address, not the page's: keep in-page navigation to plain
  `#id` links, or a `<button>` that calls `scrollIntoView`.
- **Scroll effects through IntersectionObserver.** It works as usual. Scroll listeners must read
  `document.scrollingElement.scrollTop`, which the viewer answers for the page's box; the real
  window doesn't scroll.
- **Motion respects the editor.** The editor forces reduced motion for scripts and marks
  `<html data-rt-editor>`; key editor-safe CSS on `html[data-rt-motion=reduce]` (see
  `relayto-web-components`).
- **External links** open in a new tab: `target="_blank" rel="noopener"`.

## 3. Link to other RELAYTO contents

A same-origin link with no `#` and no file extension in its path is routed inside the app, without
a reload. Use relative paths so the page works on any workspace domain:

| Goal | Link |
|---|---|
| Open a content (a PDF in the viewer) inside a hub | `/e/<contentCode>?hub=<hubCode>` (the code keeps working when the slug is renamed) |
| … on a given page | `/e/<contentCode>?hub=<hubCode>&page=<n>` (n is the **0-based** page index: PDF page 7 is `page=6`) |
| Open the hub | `/hub/<hubSlug>` |

`?hub=` takes the hub's **code** when the hub has a custom URL (`cleanSlug`); its slug otherwise.
Keeping the `hub` parameter keeps the hub's navigation around the document and a way back to the
page. Leave `target` empty so the link stays in the app.

**A reference to one page opens in a lightbox, not a new view.** When the page cites a page of a
document ("Q3 slides, p. 10", a highlight, a source note), the visitor should see that page over
the current one and stay where they were. Upload `assets/rt-page-lightbox.js` next to the page's
script and load it before `</body>`: every `/e/<slug>?…&page=<n>` link then opens RELAYTO's embed
of the document on that page (`/e/<slug>?embed=1&w=2&page=<n>`) in an overlay with "Open the full
document" and close (Escape, the button, the backdrop). Links without `page=` ("Open the report")
navigate as before. `data-rt-lightbox-title` on a link sets the overlay's title; `data-rt-lightbox="off"`
opts a link out. The embed of a private or restricted content refuses to load: keep linked documents
unlisted or public.

## 4. What the AI chat reads

RELAYTO indexes a web content for its AI content chat from the **stored HTML's visible text**,
re-indexed on every save. Text that a script renders is not in the index. Put every fact a visitor
might ask about in markup: KPI values, chart data (as a table the chart is drawn from), document
highlights, dates. New web contents get the chat and the proactive bubble by default; there is
nothing to switch on.

## 5. Upload the assets

`uploadWorkspaceFile` with `path` under the version folder and one of:

- `sourceUrl`: a public URL RELAYTO downloads (remote images, logos, font files). Fastest, and the
  bytes never pass through the conversation. Sites behind bot protection may refuse RELAYTO's
  fetcher (`sourceUrl answered HTTP 403/406`), especially for several requests in a row: one at a
  time per host, and wait before retrying.
- `content`: text files (`css`, `js`, `svg`, `json`).
- `contentBase64`: avoid. The bytes are retyped through the conversation, and a long base64 string
  comes out corrupted (a 17 KB PNG arrived 38 bytes short). For a binary you made locally (a
  rendered thumbnail, a cropped image), make it reachable at a temporary public URL with
  `scripts/share-file.sh start <file>` (a Cloudflare quick tunnel serving that one file), upload it
  by `sourceUrl`, then `scripts/share-file.sh stop`. Always verify a binary upload: download the
  returned URL and compare its checksum with the local file.

Use the `url` the response returns: the stored path can differ from the one you asked for (spaces
become `-`). An existing path answers `conflict` unless `overwrite: true`. Allowed extensions and
size limits are in `listWorkspaceFiles`'s `limits` (fonts `woff2`, `woff`, `ttf`, `otf`; images up
to 20 MB; video and documents up to 95 MB).

Upload images and fonts first, rewrite the local paths in `styles.css` and `index.html` to the
returned URLs, then upload `styles.css` and `app.js`, then create the content.

Browsers keep Workspace Files for 5 minutes (`max-age=300`). After overwriting a file, check it
in a fresh browser profile or a private window, or wait.

## 6. Create or update the content

**No RELAYTO default call to action.** RELAYTO gives every new content a "Contact us" button (a
mailto to whoever created it), which floats over the page. Turn it off on every content you create,
the page and every document: `updateContentSettings({slug, showCta: false, workspace})`. If the
server has no `showCta` yet, list "turn off the call-to-action in each content's Settings" as a
manual step.

**Create** with `createContent`:

```json
{"contentType": "webcontent", "type": "webcontent", "title": "…", "description": "…",
 "html": "<!doctype html>…", "hubSlug": "<hub slug, optional>", "workspace": "<slug>"}
```

Send the raw HTML document, never wrapped in an `<iframe>`. Through the MCP server, a selected
workspace is enough permission for raw HTML. The response is the whole content including the
stored HTML (too long to show in full; it is saved to a file): check that
`boardResources[0].embed.html` equals what you sent and that `hasChatText` is `true`.

RELAYTO may name the content after the first URL in the page instead of your `title` (one page
came out as "cdn.relayto.com", with a slug to match), so always follow up with
`updateContentSettings({slug, title, description, cleanSlug})`. Then set privacy with `updateContentPrivacy`
(`unlisted`, `public`, …) and the slug with `updateContentSettings` (`cleanSlug`) if you want a
readable URL. `getUrlBySlug` gives the public URL.

**Update** the HTML with `updateContentPages`: address the page by its `id`, send `embed.html`.
Prefer changing `styles.css` / `app.js` (overwrite) when the change is visual: the stored HTML may
hold edits someone made in the editor since you published, and replacing it discards them.

## 6b. Give it a thumbnail

Every page gets a designed cover: it is what a hub card, search and a link preview (Slack, email,
LinkedIn) show. Without one, the hub card is a grey placeholder next to the documents' covers.

1. **Design it as part of the page,** in `thumbnail.html` at 1600 × 900: the page's own palette,
   fonts and logo, and one idea from the page (its headline, one key figure, its signature shape).
   It is read at 330 px wide on a card, so the main words are at least 120 px tall, there are at most
   eight large words, and nothing important sits in the outer 5%. Flat colour and type compress to a
   small, crisp PNG; leave photographs out unless the brand depends on one.
   `references/thumbnail-example.html` is a worked example (an IR portal: logo, a two-line title,
   a key-figure card, a brand band).
2. **Render** it with headless Chrome:
   `"<chrome>" --headless=new --hide-scrollbars --allow-file-access-from-files --window-size=1600,900 --virtual-time-budget=4000 --screenshot=thumbnail.png file://<abs path>/thumbnail.html`.
   Look at it.
3. **Shrink** it without changing pixels: a palette PNG (Clop, `pngquant`) is typically 15 to 30 KB.
   Keep PNG (or JPEG) rather than WebP: some link previews ignore WebP.
4. **Upload** it to the page's version folder (`img/thumbnail.png`) through `scripts/share-file.sh`
   and `sourceUrl` (§5), and verify the checksum.
5. **Set it:** `updateContentSettings({slug, image: <the CDN url>, workspace})`. That writes the
   content's cover, marked custom so reprocessing keeps it. Check the hub card shows it.

## 7. Check

1. **Validator** (from `relayto-web-components`): `python3 <that skill>/scripts/check_components.py index.html`.
   No errors; read every warning. It reads inline scripts only, so with an external `app.js` its
   note that no script listens for `rt-editor:` events does not apply.
2. **Published page** in a real browser, desktop (1440 × 900) and mobile (390 × 844). With Node and
   Chrome, `node scripts/page-qa.mjs <url> <outDir>` does the mechanical part: screenshots of every
   screen of the viewer's scroll box on both, the chat bubble after 12 s, fonts used vs. loaded,
   iframes, the internal links and where the first few land, console and HTTP errors (errors from
   RELAYTO's own app around the page, such as its service worker, are not the page's). Then look at
   every screenshot. Check:
   the first screen, every section, fonts loaded (not the fallback), images, every link to another
   content opening the right page in the viewer, no console errors, nothing hidden under the
   toolbar or the floating controls. Wait 12 seconds on desktop and check the chat bubble does not
   cover anything important.
3. **Editor** (Edit on the content): no `web-content-editor: page components:` warning in the
   console, Layers names each component by its schema label, a click on any component (including
   closed or hidden ones) shows its fields in Settings, nothing you expected to edit is "Live · …".

Fix, re-upload, re-check. Report the page URL, the version folder, and anything you could not
check.

## Symptoms

| You see | Cause | Fix |
|---|---|---|
| The page shows inside a fixed-height box with its own scrollbar | It is a fragment, not a full document | Add `<!doctype html><html><head>…<body>` |
| Fonts fall back to Arial | The font URL 404s, the file type is wrong, or the `@font-face` `url()` is relative to a page path that doesn't exist | Use the Workspace Files URL the upload returned |
| The hero's bottom is cut off on load | `100vh` | Use `min(100svh - 64px, …)` or content height |
| Clicking a section link reloads the whole app | A `#` URL a script builds or follows itself (`location.hash = …`) | A plain `href="#id"` link, or a button + `scrollIntoView` |
| A link to a document opens a new RELAYTO tab or reloads | `target="_blank"`, an absolute URL to another host, or a `#page=` hash | Relative `/e/<slug>?hub=…&page=n`, no target |
| An embed widget is empty, console says it could not self-replace | The vendor script needs `document.currentScript` | Build the iframe yourself (`references/embeds.md`) |
| The chat answers "I don't have that information" about a number on the page | The number is drawn by script | Put it in the markup |
| An old version of the page changed | Two versions share a Workspace Files folder | One folder per version |
