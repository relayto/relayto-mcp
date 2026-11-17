---
name: relayto-analytics
description: Read and explain RELAYTO visitor analytics through the RELAYTO MCP server, for one content, a hub with everything in it, or the whole workspace; compare periods, rank what performed best, find the pages people read, and where visitors came from. Use when the user asks how a deck, report, proposal or hub performed, who viewed it, which content works best, or wants a weekly or campaign report.
license: MIT
metadata:
  publisher: RELAYTO
  homepage: https://relayto.com
---

# RELAYTO analytics

Read-only. Needs the RELAYTO MCP server (see `relayto-getting-started`). The numbers
are the same as the Analytics tabs in the RELAYTO app. The content's own team and
RELAYTO staff are left out, and times are in seconds.

## Workflow

1. Work out what to measure (one content, one hub with everything in it, or the whole
   workspace) and the period. Content and hub reports default to the last 30 days; the
   workspace ranking is all time.
2. Find the slug with `searchContents` (title words), `searchContentsWithAI` (topic) or
   `searchHubs`. If several match, ask which one, or say which one you picked.
3. Call the tool and the `report` that answer the question (Inputs). To compare periods,
   call the same report again with the other dates.
4. Write the answer (Writing the answer), then check it (Validation).

## Inputs

| Question | Tool | Inputs |
| --- | --- | --- |
| "What are our best contents?" (all time) | `getWorkspaceAnalytics` | `orderBy`: `visits`, `pageViews`, `interactions`, `avgTimeSpent` or `sumTimeSpent`; `limit` (up to 100) |
| "How did this deck do last month?" | `getContentAnalytics` | content `slug`, `report`, `date_from`, `date_to` (YYYY-MM-DD; default last 30 days) |
| "How is the investor hub doing?" | `getHubAnalytics` | hub `slug`, `report`, dates |

## Outputs

`getWorkspaceAnalytics`: one row per content, highest first, with its id, slug and title,
visits, pageViews, interactions, avgTimeSpent and sumTimeSpent.

`getContentAnalytics` `report`:

- `overview`: visitors, visits, page_views, unique_page_views, time_on_page_sum,
  time_on_page_average, plus `unattributed` views no page could be matched to.
- `timeline`: one row per day.
- `pages`: one row per page (number, label, views, time). Use it for "which pages do
  people read" and "where do they drop off".
- `referrers`, `devices`, `locations` (country, city, language).

`getHubAnalytics` `report`:

- `overview`: visitors, visits, page_views, time_on_page_sum, interactions,
  avg_visits_per_visitor.
- `contents`: each content and sub-hub's metrics, to rank them. Rows can add up to less
  than the total: `outside_items` counts views from hub sessions that left the hub's
  items.
- `timeline`, `referrers`, `devices` (percent per device), `locations`.
- `visitors`: the people who viewed the hub, named when known and anonymous otherwise.

## Writing the answer

1. Say the period and what was measured ("1 Oct to 31 Oct, Product Overview").
2. Lead with the numbers that answer the question, then one or two observations the data
   supports (the most read pages, the main referrer, a change against the previous
   period if you fetched it). Don't speculate past the data.
3. Convert seconds to minutes for people. Say when a number is zero or too small to
   read much into.

## Example

User: "How did Product Overview do in October, and which pages did people read?"

1. `searchContents` `{"q": "Product Overview"}` → the match's `objectID`, `slug` and
   `title`.
2. `getContentAnalytics` `{"slug": "<slug>", "report": "overview", "date_from":
   "2026-10-01", "date_to": "2026-10-31"}` → visitors, visits, page_views and time.
3. The same call with `"report": "pages"` → views and time for each page.
4. Answer with the period, the overview numbers, the most read pages and the time in
   minutes, all taken from those two results.

## Validation

- The period you state is the `date_from` to `date_to` you sent, or the default last 30
  days. Workspace rankings are all time; don't present them as a period.
- The content or hub is the one the user meant: its title matches the search result the
  slug came from.
- Every number in the answer comes from a tool result. Label totals or averages you
  worked out yourself; hub `contents` rows can add up to less than the hub total.
- Seconds were converted before you wrote minutes.
- A zero or empty result is an answer: say so, and don't widen the dates without telling
  the user.

## Visitor data is personal data

The hub `visitors` report and form submissions (`getFormSubmissions`) can name people
and show their email addresses. Share them only with the user who asked, only as much as
the question needs, and don't copy them into other tools or documents unless the user
asks.
