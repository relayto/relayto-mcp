---
name: relayto-publish-content
description: Create and edit RELAYTO content through the RELAYTO MCP server, from a PDF link, a web link, raw HTML, an image or video, or a written blog post; edit titles, pages and settings; host the CSS, images and fonts a page links to; and attach a form that collects submissions. Use when the user asks to turn a PDF or page into an interactive RELAYTO experience, publish or update a post, change a content's title or slug, or add a contact or enrollment form.
license: MIT
metadata:
  publisher: RELAYTO
  homepage: https://relayto.com
---

# Publish and edit RELAYTO content

Needs the RELAYTO MCP server (see `relayto-getting-started`). All calls act in the
active workspace as the signed-in user.

## Workflow

1. Confirm the target workspace (`selectWorkspace` with no arguments) when the user
   works in several.
2. Search first (`searchContents`) so you update the existing content instead of
   creating a duplicate.
3. Create the content (Create content) or change it (Edit content). Host the files a
   page links to (Workspace files) and add a form (Forms) when the page needs them.
4. Put it in a hub and set who can open it, if the user said so.
5. Check the result (Validation) and report it with its link.

## Create content

Pick the tool by what the user has:

| The user has | Tool | Key inputs |
| --- | --- | --- |
| A link to a PDF | `createContentByPdfUrl` | `url` (public PDF URL), `aiDetailsProcessing` (`"true"` to let RELAYTO write the title, summary and tags), optional `hubSlug` |
| A web page to embed | `createContent` | `contentType: "link"`, `url`; title and description are fetched from the page |
| HTML they wrote or you generated | `createContent` | `contentType: "webcontent"`, `html` (raw HTML, never wrapped in `<iframe>`) |
| A post to write in RELAYTO | `createContent` | `contentType: "blog"`, `title`, `html` (the body) |
| An image or video file | `createContent` | `contentType: "image"` or `"video"`, `url` of a file already uploaded to the RELAYTO CDN (see Workspace files) |

Then:

1. Pass `hubSlug` at creation, or add the content to a hub afterwards with
   `addMultipleContentsInToHub` (see `relayto-hubs-and-access`).
2. Give the user the link: `getUrlBySlug` with `itemType: "content"` and the new slug.
3. If the user said who should be able to open it (public, unlisted, private, password
   or email gate), set that explicitly afterwards (see `relayto-hubs-and-access`)
   rather than assuming what the new content defaults to.

PDF conversion runs on RELAYTO's side; a large PDF can take a while before every page
is interactive. Say so instead of retrying the call.

## Edit content

- Title, subtitle, description, cover image, custom URL (`cleanSlug`), downloads,
  cloning, comments, AI chat: `updateContentSettings` with the content `slug`. Only the
  fields you send change. Changing `cleanSlug` changes the public URL; old URLs
  redirect, but confirm with the user first.
- Pages (slides): `updateContentPages`. Address each page by its existing `id` and send
  only the fields to change. On an existing page, `title` and `embed.html` only change
  for accounts with embed-code permission. A 409 means the content changed since you
  read it: read again, then reapply.
- A blog post's body: `updateContentPages` with one page whose text is the new body HTML.

## Workspace files (CSS, JS, fonts, images, video)

Pages and custom CSS link to files hosted on the RELAYTO CDN at permanent URLs.
Workspace admins only.

1. `listWorkspaceFiles` shows folders, allowed extensions and size limits.
2. `uploadWorkspaceFile` with a `path` such as `css/brand.css` and exactly one of
   `content` (text), `contentBase64` (bytes) or `sourceUrl` (a public URL to copy).
   An existing path is refused unless `overwrite: true`; replacing keeps the URL, so
   every page that links it changes at once. Ask before overwriting.
3. Before deleting, call `getWorkspaceFileUsage` for the path or folder and show the
   user which contents still link it. `deleteWorkspaceFiles` breaks those pages at
   once.

## Forms

For a page that collects answers (contact, enrollment, registration, survey):

1. `createForm` with a `name`, and either `fields` or the form's `html`, plus
   `notifyEmails` and `successMessage` if the user gave them.
2. The result's `connect` block has the submit `endpoint`, a `helperSnippet` and an
   `aiPrompt` with exact wiring instructions. Follow it: the page POSTs once, at the
   final submit, with every answer at the top level under a stable camelCase name.
3. Read answers later with `listForms` and `getFormSubmissions` (`formKey`).

Collect only the fields the user asked for. Do not add fields for sensitive data
(government IDs, card numbers, health details) unless the user insists and understands
where it goes.

## Inputs and outputs

- Inputs: what the user has (a public PDF or page URL, HTML, a post's title and body, a
  file), the slug of a content to edit (from `searchContents`), and the hub slug if it
  goes in a hub.
- Outputs: the create tools return the new content with its slug; `getUrlBySlug` turns
  it into the `/e/<slug>` link. `uploadWorkspaceFile` returns the file's final `path`
  and public `url`. `createForm` returns `connect` (`endpoint`, `jsonExample`,
  `helperSnippet`, `aiPrompt`). `updateContentPages` lists pages that matched nothing
  under `skippedPages`.

## Example

User: "Turn our 2025 annual report PDF into an interactive RELAYTO content and put it in
the Investors hub", with a link to the PDF.

1. `searchContents` `{"q": "annual report 2025"}` → no existing content to update.
2. `searchHubs` `{"q": "Investors"}` → the hub's slug.
3. `createContentByPdfUrl` `{"url": "<the PDF link the user gave>",
   "aiDetailsProcessing": "true", "hubSlug": "<hub slug>"}` → the new content's slug.
4. `getUrlBySlug` `{"slug": "<new slug>", "itemType": "content"}` → its link.
5. Reply with the link and the hub, and say a long PDF can take a few minutes before
   every page is interactive.

## Validation

- Report only what the server confirmed. Name anything under `skipped` or
  `skippedPages`, and treat a 409 or a `conflict` as not done.
- Build links with `getUrlBySlug` from the slug the create call returned. If a create
  call failed or timed out, search for the title before trying again, so you don't make
  a duplicate.
- After uploading, use the `url` the upload returned: the stored path can differ from
  the one you sent (spaces become `-`).
- Before overwriting or deleting a workspace file, `getWorkspaceFileUsage` shows the
  contents that link it; tell the user which.
