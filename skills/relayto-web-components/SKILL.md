---
name: relayto-web-components
description: Package a hand-built HTML page (RELAYTO web content) so RELAYTO's web-content editor recognises its custom components and shows their fields in the Settings tab, with the `application/rt-components+json` schema in the head, `data-rt-component` / `data-rt-field` markers, `data-rt-derived` for what the page script draws, `data-rt-live` for what it fills, `data-rt-value` for page values, repeated and inline (tooltip) types, and a page script that cooperates with the editor (`rt-editor:*` events). Use it whenever you build, convert, review or debug an HTML page, landing page or web block that will be uploaded to RELAYTO as web content and should stay editable (stat cards, figures with notes, tooltips, timelines, carousels, tabs, FAQs, document lists, team cards), also when the request only says "make this editable in RELAYTO", "add fields for the editor", "the editor locks this as Live" or "the closed panels are blank in the editor".
license: MIT
metadata:
  publisher: RELAYTO
  homepage: https://relayto.com
---

# Editable components for RELAYTO web content

RELAYTO's web-content editor opens a hand-built page in place and lets people edit it without
touching code. Out of the box it edits visible text, links and images. Everything else — text
hidden behind a click, values that live in attributes, parts the page's script draws — is only
editable if the page **declares it as a component with fields**. This skill is how to package a
page so the editor can do that, and so the page's script and the editor don't fight.

## How the editor treats a page

Keep this model in mind; every rule below follows from it.

- **The stored HTML is the page.** The editor edits the body markup only. The `<head>`, every
  `<script>`, `<style>` and `<link>` are kept byte for byte. What gets saved is ordinary markup: no
  editor attributes, no editor classes.
- **The page runs in the editor.** Its CSS and scripts run inside the editor canvas, so the page
  looks and behaves as it does published. `<html data-rt-editor data-rt-motion="reduce">` tells the
  page it is in the editor, and reduced motion is forced there for scripts
  (`matchMedia('(prefers-reduced-motion: reduce)')` matches). CSS media queries still follow the
  system, so key editor CSS on `html[data-rt-motion=reduce]` or `html[data-rt-editor]`, never on
  `@media (prefers-reduced-motion)` alone: a list that pans for visitors but wraps under reduced
  motion, `scroll-behavior: smooth`, progress rails of an autoplay.
- **Script output is protected.** When a script writes content into the DOM, the editor locks that
  area as **Live** (named "Live · …" in Layers, not editable, its ancestors not copyable), so a
  script's output is never baked into the saved HTML. Say so up front with `data-rt-live="<name>"`
  on the container the script fills. Attribute and class changes (`aria-expanded`, `is-open`) are
  fine: they show in the canvas, lock nothing, and are never saved; inside a paragraph, though, any
  change the script makes turns that paragraph read-only.
- **A declared component becomes one unit.** A click anywhere on its fields selects the whole
  component; the Settings tab lists its fields; an edit writes plain markup into the right element
  or attribute and is one undo step. A repeated type also gets its position and Previous, Next,
  Duplicate, Move up/down and Delete in Settings. The editor tells the page script what was
  selected, changed, removed and added, through events in the canvas.

A page without a schema is edited exactly as before, so everything here is opt-in and safe to add
to a page that is already live.

## Workflow

1. **Pick the components** (below). Anything repeated, hidden, attribute-valued or script-drawn.
2. **Mark up** each instance: `data-rt-component` on the root, `data-rt-field` on each value.
3. **Write the schema** in the `<head>`: types, fields, field types.
4. **Make the page script editor-aware**: mark what it draws `data-rt-derived`, answer the editor
   events, skip autoplay.
5. **Check**: run `scripts/check_components.py` on the page, then open it in the editor.

## 1. Pick the components

Declare a component when an editor would otherwise be stuck:

| Content | What to declare |
|---|---|
| Text the reader only sees after a click, hover or timer (a closed spine, an inactive tab, a slide off screen) | A component: it can't be clicked in the canvas |
| A value that lives in an attribute: `data-note`, `<time datetime>`, `hreflang`, a variant like `data-fam` | A component: inline editing only reaches visible text |
| A repeated unit (card, stat, row, FAQ item) | A component with `"title"` (names each one in Layers) and `"repeat": true` (list actions in Settings) |
| A boolean state that should be authored (`<details open>`) | A `toggle` field |
| A note or definition on a few words inside a sentence (a tooltip) | An `"inline": true` type with `"wrap"`, so the text toolbar can add and remove them |
| The same text in many places (an "as at" date in every note) | A page value: `"values"` in the schema, `data-rt-value` on each element |
| A container the script fills (a feed, a chart, a ticker) | `data-rt-live="<name>"` on it |

Leave as they are: running prose (it keeps rich inline editing), and content the script fetches or
renders from data. Fields edit authored markup only, so script-rendered content can't be a field:
it stays Live.

## 2. Mark up the components

```html
<button type="button" class="gsp" data-rt-component="glance-spine" data-fam="capital" aria-expanded="false">
  <span class="gsp__band" aria-hidden="true"></span>
  <span class="gsp__panel">
    <span class="gsp__top"><span class="gsp__no2" data-rt-field="number">02</span><span class="gsp__fam" data-rt-field="family">Capital &amp; investment</span></span>
    <span class="gsp__fig"><span data-rt-field="figure">$150</span><small data-rt-field="unit">bn</small></span>
    <span class="gsp__lab" data-rt-field="label">CAPEX program, investing with conviction through the cycle</span>
  </span>
</button>
```

- **Root:** `data-rt-component="<type>"`, where `<type>` is a key of the schema. Roots can nest; an
  outer root's fields never reach into an inner one.
- **Field:** `data-rt-field="<name>"` on the element that holds the value (the default target). A
  field can instead name a CSS selector inside the root, or `:scope` for the root itself (for its
  `href`, `data-fam`, `open`…).
- **One value per element.** A text field replaces its element's content with plain text on the
  first edit. `<span class="gsp__fig">$150<small>bn</small></span>` as one field would lose the
  `<small>`; split it into `figure` and `unit` as above.
- **Variants are attributes, not inline styles.** Key the CSS on an attribute
  (`.gsp[data-fam="transition"]{--fill:#7E33FB}`) and give it a `select` field. A field may not write
  `style` or `class` (the Style tab owns inline style; a `toggle` can switch one class).
- **Keep free copy beside the fields, not around them.** A field's element, every element between
  it and the root, and everything inside a text or date field are locked to the field: a click
  selects the component and they can't be edited inline. A card's body copy stays inline-editable
  as long as it is a sibling of the field elements, not their ancestor.
- **Only an inline type sits inside running text.** A root with non-whitespace text beside it (a
  `<span>` in the middle of a sentence) is left to its paragraph, which keeps rich-text editing,
  and gets no fields, unless its type is `"inline": true`. An inline type's roots are edited
  through their paragraph: select the paragraph and Settings lists them with their fields, each
  named by its `title` field or else by its own words, which are its text without its fields'
  elements. Anything else inside the root joins the name. For example, a page value in the note
  gives "Tooltip · more than 20% 30 June 2026", so make that element a field too.
- **Spaces belong to the markup, not to a field.** A text field's value is trimmed at both ends, a
  no-break space with them, so the space between a figure and its unit sits between their
  elements: `<span data-rt-field="figure">$150</span>&nbsp;<small data-rt-field="unit">bn</small>`.
- **A page value is one element's whole text:** `As at <span data-rt-value="asOf">30 June 2026</span>`.
  A text field that holds one is disabled in Settings (an edit would flatten the binding). So keep
  the words beside the value in a field of their own:
  `<span class="asof__note"><span data-rt-field="note">As at</span> <span data-rt-field="asOf" data-rt-value="asOf">30 June 2026</span></span>`.
  The `note` field edits "As at". The `asOf` field shows the date, disabled, with "change it under
  Page values", which tells editors where the date lives.
- **Declare what the script fills:** `<ul class="news" data-rt-live="Announcements"></ul>`. It is
  Live from the first moment whatever the script does, named "Live · Announcements" in Layers, and
  the editor warns before a save that removed it.
- **Identify by class or data attribute, never by id.** Saving a component as a web block strips
  ids; `data-rt-*` attributes are kept, so a block keeps working as a component in any page whose
  schema declares the type.
- **Never author `data-rt-derived` nodes or `data-gjs-*` attributes.** Derived nodes in stored HTML
  are dropped on load; `data-gjs-*` attributes are editor internals.

## 3. Write the schema

One JSON block in the `<head>`. It is not JavaScript, so it never runs, and the head is kept byte
for byte, so it travels with the page. Only the editor reads it: visitors get the page without it
(`GET /api/boards/<slug>` drops a schema block in the head unless the requester may edit the
content), so the page script must never read it. To read or check the stored page, use
`/api/boards/<slug>/noncache` or a request as an editor, never the anonymous response.

```html
<script type="application/rt-components+json" id="rt-components">
{
  "version": 1,
  "locale": {"months": ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]},
  "components": {
    "glance-spine": {
      "label": "Glance spine",
      "fields": [
        {"name": "number", "label": "Number", "type": "text", "maxLength": 3},
        {"name": "figure", "label": "Figure", "type": "text", "maxLength": 12},
        {"name": "unit", "label": "Unit", "type": "text"},
        {"name": "unitShort", "label": "Unit on the closed spine (optional)", "type": "text",
         "target": "[data-rt-field=unit]", "attr": "data-short",
         "help": "Only when the unit is too long for the narrow column"},
        {"name": "label", "label": "Label", "type": "text", "multiline": true},
        {"name": "colour", "label": "Colour family", "type": "select", "target": ":scope", "attr": "data-fam",
         "options": [{"value": "capital", "label": "Capital & investment"},
                     {"value": "transition", "label": "Lower-carbon"}]}
      ]
    }
  }
}
</script>
```

Field types: `text` (content, or an attribute with `attr`), `url`, `select`, `toggle`, `date`,
`image`. On a type: `"title": "<field>"` names each instance by that field's value ("Story
milestone · Formation of …"); `"repeat": true` makes instances that share a parent a list;
`"inline": true` with `"wrap": {"tag", "class", "append"}` and `"wrapLabel"` for components in
running text. On a text field: `"input": "number"` with `min`, `max`, `step`, `integer`, and
`"pattern"` with `"patternHelp"`. On a date: `"precision": "day" | "month" | "year"` and
`"format"` (tokens `D`, `MMM`, `YYYY`). At the top: `"values": {"asOf": {"label": "As-at date"}}`.
These v2 keys (and `data-rt-live`, `data-rt-value`, `rt-editor:remove` / `add`) are additive: the
`version` stays `1`, and an editor without them ignores them, except that it cannot edit a
`YYYY-MM` date. The rules that bite:

- `version` must be `1`. Type keys and field names are identifiers (`[A-Za-z_][A-Za-z0-9_-]*`).
- `select` needs `attr` and `options`; an option with `"value": ""` removes the attribute.
- `toggle` needs `attr` (boolean attribute, e.g. `open`) or `class`.
- `date` writes `attr` (default `datetime`) as `YYYY-MM-DD` or `YYYY` (a month field: `YYYY-MM`)
  and the element's text by `format` with `locale.months` (twelve names; give the page's language
  its own). A month field shown as a year is `"precision": "month", "format": "YYYY"`.
- A number field's value stays a string, written as typed (`0.851`); a value off the rule, or not
  matching `pattern` (anchored to the whole value), is refused at the field.
- `image` targets an `<img>`; the editor's picker replaces `src` and drops `srcset`/`sizes`.
- `url` takes web addresses, paths, `#…`, `mailto:` and `tel:`; any attribute named like a URL
  (`href`, `src`, …) gets the same check whatever the field type.
- Fields may not write event handlers (`on*`), `style`, `class`, `srcdoc`, `contenteditable`,
  `draggable`, `data-gjs-*` or the `data-rt-*` markers (`component`, `field`, `derived`, `live`,
  `value`, `web-block`).
- A `wrap`'s `tag` and every element in its `append` are running-text elements (`span`, `b`, `i`,
  `em`, `strong`, `small`, `abbr`, `sup`, `sub`, `time`, `mark`, … — not `a`; `append` may add `br`).
  Their attributes are limited to class, title, lang, dir, `aria-*` and `data-*` (including
  `data-rt-field`). `append` is the inline component's empty field, usually one `<span>`.
- Patterns run in JavaScript with the `u` flag: write `[0-9]`, not `\d` (the validator's Python
  would let Arabic-Indic digits through), and no `\-` outside a class, `\_`, `\#` or lone `{`, which
  that flag refuses (the editor drops the pattern).
- The schema is raw script text: only `</script` ends it early. Tooling that refuses any `</` (an
  end tag in `append`) can write `<\/`, the same JSON string.
- A field whose element is missing in an instance shows disabled ("Not in this component"), which
  is how one schema serves two language editions (an Arabic-only `prefix`).

Anything invalid is dropped with one console warning
(`web-content-editor: page components: …`); a schema that doesn't parse is ignored and the page
edits as before. Full reference, every key and default, and worked examples (rating, figure with
an as-of note, document row with a date, company card with images, FAQ): `references/schema.md`.

## 4. Make the page script editor-aware

The same script runs on the published page and in the editor. In the editor it must leave content
to the editor and answer its events. Rules:

- **Draw derived parts as derived nodes.** If the script builds markup from other content (a closed
  face from the open panel, a table of contents, a summary), give the built element
  `data-rt-derived` and draw it in the editor too. The editor ignores it when deciding locks and
  never saves it. Without the mark the parent locks as Live; without drawing it the editor shows a
  blank.
- **Answer the events.** On `rt-editor:select` open or reveal the component; on `rt-editor:change`
  redraw what you derive from it. Detail is `{type}` / `{type, field, value}`. `change` also comes
  while the user types (a preview, not a saved value). `field` is `null` when the editor redrew the
  component's elements, which also drops derived nodes, so redraw on every change. That happens on
  a move, a duplicate, an undo, a rich-text session in its free copy, or a page-value edit inside
  it. If you draw from the *set* of components (a chart's
  points, a count, a filter), also redraw on `rt-editor:remove` (sent to the element the component
  left) and `rt-editor:add` (sent to the new component): delete, duplicate, paste and their undo.
  A move sends neither.
- **Never cache elements.** Moves, duplicates and undo create new elements. Listen on `document` or
  a stable container, look elements up when an event arrives, and re-read content rather than
  keeping copies.
- **No autoplay, walks or timers in the editor**, and no navigation. Check
  `document.documentElement.hasAttribute('data-rt-editor')`, and make layout decisions on it too:
  a page whose script and CSS disagree about reduced motion shows a state no visitor sees.
- **State through attributes is fine** (`aria-expanded`, `is-open`); it is never saved.
- **Keep facts in the markup.** The AI content chat is indexed from the page's stored HTML text, not
  from what a script renders. A figure, a chart's numbers or a document's highlights that only exist
  in a JS array are invisible to the chat. Author them as markup (a component, a table under the
  chart) and let the script derive the drawing from it.

`references/page-script.md` has the full contract, a copyable template, and what locks and what
doesn't.

## 5. Check

Run the validator on the page (Python 3, standard library only):

```bash
python3 scripts/check_components.py path/to/page.html [more.html …]
```

It reads the schema like the editor does (every key above), finds every instance, resolves every
field target (default targets, `:scope`, and simple selectors), and reports errors (nothing will
work: bad JSON, a stored derived node, an unsafe `append`, a pattern JavaScript refuses), warnings
(it works but bites: an undeclared type, a text field over markup, a root in running text, a
current value the field would refuse: over `maxLength`, not a number, off `pattern`, the wrong date
precision; page-value places that disagree, an unsafe URL) and notes (fields disabled by a page
value or a Live area, the declared Live areas, an inline name that takes in a page value). Exit code
1 means errors. Fix errors before uploading; read every warning.

Then check it in the editor (Edit on the content):

- No `web-content-editor: page components:` warning in the browser console (nor `field "<name>" has
  an invalid target`).
- Layers shows each component by its schema label, and nothing named "Live · …" that you expected
  to edit.
- Clicking a component (including a closed or hidden one) selects it and Settings lists its fields
  with the current values.
- An edit shows in the canvas at once, undo restores it, and the derived parts redraw.

## Symptoms

| You see | Cause | Fix |
|---|---|---|
| A component area is "Live · …" and can't be edited | The script writes content there | Mark what it draws `data-rt-derived`, or leave that area to the script |
| Closed/derived parts are blank in the editor | The script skips drawing in the editor | Draw them in the editor too, marked derived |
| Clicking selects a child, Settings shows no fields | No schema, undeclared type, or the root is in running text | Check the console warning and run the validator |
| A field is disabled: "Not in this component" | Its target isn't in this instance | Add the element, or fix the `target` |
| A field is disabled: "Filled in by the page's script" | The field sits in a Live area | Stop the script writing there, or mark its output derived |
| An edit drops part of the markup | A text field over an element with children | Split into one field per element |
| The duplicated component doesn't animate or redraw | The script cached elements at load | Delegate from a container; redraw on `rt-editor:change` |
| A deleted or duplicated card leaves the chart, count or filter stale | The script redraws on change only | Redraw on `rt-editor:remove` and `rt-editor:add` too |
| A field is disabled: "This text shows the page value …" | The field's element holds a `data-rt-value` | Edit it under Page values (nothing selected), or target the words beside it |
| Layers shows "Story milestone" 30 times | No `title` | Add `"title": "<field>"` to the type |
| No list actions in Settings | No `"repeat": true` | Add it |
| Settings shows "1 of 1" for one of many | The instances don't share a parent | Keep a list's instances siblings |
| A tooltip is named by its words plus its date ("… 30 June 2026") | Text outside its fields joins an inline component's name | Make the date's element a field too (it shows disabled) |
| A paragraph can't be typed in, though nothing in it is Live | The script changed an attribute inside it (ARIA wiring, a class) | Skip that in the editor |
| A pattern refuses nothing | The editor dropped it: an escape the `u` flag refuses (`\-`, `\_`, `\#`, a lone `{`); a console warning says so | Fix the escape; run the validator |
| The toolbar has no button for a tooltip | The type is not `inline`, or has no `wrap` | Add `"inline": true` and `"wrap"` |
| A script-filled area turns Live only after a while, or not at all | It is inferred from timing | Mark it `data-rt-live="<name>"` |
| The editor shows a layout no visitor sees | Script follows `matchMedia` reduce, CSS follows the system | Key editor CSS on `html[data-rt-motion=reduce]` |
