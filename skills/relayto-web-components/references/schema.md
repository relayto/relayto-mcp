# Schema reference

The exact contract RELAYTO's web-content editor implements. The keys marked v2 are additive: `version` stays `1`, and an older editor
ignores them.

## Contents

- [Where the schema lives](#where-the-schema-lives)
- [Top level](#top-level)
- [Components](#components)
- [Fields](#fields)
- [Field types](#field-types)
- [Targets](#targets)
- [What the editor does with a field](#what-the-editor-does-with-a-field)
- [Repeated components](#repeated-components)
- [Inline components (tooltips)](#inline-components-tooltips)
- [Page values](#page-values)
- [Declared Live areas](#declared-live-areas)
- [Validation and failure](#validation-and-failure)
- [Worked examples](#worked-examples)

## Where the schema lives

```html
<script type="application/rt-components+json" id="rt-components">{ … }</script>
```

- Put it in the `<head>`. The head is kept byte for byte on save, and a script with a non-JavaScript
  type never runs.
- Visitors don't get it. `GET /api/boards/<slug>` removes a schema block in the `<head>` unless the
  requester may edit the content; `/api/boards/<slug>/noncache` and editors get the page as stored.
  A block elsewhere (a snippet without a head) stays, and costs visitors its bytes. So the page
  script must not read the schema, and a tool that reads the stored page back (to compare it with
  the built file, or to change and upload it) must use `/noncache`: uploading the anonymous copy
  drops the schema.
- The `type` is matched case-insensitively and trimmed. The `id` is conventional, not required.
- Only the first such block is read; later ones are reported and ignored. It must be inline (no
  `src`). It is raw script text, so write plain JSON: no HTML entities, no comments, no trailing
  commas.
- One schema per page. Two language editions of a page carry their own copy (usually identical
  apart from `locale.months`), with labels in the editors' language.

## Top level

```json
{"version": 1, "locale": {"months": ["…12 names…"]}, "values": {"asOf": {…}}, "components": {"<type>": {…}}}
```

| Key | Required | Meaning |
|---|---|---|
| `version` | yes | Must be the number `1`. Anything else ignores the whole schema. |
| `locale.months` | no | Exactly 12 non-empty month names for `date` fields. Default: `Jan` … `Dec`. Arabic: `يناير` … `ديسمبر`. |
| `components` | yes | Object of component types. |
| `values` (v2) | no | Page values: `{"<name>": {"label": "…", "help": "…"}}`. See [Page values](#page-values). |

Unknown keys are ignored everywhere, so the page's build tooling can add its own.

## Components

```json
"glance-spine": {"label": "Glance spine", "fields": [ … ]}
```

- The key is the type, matched exactly against `data-rt-component`. It must be an identifier:
  `[A-Za-z_][A-Za-z0-9_-]*`.
- `label` names the component in the Settings tab heading, Layers and the canvas badge. Default:
  the type. Plain text (it is escaped wherever the editor shows it).
- `fields` is a list; order is the order in Settings. A component with no usable field is dropped.

| Key (v2) | Meaning |
|---|---|
| `title` | A field name (`text`, `url`, `select` or `date`; trimmed): its value names each instance, `<label> · <value>`, in Layers, the badge and the Settings heading (one line, cut at about 48 characters). A select shows its option label; a date its `datetime` formatted by the field's `format` (a value that is not ISO shows as it is). Empty value: the label alone. A name given in Layers, or "Live · …" for a Live root, wins. Inline types are named only in their paragraph's Settings, and without a title (or with an empty one) by their own words. A title naming an unknown field is dropped with a warning. |
| `repeat` | `true`: instances of the type that share a parent are a list. See [Repeated components](#repeated-components). |
| `inline` | `true`: the type's roots sit in running text and are edited through their paragraph. See [Inline components](#inline-components-tooltips). |
| `wrap` | Inline types: `{"tag": "span", "class": "asof", "append": "<span class=\"asof__note\" data-rt-field=\"note\"></span>"}`, the markup the text toolbar makes around a selection. |
| `wrapLabel` | The toolbar button's name ("Tooltip"). Default: the label. |

## Fields

| Key | Applies to | Default | Meaning |
|---|---|---|---|
| `name` | all | required | Identifier, unique in the component. Also the default target's `data-rt-field` value. |
| `label` | all | the name | Field label in Settings. Plain text. |
| `type` | all | required | `text`, `url`, `select`, `toggle`, `date`, `image`. |
| `target` | all | `[data-rt-field="<name>"]` | CSS selector inside the root, or `:scope` for the root. |
| `attr` | text, url, select, toggle, date | url: `href`; date: `datetime` | The attribute the field edits. Lowercased. |
| `class` | toggle | — | Switch this one class instead of an attribute. Wins over `attr`. |
| `help` | all | — | A line under the control. |
| `multiline` | text | `false` | A textarea; keeps the line breaks the user types (without it they become spaces). It commits on blur; Enter adds a line. Ignored with `input: number`. |
| `maxLength` | text, url | — | Positive integer; the control stops there and longer values are refused. |
| `options` | select | required | `[{"value": "…", "label": "…"}]`. `value` is a string; `""` removes the attribute. Duplicate values are dropped; label defaults to the value. |
| `required` | text, url, select, date | `false` | An empty value (or only spaces) is refused. No effect on `toggle` or `image`. |
| `input` (v2) | text | `"text"` | `"number"`: a text box with a decimal keyboard; the value stays a string, written as typed (`0.851`). The rule is `-?[0-9]+(\.[0-9]+)?` after trimming: `+5`, `.5`, `5.`, `1e3`, `1,000`, `$5`, `5%` and `−5` are refused; leading zeros pass. |
| `min`, `max` (v2) | text with `input: number` | — | Inclusive bounds. |
| `step` (v2) | text with `input: number` | — | Positive; counted from `min` (or 0) in decimals, so `0.851` is on a `0.001` step. |
| `integer` (v2) | text with `input: number` | `false` | No decimal point (`5.0` is refused). |
| `pattern` (v2) | text | — | A JavaScript regular expression the whole value must match (anchored for you, `u` flag), tested on the value as typed, after the number rule. Empty values are not checked unless `required`. Under `u`, `\d`, `\w` and `\b` are ASCII (write `[0-9]` to say so), and `\-` outside a class, `\_`, `\#` and a lone `{` or `}` are errors: such a pattern is dropped with a warning. |
| `patternHelp` (v2) | text | "This doesn't have the expected form." | The message shown when `pattern` fails. |
| `precision` (v2) | date | `"day"` | `"day"` (a day, or a year with its "Year only" switch), `"month"` (`YYYY-MM`) or `"year"`. |
| `format` (v2) | date | `D MMM YYYY` / `MMM YYYY` / `YYYY` | The element's text, tokens `D` (not zero-padded), `MMM` (the `locale.months` name) and `YYYY`, only those of the field's precision (a month field: `MMM`, `YYYY`; a year field: `YYYY`); other text is kept as is. Each token at most once, and no other Latin letters: a typo such as `DD` or `MMMM` drops the format (the field's default is used, with a warning). |

Attributes a field may not edit: anything starting `on`, `style`, `class`, `srcdoc`,
`contenteditable`, `draggable`, `data-gjs-*`, and `data-rt-component` / `-field` / `-derived` /
`-web-block` / `-live` / `-value`. Attribute names must look like HTML attribute names (`[a-z_][a-z0-9_.:-]*`).

## Field types

| Type | Reads | Writes | Control |
|---|---|---|---|
| `text` | The target's text content, layout whitespace collapsed and the ends trimmed (a no-break space inside stays; one at either end goes), or the `attr` value | Content: replaces the target's children with one text node (escaped on save; markup typed in stays text). With `attr`: sets it, empty removes it | Input; textarea when `multiline`. Previews live while typing, commits on change |
| `url` | `attr` (default `href`) | Sets it, trimmed; empty removes it unless `required` | Input. Accepts `http(s):`, relative paths, `#…`, `mailto:`, `tel:` |
| `select` | `attr` | Sets the chosen value; `""` removes the attribute | Dropdown. A current value not in `options` shows as "value (current)" |
| `toggle` | Whether `attr` is present (or `class` is set) | Bare boolean attribute (`open`) or removes it; adds or removes the class | Checkbox |
| `date` | `attr` (default `datetime`) as `YYYY-MM-DD`, `YYYY-MM` or `YYYY`; the element's text is never parsed | The attribute, and the target's whole content as one text node by `format`: `2 Mar 2026` with `locale.months`, `Mar 2026`, or `2024` (so the target must hold nothing else). A value of another precision than the field's is refused; clearing a date that isn't `required` removes the attribute and empties the element | Day: date input with a "Year only" option (switching is an edit: `2 Mar 2026` → `2026`; `2026` → `1 Jan 2026`). Month: a month menu (always in English) and a four-digit year. Year: a year |
| `image` | The target `<img>`'s `src` | `src` from RELAYTO's image picker; drops `srcset`, `sizes`, `data-src`, `data-lazy-src`, `data-srcset`; sets `width`/`height` to the picked image | Thumbnail and "Replace image…". The target must be an `<img>` |

Any attribute named `href`, `src`, `xlink:href`, `action`, `formaction`, `data`, `poster`, `cite` or
`background` only takes a web URL, whatever the field type.

## Targets

- Default: the element with `data-rt-field="<name>"` inside the root.
- A selector is evaluated like `root.querySelectorAll(target)` in the canvas: the first match in
  document order that is an authored element of the page (not one a script built), not a derived
  node, not a nested component root, and not inside a nested component.
- `:scope` is the root itself, and also works inside a selector (`:scope > .title`).
- Several fields may share a target when they edit different things (`unit` edits the text,
  `unitShort` edits `data-short` on the same element).
- An invalid selector disables the field ("Not in this component") and logs
  `web-content-editor: field "<name>" has an invalid target "…"`.
- Targets resolve in the canvas after the page's scripts ran, so a selector may match a class the
  script added.
- A target missing in an instance disables that field in that instance ("Not in this component").

## What the editor does with a field

- **Selection.** The field's element, every element between it and the root, and — for a text
  field without `attr` and for a date field — every element inside it are not hoverable, not
  selectable and not inline-editable; clicking them selects the root. Other elements in the root
  keep normal editing.
- **Values come from the model, never the canvas,** so whatever the script shows (an opened state, a
  formatted number) never leaks into a field.
- **Undo.** Each committed edit is one undo step. Text previews in the canvas while typing and
  becomes one step when the input commits (Enter or blur).
- **Saved HTML** is the page's markup with the edit applied. Attribute order is GrapesJS's (`class`
  last), the same as for any edit in the editor.
- **Live areas.** A field whose target is inside a Live area is disabled ("Filled in by the page's
  script").
- **Page values.** A text field without `attr`, or a date field, whose element is, or holds, a
  `data-rt-value` element is disabled ("This text shows the page value …"): its first edit would
  flatten the binding. The check looks down only: a field inside a bound element stays enabled and
  is overwritten by the next page-value edit, so never put one there.
- **Web blocks.** "Save as block" keeps `data-rt-component` and `data-rt-field` (ids are stripped).
  An inserted copy is a component again wherever the host page's schema declares the type, and
  plain markup elsewhere.

## Repeated components

With `"repeat": true`, the Settings heading of a selected instance shows its position among the
instances of the type that are direct children of its parent, adjacent or not ("12 of 30"; an
instance alone in its parent shows "1 of 1"), and:

- **Previous / Next** select the neighbour instance (the page gets `rt-editor:deselect` and
  `rt-editor:select`, so it can show that card), including instances the canvas does not show;
- **Duplicate** puts a copy right after it and selects the copy;
- **Move up / Move down** swap it with its neighbour instance, past any other elements between
  them; it never leaves its parent;
- **Delete** asks for a second click (within 4 seconds).

Each action is one undo step (selecting is not) and sends the structure events (`rt-editor:add` /
`rt-editor:remove`; a move sends neither). Previous and Next always work. An instance that holds a
Live area cannot be duplicated; one inside a Live area, or Live itself, cannot be duplicated,
moved or deleted. Keep a list's instances siblings: two programmes of documents are two lists,
each in its own container. `<tr>`, `<li>`, `<dt>` and `<dd>` roots keep their table and list drag
rules and work as list items.

## Inline components (tooltips)

An `"inline": true` type's roots sit inside a sentence. They are never their own unit in the
editor (the paragraph stays one rich-text unit, typed in as before); instead:

- **Selecting the paragraph** (or clicking a tooltip in it) lists its inline components under
  Settings, in order, each named by its `title` field or its own words ("Tooltip · more than 20%"),
  with their fields. Its own words are its text without its fields' elements: any other text inside
  (a page value in the note) joins the name, so make such an element a field too. A field edit is one
  undo step. Attribute and toggle fields work, so a note can live in `data-note` and a variant
  class can be switched.
- **The paragraph** is the outermost text unit above the root, stopping at any component root
  around it (else the root's parent). So tooltips in a card's free copy are listed when that copy
  is selected, not the card; headings and `<li>` work when the editor parses them as text.
- **The text toolbar** has one button per inline type with `wrap`. While typing, select plain words
  and press it: the words are wrapped in `<tag class="…" data-rt-component="<type>">words + append</tag>`
  and Settings opens on the new component's first empty field. Spaces at either end of the selection
  stay outside. With the caret in one (where the selection starts decides), the same button reads
  "Remove <wrapLabel>" and unwraps it: the words stay; what `append` added, with whatever was typed
  into it, and the root's own attributes go. A selection that holds any tag (bold, a link, a line
  break, a page value, another inline root), or sits inside an inline root, is refused with a
  message; words inside one bold run can be wrapped.
- While the paragraph is being typed in, its inline fields wait ("Finish typing in the paragraph");
  a click in Settings ends the typing.

`wrap.tag` (default `span`) is one of the running-text elements `span`, `abbr`, `b`, `bdi`, `bdo`,
`cite`, `code`, `data`, `del`, `dfn`, `em`, `i`, `ins`, `kbd`, `mark`, `q`, `s`, `samp`, `small`,
`strong`, `sub`, `sup`, `time`, `u`, `var` (not `a`). `append` may hold text, those elements and
`br`, with `class`, `title`, `lang`, `dir`, `aria-*` and `data-*` attributes (`data-rt-field` and
`data-rt-value` included; `data-gjs-*`, `data-rt-component`, `-derived`, `-live` and `-web-block`
refused); no comments, processing instructions or CDATA. Close
elements with an end tag: HTML reads `<span/>` as an open `<span>`, so it is refused. Removing a
tooltip takes away only what `append` added at its end, matched from the end (an element by its tag
and `data-rt-field` or class, text by its characters); give the appended element a `data-rt-field`
or a class so it is never mistaken for the user's own bold or italic.

An inline root inside another component is out of that component's reach, like a nested one: a
figure whose note is its own `note` field should not also mark the note's word an inline root.

Inline types get only `rt-editor:change` (after a field edit in the paragraph's Settings, and with
`field: null` after a rich-text session or a wrap); never `select`, `deselect`, `add` or `remove`.

## Page values

```json
"values": {"asOf": {"label": "As-at date", "help": "The date the figures are as at."}}
```

```html
… <span class="asof__note">As at <span data-rt-value="asOf">30 June 2026</span></span> …
```

- Every element marked `data-rt-value="<name>"` shows that value as its whole text (text values
  only; children are flattened by the first edit). The page authors the current value in every
  bound element; they should agree.
- With nothing selected, Settings shows **Page values**: each value's field, read from the first
  bound element outside a Live area, with how many places show it and how many say something else
  (Live places counted). An edit writes every bound element, inside paragraphs and components too,
  in one undo step; it is not trimmed or checked. Bound elements in a Live area are left as they
  are; when every place is Live, or there is none, the field is disabled ("Not on this page.").
- Bound elements are not locked: inside a paragraph they can be typed over like any text, so one
  place can drift. Settings then counts it among those that say something else.
- A field may sit on the bound element itself (`<span data-rt-field="asOf" data-rt-value="asOf">`):
  it shows the value, disabled, saying it is changed under Page values. It keeps the value out of an
  inline component's name and tells the editor where the date comes from.
- Keep the bound element to the value alone (`As at <span …>30 June 2026</span>`, not the whole
  sentence), so notes that differ around it can share it.

## Declared Live areas

`data-rt-live="<name>"` on an element the page's script fills (a feed, a chart, a picker, a
ticker): it is Live from the first lock pass whatever the script does or when, named
"Live · <name>" in Layers (empty: the tag name), its fields are disabled, it cannot be dragged,
dropped into or deleted, its ancestors cannot be copied, and before a save that removed one the
editor warns "The page's script fills in “<name>”, which you removed; the page may stop working"
(by name: moving one does not warn). The attribute is kept on save and in web blocks. It replaces
the old trick of listing the container's id in an inline script so the editor would infer it; the
inference (writes seen before the page settles, then late locks) still applies on top.

## Validation and failure

- JSON that doesn't parse, a missing or wrong `version`, or no `components` object: the schema is
  ignored, the page edits as if it had none, and one console warning says why.
- An invalid component or field (bad name, unknown type, select without options, forbidden
  attribute…) is dropped with a warning; the rest still works.
- A write that fails is undone and announced; a value a rule refuses (length, URL, date, number,
  pattern) is explained under the field and the previous value stays.
- Nothing about the schema can block loading or saving.
- `scripts/check_components.py` reads the schema as JavaScript does where it matters (no `NaN`,
  `version` the number 1, ASCII digits in numbers, dates and patterns, the `u` flag's escapes);
  a pattern Python cannot compile is left for the editor to judge.

## Worked examples

From the investor relations pages of a made-up group of listed companies.

### Credit rating (the smallest useful component)

```html
<div class="c" data-rt-component="rating"><dt data-rt-field="agency">S&amp;P</dt><dd data-rt-field="grade">AA</dd></div>
```

```json
"rating": {"label": "Credit rating", "fields": [
  {"name": "agency", "label": "Agency", "type": "text"},
  {"name": "grade", "label": "Rating", "type": "text", "maxLength": 8}]}
```

### A figure with an "as of" note in an attribute

The note lives only in `data-note`; CSS shows it on hover. The note's element also wraps the value
and unit fields, which is fine: an attribute field locks its element, not its content.

```html
<div class="chap__fig" data-rt-component="chapter-figure">
  <div class="v"><span class="asof" data-note="As at 30 June 2026" data-rt-field="note"><span data-rt-field="value">c.$150</span><small data-rt-field="unit">bn</small></span></div>
  <div class="l" data-rt-field="caption">Combined market cap of the group’s listed companies</div>
</div>
```

```json
"chapter-figure": {"label": "Chapter figure", "fields": [
  {"name": "value", "label": "Figure", "type": "text"},
  {"name": "unit", "label": "Unit", "type": "text"},
  {"name": "note", "label": "As-of note", "type": "text", "attr": "data-note",
   "help": "Shown when the reader hovers the figure. Leave empty for none."},
  {"name": "caption", "label": "Caption", "type": "text", "multiline": true}]}
```

The same kind of note inside a sentence is an inline component (next example).

### A tooltip inside a sentence (inline type, with a page value)

```html
<p>Our listed companies represent <span class="asof" data-rt-component="tooltip">more than 20%<span class="asof__note"><span data-rt-field="note">As at</span> <span data-rt-field="asOf" data-rt-value="asOf">30 June 2026</span></span></span> of the ADX.</p>
```

```json
"values": {"asOf": {"label": "As-at date"}},
"components": {
  "tooltip": {"label": "Tooltip", "inline": true, "wrapLabel": "Tooltip",
    "wrap": {"tag": "span", "class": "asof", "append": "<span class=\"asof__note\"><span data-rt-field=\"note\"><\/span><\/span>"},
    "fields": [
      {"name": "note", "label": "Note", "type": "text", "multiline": true},
      {"name": "asOf", "label": "As-at date", "type": "text"},
      {"name": "long", "label": "Long note", "type": "toggle", "target": ":scope", "class": "asof--long"}]}}
```

Selecting the paragraph lists "Tooltip · more than 20%": Note edits "As at", As-at date shows
the date disabled (it changes under Page values, for every note at once), Long note switches the
wide variant. A note without a date has no `asOf` element, so that field reads "Not in this
component". Editors add a tooltip by selecting words and pressing **Tooltip** in the text toolbar;
the new note is the empty inner span. The page's CSS shows the bubble when a child of the note is
non-empty (`.asof:has(>.asof__note>:not(:empty))`), so an emptied note leaves plain words. Without
the `asOf` field the name would read "more than 20% 30 June 2026".

### A timeline milestone (repeated, numbers, a month)

```html
<div class="story__ms" data-rt-component="story-milestone" data-kind="transition" data-value="4.4">
  <div class="meta"><time class="yr" datetime="2025-03" data-rt-field="when">2025</time>…</div>
  <div class="t" data-rt-field="title">Formation of Northwind Materials</div>
</div>
```

```json
"story-milestone": {"label": "Story milestone", "title": "title", "repeat": true, "fields": [
  {"name": "title", "label": "Title", "type": "text"},
  {"name": "when", "label": "When", "type": "date", "precision": "month", "format": "YYYY"},
  {"name": "value", "label": "Capital added ($bn)", "type": "text", "target": ":scope", "attr": "data-value",
   "input": "number", "min": 0, "step": 0.001},
  {"name": "kind", "label": "Family", "type": "select", "target": ":scope", "attr": "data-kind",
   "options": [{"value": "capital", "label": "Capital & investment"}, {"value": "transition", "label": "Lower-carbon"}]}]}
```

Layers reads "Story milestone · Formation of Northwind Materials"; Settings shows "30 of 30" with
Previous, Next, Duplicate, Move up/down and Delete; "3bn" is refused in the value; the month menu
and year write `datetime="2026-03"` and the text `2026`. The script that draws the chart from the
milestones redraws on `rt-editor:change`, `rt-editor:remove` and `rt-editor:add`.

### A document row: link, date, languages

```html
<a class="mb-row" data-rt-component="document" href="/cdn/…/trust-deed.pdf" target="_blank" hreflang="en">
  <span class="d"><time datetime="2026-01-12" data-rt-field="date">12 يناير 2026</time></span>
  <span class="t" data-rt-field="title">صك الائتمان</span>
</a>
```

```json
"document": {"label": "Document", "fields": [
  {"name": "title", "label": "Title", "type": "text", "multiline": true},
  {"name": "date", "label": "Date", "type": "date"},
  {"name": "file", "label": "PDF", "type": "url", "target": ":scope"},
  {"name": "pdfLang", "label": "PDF language", "type": "select", "target": ":scope", "attr": "hreflang",
   "options": [{"value": "", "label": "Same as the page"}, {"value": "en", "label": "English"}]},
  {"name": "titleLang", "label": "Title language", "type": "select", "target": "[data-rt-field=title]", "attr": "lang",
   "options": [{"value": "", "label": "Same as the page"}, {"value": "en", "label": "English"}]}]}
```

The Arabic page adds `"locale": {"months": ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"]}`.
Year-only rows (`<time datetime="2024">2024</time>`) keep their precision. A row with a period
instead of a date (`H1 2026`) is a different type with a `text` field.

### A company card: link card, photo, icon, free copy

```html
<a class="ch reveal" data-rt-component="champion" href="https://investors.example.com/" target="_blank">
  <div class="ch__photo"><img class="ch__img" data-rt-field="photo" src="…/company-materials.webp" alt=""/><img class="ch__badge" data-rt-field="badge" src="…/icon-flask.png" alt=""/></div>
  <div class="ch__top"><div><div class="ch__nm" data-rt-field="name">Northwind Materials</div><div class="ch__tk" data-rt-field="ticker">Listed since 2021</div></div></div>
  <div class="ch__copy">…inline-editable body copy…</div>
</a>
```

```json
"champion": {"label": "Listed company card", "fields": [
  {"name": "name", "label": "Company", "type": "text"},
  {"name": "ticker", "label": "Ticker line", "type": "text"},
  {"name": "link", "label": "IR page", "type": "url", "target": ":scope"},
  {"name": "photo", "label": "Photo", "type": "image"},
  {"name": "badge", "label": "Icon", "type": "image"}]}
```

`.ch__copy` is a sibling of the field elements, so it keeps inline editing; `.ch__top` and its inner
`<div>` wrap fields, so a click there selects the card.

### FAQ item with an authored open state

```html
<details class="faq" data-rt-component="faq" open>
  <summary data-rt-field="question">Which of the group’s companies are listed?</summary>
  <div class="a">…inline-editable answer…</div>
</details>
```

```json
"faq": {"label": "FAQ", "fields": [
  {"name": "question", "label": "Question", "type": "text"},
  {"name": "open", "label": "Open when the page loads", "type": "toggle", "target": ":scope", "attr": "open"}]}
```

Opening an item by clicking it in the canvas is browser state and isn't saved; the toggle is what
writes `open`.
