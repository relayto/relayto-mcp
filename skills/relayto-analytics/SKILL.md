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

## Pick the tool

| Question | Tool | Inputs |
| --- | --- | --- |
| "What are our best contents?" (all time) | `getWorkspaceAnalytics` | `orderBy`: `visits`, `pageViews`, `interactions`, `avgTimeSpent` or `sumTimeSpent`; `limit` (up to 100) |
| "How did this deck do last month?" | `getContentAnalytics` | content `slug`, `report`, `date_from`, `date_to` (YYYY-MM-DD; default last 30 days) |
| "How is the investor hub doing?" | `getHubAnalytics` | hub `slug`, `report`, dates |

Find slugs first with `searchContents`, `searchContentsWithAI` or `searchHubs`.

## Reports

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
4. To compare periods, call the same report twice with different dates.

## Visitor data is personal data

The hub `visitors` report and form submissions (`getFormSubmissions`) can name people
and show their email addresses. Share them only with the user who asked, only as much as
the question needs, and don't copy them into other tools or documents unless the user
asks.
