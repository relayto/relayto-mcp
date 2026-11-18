# The page script in RELAYTO's editor

The page's own scripts run inside the editor canvas, so components behave there as they do
published. This is what the editor expects from them.

## Contents

- [What the canvas is](#what-the-canvas-is)
- [What locks and what doesn't](#what-locks-and-what-doesnt)
- [Derived nodes](#derived-nodes)
- [Editor events](#editor-events)
- [When elements are replaced](#when-elements-are-replaced)
- [Template](#template)
- [Anti-patterns](#anti-patterns)

## What the canvas is

- The page's scripts are replayed in document order with the usual `readyState`,
  `DOMContentLoaded` and `load` sequence. Then the editor waits for the page to settle (no
  structural changes for 1.5 s and no pending fetch/XHR; at most 15 s) and runs its lock pass.
- `document.documentElement` has the attributes `data-rt-editor` and `data-rt-motion="reduce"`, set
  before any page script runs (after the page's own `<html>` attributes are copied). Only the editor
  sets them.
- `matchMedia('(prefers-reduced-motion: reduce)')` matches and CSS animations and transitions are cut
  to near zero. A page that honours reduced motion already behaves calmly. CSS
  `@media (prefers-reduced-motion)` still follows the operating system, so a page whose script and
  CSS both branch on reduced motion would show a state no visitor sees: in CSS, key editor layout on
  `html[data-rt-motion=reduce]` (or `html[data-rt-editor]`) as well. Typical rules: a list that
  pans for visitors wraps instead, `scroll-behavior: smooth` goes back to `auto`, the progress rail
  of an autoplay hides.
- Clicks reach the page's handlers (tabs switch, `<details>` toggle), but link and script
  navigation is blocked.
- Storage and cookies are private to the canvas; tracker scripts are blocked.

## What locks and what doesn't

The editor compares what scripts did to the DOM with the page's markup:

| Script does | Result |
|---|---|
| Adds, removes or rewrites child nodes or text of an element | That element locks as **Live**: not editable, children locked, ancestors not copyable. Fields inside it are disabled |
| Changes attributes or classes (`aria-expanded`, `is-open`, `hidden`, `style`) | Nothing locks. Shown in the canvas, never saved. Exception: inside a rich-text unit (a paragraph), that unit goes read-only so the change isn't baked in |
| Adds, removes or rewrites nodes marked `data-rt-derived` (or anything inside one) | Nothing locks. Never saved |
| Leaves an element empty in the markup and looks it up by an `id` an **inline** script mentions (`getElementById('x')`, `querySelector('#x …')`, `$('#x')`; a script loaded with `src` is not read) | That element locks as Live, whether or not the script has filled it yet; deleting any element whose id is mentioned warns before saving |
| Fills an element marked `data-rt-live="<name>"` | Live from the first lock pass whatever the script does or when, named "Live · <name>". Declare every container a script fills this way |

Live is the right answer for content that really is the script's (a chart, a feed, a live
price): it stops script output from being saved. Inferred Live depends on timing (writes the editor
sees before the page settles, 1.5 s quiet, 15 s at most; later ones lock late, perhaps after the
user started typing), so declare it with `data-rt-live`; keep any id list an older page had. It is the wrong answer for content an editor
should change; for that, either let the author's markup hold the content and only enhance it, or
mark what the script draws as derived.

## Derived nodes

A derived node is markup the script builds from other content on the page. Mark the element
`data-rt-derived` (the mark covers its whole subtree):

```js
const face = document.createElement('span');
face.className = 'gsp__shut';
face.setAttribute('aria-hidden', 'true');
face.setAttribute('data-rt-derived', '');
```

- Draw derived nodes in the editor as well as on the published page; without them the editor
  shows blanks where the page normally shows something.
- The editor never treats them as content: they don't lock their parent, a click on one selects the
  component around it, an inline edit around one never takes it in, and saving never writes one.
- Only scripts create them. One found in the stored HTML is dropped on load with a console
  warning.
- They are not a place for content an editor should change. Derive them from fields, and redraw
  them when a field changes.

## Editor events

Dispatched on the component's root element in the canvas (remove: on the element it left), as
`CustomEvent(name, {bubbles: true, detail})` (not composed, not cancelable; `detail` is a copy), only
in the editor and only after its lock pass:

| Event | When | `event.detail` |
|---|---|---|
| `rt-editor:select` | The component becomes the single selection | `{type}` |
| `rt-editor:deselect` | It stops being selected | `{type}` |
| `rt-editor:change` | After a field edit, undo or redo has been drawn; also while the user types, after each pause (a preview), and again with the old value when a previewed value is refused or restored | `{type, field, value}` |
| `rt-editor:change` | After the editor drew the component's elements again without a field change: a move, a duplicate, an undo of a delete, the end of a rich-text session or an inline wrap in its free copy, a page-value edit that rewrote an element inside it | `{type, field: null, value: null}` |
| `rt-editor:remove` | A component left the page (delete, cut, undo of an add or a paste). Dispatched on the element it left (or the nearest one still on the page) | `{type}` |
| `rt-editor:add` | A component appeared (duplicate, paste, an inserted web block, undo of a delete), after its `rt-editor:change {field: null}` | `{type}` |

- `type` is the `data-rt-component` value; `field` the field name; `value` the field's new value (a
  string; a boolean for toggles; the ISO date for dates; the `src` for images).
- `change`, `remove` and `add` arrive a task after the editor's own work; `select` and
  `deselect` a microtask after it. Either way the page's response runs as page script: attribute
  changes it makes lock nothing; content it writes outside derived nodes does lock.
- Within one redraw the order is every `change` (one per field), then `remove`, then `add`.
  Deleting an outer root sends one `remove` per root inside it, all on the nearest element left.
- A deleted root gets no `deselect` (its element is gone): `remove` is the signal.
- `change` does not mean saved: `value` may be a preview that is refused or undone. Redraw from the
  DOM each time.
- Inline types get only `change`: after an edit in their paragraph's Settings, and with
  `field: null` after a rich-text session or a wrap.
- Read the component's current content from the DOM when the event arrives (the field elements
  already hold the new value). Don't rely on `value` alone; one edit may affect what several
  derived parts show.

## When elements are replaced

Field edits keep the component's elements: attribute edits change them in place, and a text edit
replaces only the text inside its field element. Listeners bound to the root or its elements
survive edits.

Moves, duplicates and undoing a delete create new elements. Classes and attributes the script set
are carried over to the new elements; listeners, element references held in closures, and derived
children are not. Hence:

- Listen on `document` or a stable container and find the component with `closest()`.
- Look elements up when you need them; don't cache lists at load.
- Redraw derived parts on every `rt-editor:change`, including `field: null`.
- If something you draw depends on the set of components (a chart's points, a count, a year
  filter, a table of contents), redraw it on `rt-editor:remove` and `rt-editor:add` as well. A move
  sends neither (the set is the same); a removal is announced on the container it left, so the
  listener on `document` hears it. Inline types send neither; their paragraph is redrawn on each
  rich-text session.

## Template

A component that opens one item at a time and draws a summary of each closed item from its content.
Adapt the selectors; keep the structure.

```js
(function () {
  var inEditor = document.documentElement.hasAttribute('data-rt-editor');
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var TYPE = 'glance-spine';
  var field = function (root, name) { return root.querySelector('[data-rt-field="' + name + '"]'); };
  var text = function (el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };

  // Derived: drawn from the item's own fields, in the editor too, never saved.
  function drawSummary(item) {
    var old = item.querySelector(':scope > [data-rt-derived]');
    if (old) old.remove();
    var face = document.createElement('span');
    face.className = 'item__summary';
    face.setAttribute('aria-hidden', 'true');
    face.setAttribute('data-rt-derived', '');
    face.textContent = text(field(item, 'figure')) + ' ' + text(field(item, 'unit'));
    item.insertBefore(face, item.firstChild);
    item.setAttribute('aria-label', text(field(item, 'label')));
  }

  // State through attributes only: shown in the editor, never saved, locks nothing.
  function open(item) {
    var group = item.parentNode;
    group.querySelectorAll('[data-rt-component="' + TYPE + '"]').forEach(function (other) {
      other.setAttribute('aria-expanded', other === item ? 'true' : 'false');
    });
  }

  document.querySelectorAll('[data-rt-component="' + TYPE + '"]').forEach(drawSummary);

  // Delegated, so copies made in the editor work too.
  document.addEventListener('click', function (e) {
    var item = e.target.closest('[data-rt-component="' + TYPE + '"]');
    if (item) open(item);
  });

  if (inEditor) {
    document.addEventListener('rt-editor:select', function (e) {
      if (e.detail && e.detail.type === TYPE) open(e.target);
    });
    document.addEventListener('rt-editor:change', function (e) {
      if (e.detail && e.detail.type === TYPE) drawSummary(e.target);
    });
    // The set of items changed (delete, duplicate, undo): redraw what counts them.
    ['rt-editor:remove', 'rt-editor:add'].forEach(function (name) {
      document.addEventListener(name, function (e) {
        if (e.detail && e.detail.type === TYPE) { /* e.g. drawCount(); */ }
      });
    });
    return; // no autoplay, no timers, no hover-driven layout changes while someone edits
  }

  if (!reduce) {
    // published page only: autoplay, walks, hover behaviour
  }
})();
```

## Anti-patterns

| Pattern | What happens in the editor | Instead |
|---|---|---|
| Script fills in text from its own data (`el.textContent = data.price`) | The element locks as Live, its field is disabled | Keep authored text in the markup; let the script enhance it, or accept Live for live data |
| `if (inEditor) return;` before drawing derived parts | Blank closed panels and summaries in the editor | Draw them in the editor too, marked `data-rt-derived` |
| Derived markup without the mark | The component locks as Live; nothing in it is editable | Add `data-rt-derived` to the built element |
| `const items = document.querySelectorAll(...)` at load, used later | Copies and moved items don't respond | Delegate and look up on each event |
| A `MutationObserver` on a list to notice deletions in the editor | Works, but feeds on the page's own writes and fires on moves | Listen for `rt-editor:remove` and `rt-editor:add` |
| `@media (prefers-reduced-motion: reduce)` deciding editor layout while the script follows `matchMedia` | The editor shows a state no visitor sees | `html[data-rt-motion=reduce]` in the CSS |
| A void `[document.getElementById(…)]` list so the editor locks a container | Locked only if the container is empty in the markup | `data-rt-live="<name>"` on it |
| `setInterval` walks, carousels, autoplay in the editor | The selection jumps while the user edits | Skip them when `data-rt-editor` is present |
| Hover opens items (`mouseenter`) in the editor | Layout shifts under the pointer while clicking | Open on `rt-editor:select` instead |
| Writing `id`s onto elements at runtime for ARIA wiring inside text | The surrounding paragraph goes read-only | Write attributes on non-text elements, or skip that wiring in the editor |
| Navigating from a handler (`location.href = …`) | Blocked; at worst the editing session stops | Use real links |
