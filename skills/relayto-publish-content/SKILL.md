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

## Before you write

- Confirm the target workspace (`selectWorkspace` with no arguments) when the user
  works in several.
- Search first (`searchContents`) so you update the existing content instead of
  creating a duplicate.
- Report what you created or changed with its link. Never claim a change you did not
  get a success response for.
