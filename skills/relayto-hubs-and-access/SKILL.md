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

## Workflow

1. Find what exists (below), so you reuse a hub instead of making a second one.
2. Collect what the tools need: hubs by `slug`, contents and sub-hubs to add, remove or
   rename by id (`objectID` in search results, the item id in `getHubItems`).
3. For privacy changes, removals and invitations, state the change and get a clear yes.
4. Make the change: Build a hub, Decide who can open it, Invite people.
5. Check the result (Validation) and give the user the hub link from `getUrlBySlug`.

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

## Inputs and outputs

- Inputs: hub slugs from `searchHubs`; content and hub ids from search results or
  `getHubItems`; content slugs for `updateContentPrivacy`; the emails and role the user
  confirmed for `addUsersToHub`.
- Outputs: search tools return `objectID`, `slug` and `title` for each match;
  `getHubItems` returns the hub's items with their ids, one page at a time; write tools
  return the server's confirmation, and `updateContentPrivacy` lists what it could not
  change under `skipped`; `getUrlBySlug` returns the hub link.

## Example

User: "Create a hub called Q3 Sales Kit with Product Overview and Pricing Guide, and make
it unlisted."

1. `searchHubs` `{"q": "Q3 Sales Kit"}` → no match, so a new hub is needed.
2. `searchContents` `{"q": "Product Overview"}` and `{"q": "Pricing Guide"}` → each
   content's `objectID`.
3. `createNewHub` `{"title": "Q3 Sales Kit"}` → the new hub and its slug.
4. `addMultipleContentsInToHub` `{"slug": "<hub slug>", "contentIds": ["<id 1>",
   "<id 2>"]}`.
5. Ask "Make Q3 Sales Kit unlisted, so only people with the link can open it?"; after a
   yes, `updateHubPrivacy` `{"slug": "<hub slug>", "type": "unlisted"}`.
6. `getHubItems` on the hub → both contents are in it. `getUrlBySlug` `{"slug":
   "<hub slug>", "itemType": "hub"}` → the link to share.

## Validation

- After adding, removing, renaming or reordering, list the hub again with `getHubItems`
  and check that the items and their order are what the user asked for.
- After a privacy change, name every `skipped` content and the reason; never report it
  as changed.
- The hub link comes from `getUrlBySlug` with `itemType: "hub"`; an `/e/` link to a hub
  does not open it.
- Invitations went only to the addresses and role the user confirmed.
