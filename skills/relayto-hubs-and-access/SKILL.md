---
name: relayto-hubs-and-access
description: Organize RELAYTO content into hubs and control who can open it, through the RELAYTO MCP server. Create, nest, reorder and rename hub items; remove items from a hub; set content and hub privacy (public, unlisted, private, password or email gate); invite people to a hub by email. Use when the user asks to build a resource center, sales kit, investor hub or benefits hub, change who can see something, or share a hub with colleagues or clients.
license: MIT
metadata:
  publisher: RELAYTO
  homepage: https://relayto.com
---

# Hubs and access in RELAYTO

A hub is a collection of contents and other hubs, with its own page
(`/hub/<slug>`), navigation, cover and analytics. Needs the RELAYTO MCP server (see
`relayto-getting-started`).

## Find what exists

- `searchHubs` (`q`) finds hubs by keyword and returns their slugs.
- `getHubItems` (hub `slug`) lists a hub's contents and sub-hubs. It needs
  `pageNumber`, `orderBy`, `nPerPage` and `contentOnly`; it can filter by
  `contentTypes` (`pdf`, `image`, `video`, `audio`, `webcontent`, `native`, `blog`,
  `link`) and `privacies` (`public`, `restricted`, `private`, `password`).
- `searchContents` / `searchContentsWithAI` find contents to add.

## Build a hub

1. `createNewHub` with `title`, and optionally `description`, `coverImage`,
   `navigation` (`topbar`, `sidebar`, `breadcrumbs`), `view` (`list`, `grid`,
   `horizontal`, `condensedList`) and `order` (`updated`, `name`, `created`, `manual`).
2. `addMultipleContentsInToHub` with the hub `slug` and `contentIds`: the contents'
   ids, not their slugs. Search results carry the id as `objectID`; `getHubItems`
   returns it with each item. Additive: nothing already in the hub is removed.
3. `addMultipleHubsInToHub` with `hubIds` (hub ids, `objectID` in `searchHubs`
   results) to nest sub-hubs.
4. `reorderHubItems` with `itemIds` in the wanted order. Listed items go first, the rest
   keep their relative order after them, and the hub switches to manual sorting.
5. `renameMultipleContentsInHub` changes the titles several contents show in this hub
   (their cards in the hub) in one call: `contents` is a list of `{id, title}` with the
   content id, and optionally `description`. The previous card titles are overwritten.
   To change a content's own title, use `updateContentSettings` instead.
6. `updateHubSettings` changes title, description, cover, custom URL (`cleanSlug`),
   view, navigation, order or pinning. Fields you send overwrite the old values.
7. Return the hub link with `getUrlBySlug` (`itemType: "hub"`).

Removing: `removeContentFromHub` and `removeHubFromHub` take an item out of this hub
only. The content or sub-hub itself still exists. RELAYTO's MCP tools never delete
contents or hubs; if the user wants that, send them to the RELAYTO app.

## Decide who can open it

Both `updateContentPrivacy` (`slugs`, one or many) and `updateHubPrivacy` (hub `slug`)
take the same `type` preset:

| type | Who can open it |
| --- | --- |
| `public` | Anyone; listed on the site and in search |
| `unlisted` | Anyone with the link |
| `private` | Only invited members, signed in |
| `password` | Anyone with the link and the password (`password`) |
| `email` | Visitors enter their email before viewing |

Rules:

- A privacy change overwrites the previous setting and changes what visitors and search
  engines see at once. State the change and get a clear yes before calling.
- Use the password the user gives you. Don't invent one, and don't repeat a password
  back in summaries. For a content that already has one, omit `password` to keep it.
- `updateContentPrivacy` reports contents it could not change under `skipped`; tell the
  user which ones and why (not found, or no edit rights).

## Invite people

`addUsersToHub` with the hub `slug`, `emails`, a `role` (`ROLE_VIEWER` unless the user
asks for more), and optionally `text` (a message) and `sendEmail`. With `sendEmail`
true, RELAYTO emails each address. Only invite addresses the user gave you, and confirm
the list and role first.
