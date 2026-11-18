#!/usr/bin/env python3
"""Check an HTML page's RELAYTO page components the way the web-content editor reads them.

Usage: python3 check_components.py page.html [more.html ...]

Reports, per page:
  ERROR  the component or schema will not work as intended
  WARN   it works, but an edit or an editor rule will bite
  NOTE   worth knowing
Exit code 1 when any page has an error. Standard library only.

Mirrors the rules of RELAYTO's web-content editor: the
schema rules (with the v2 keys: title, repeat, inline, wrap, input/pattern, precision/format, values),
which roots the editor claims, how a field target resolves (default target, :scope, and selectors made
of tags, classes, ids, attribute tests, descendant and child combinators; anything else is reported as
not checked), what each field reads from the current markup and whether the editor would take it back,
page values (data-rt-value) and declared Live areas (data-rt-live).
"""
import json
import re
import sys
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser

SCHEMA_TYPE = 'application/rt-components+json'
FIELD_TYPES = ('text', 'url', 'select', 'toggle', 'date', 'image')
TITLE_TYPES = ('text', 'url', 'select', 'date')
PRECISIONS = ('day', 'month', 'year')
PRECISION_TOKENS = {'day': ('D', 'MMM', 'YYYY'), 'month': ('MMM', 'YYYY'), 'year': ('YYYY',)}
IDENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_-]*$')
ATTR_NAME = re.compile(r'^[a-z_][a-z0-9_.:-]*$')
CLASS_NAME = re.compile(r'^[^\s"\'<>]+$')
RESERVED_ATTR = re.compile(
    r'^(on.*|style|class|srcdoc|contenteditable|draggable|data-gjs-.*|data-rt-(component|field|derived|web-block|live|value))$')
URL_ATTRS = {'href', 'src', 'xlink:href', 'action', 'formaction', 'data', 'poster', 'cite', 'background'}
WEB_SCHEMES = ('http', 'https', 'mailto', 'tel')
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
INLINE_TAGS = {'span', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'ins', 'kbd', 'mark',
               'q', 's', 'samp', 'small', 'strong', 'sub', 'sup', 'time', 'u', 'var'}
APPEND_ATTR = re.compile(r'^(class|title|lang|dir|aria-[a-z0-9-]+|data-[a-z0-9_.:-]+)$')
APPEND_RESERVED = re.compile(r'^data-(gjs-.*|rt-(component|derived|live|web-block))$')
NUMBER = re.compile(r'^-?[0-9]+(?:\.[0-9]+)?$')   # ASCII digits, as the editor's JavaScript
LIVE, VALUE = 'data-rt-live', 'data-rt-value'
# Opening one of these closes an open <p> (HTML's implied end tags, the common cases).
CLOSES_P = {'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure',
            'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre',
            'section', 'table', 'ul'}
SELF_CLOSING_SIBLINGS = {'li': {'li'}, 'dt': {'dt', 'dd'}, 'dd': {'dt', 'dd'}, 'option': {'option'}, 'tr': {'tr'},
                         'td': {'td', 'th'}, 'th': {'td', 'th'}}
LAYOUT_SPACE = re.compile(r'[ \t\n\r\f]+')
TEXT_PRESENT = re.compile(r'[^ \t\n\r\f]')


# ------------------------------------------------------------------------------------- tree

class Node:
    def __init__(self, tag, attrs, parent, line):
        self.tag, self.attrs, self.parent, self.line = tag, attrs, parent, line
        self.children = []

    def text(self):
        return ''.join(c if isinstance(c, str) else ('' if c.tag in ('script', 'style') else c.text()) for c in self.children)

    def elements(self):
        return [c for c in self.children if isinstance(c, Node)]

    def descendants(self):
        for c in self.elements():
            yield c
            yield from c.descendants()

    def ancestors(self):
        p = self.parent
        while p is not None:
            yield p
            p = p.parent

    def describe(self):
        bits = [self.tag]
        cls = self.attrs.get('class', '').split()
        if cls:
            bits.append('.' + '.'.join(cls[:2]))
        for key in ('data-id', 'data-sym', 'id'):
            if key in self.attrs:
                bits.append(f'[{key}={self.attrs[key]}]')
                break
        return ''.join(bits) + f' (line {self.line})'


class Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#document', {}, None, 0)
        self.stack = [self.root]
        self.scripts = []  # (attrs, text, in_head)

    def _open(self, tag, attrs, push):
        cur = self.stack[-1]
        if tag in CLOSES_P and cur.tag == 'p':
            self.stack.pop()
        for opener, closes in SELF_CLOSING_SIBLINGS.items():
            if tag == opener and self.stack[-1].tag in closes:
                self.stack.pop()
        node = Node(tag, {k.lower(): (v if v is not None else '') for k, v in attrs}, self.stack[-1], self.getpos()[0])
        self.stack[-1].children.append(node)
        if push and tag not in VOID:
            self.stack.append(node)
        return node

    def handle_starttag(self, tag, attrs):
        self._open(tag, attrs, True)

    def handle_startendtag(self, tag, attrs):
        self._open(tag, attrs, False)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                node = self.stack[i]
                del self.stack[i:]
                if tag == 'script':
                    in_head = any(a.tag == 'head' for a in node.ancestors())
                    self.scripts.append((node.attrs, node.text(), in_head, node.line))
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


class Fragment(HTMLParser):
    """A wrap's `append` as the editor checks it: running-text elements, safe attributes, well formed."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.error = [], None

    def fail(self, msg):
        if self.error is None:
            self.error = msg

    def handle_starttag(self, tag, attrs):
        if tag not in INLINE_TAGS and tag != 'br':
            self.fail(f'may only hold text and elements of running text, not <{tag}>')
        for name, _ in attrs:
            if not APPEND_ATTR.match(name) or APPEND_RESERVED.match(name):
                self.fail(f'may not set the attribute "{name}"')
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        if tag not in VOID:
            # HTML ignores the slash: <span/> opens a span, and the wrap would swallow the sentence
            self.fail(f'writes <{tag}/>, which HTML reads as an open <{tag}>: write <{tag}></{tag}>')
        self.handle_starttag(tag, attrs)
        if tag not in VOID and self.stack and self.stack[-1] == tag:
            self.stack.pop()

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack or self.stack.pop() != tag:
            self.fail('is not well formed')

    def handle_comment(self, data):
        self.fail('may only hold text and elements')

    def handle_decl(self, decl):
        self.fail('may only hold text and elements')

    def handle_pi(self, data):
        self.fail('may only hold text and elements')

    def unknown_decl(self, data):
        self.fail('may only hold text and elements')


def append_error(append):
    if not append:
        return None
    f = Fragment()
    f.feed(append)
    f.close()
    if f.error:
        return f.error
    return 'is not well formed' if f.stack else None


# ---------------------------------------------------------------------------------- selectors

class Unsupported(Exception):
    pass


TOKEN = re.compile(r'''
    (?P<ws>\s+) | (?P<child>>) | (?P<comma>,) | (?P<scope>:scope\b) | (?P<pseudo>::?[\w-]+(\([^)]*\))?) |
    (?P<star>\*) | (?P<tag>[A-Za-z][\w-]*) | (?P<cls>\.[\w-]+) | (?P<id>\#[\w-]+) |
    (?P<attr>\[\s*(?P<an>[\w:.-]+)\s*(?:(?P<op>[~^$*|]?=)\s*(?:"(?P<dq>[^"]*)"|'(?P<sq>[^']*)'|(?P<uq>[^\]\s]+))\s*)?\]) |
    (?P<other>[+~])''', re.X)


def parse_selector(sel):
    """[[(combinator, compound), ...], ...] for each comma-separated selector."""
    groups, parts, comp, comb, pos = [], [], None, None, 0
    sel = sel.strip()

    def flush():
        nonlocal comp, comb
        if comp is not None:
            parts.append((comb, comp))
            comp, comb = None, None

    def compound():
        nonlocal comp
        if comp is None:
            comp = {'tag': None, 'cls': [], 'id': None, 'attrs': [], 'scope': False}
        return comp

    while pos < len(sel):
        m = TOKEN.match(sel, pos)
        if not m:
            raise Unsupported(sel[pos:])
        pos = m.end()
        if m.group('ws'):
            if comp is not None:
                flush()
                comb = ' '
            continue
        if m.group('child'):
            flush()
            comb = '>'
            continue
        if m.group('comma'):
            flush()
            groups.append(parts)
            parts = []
            comb = None
            continue
        if m.group('scope'):
            compound()['scope'] = True
        elif m.group('pseudo') or m.group('other'):
            raise Unsupported(m.group(0))
        elif m.group('star'):
            compound()
        elif m.group('tag'):
            compound()['tag'] = m.group('tag').lower()
        elif m.group('cls'):
            compound()['cls'].append(m.group('cls')[1:])
        elif m.group('id'):
            compound()['id'] = m.group('id')[1:]
        elif m.group('attr'):
            val = m.group('dq') if m.group('dq') is not None else m.group('sq') if m.group('sq') is not None else m.group('uq')
            compound()['attrs'].append((m.group('an').lower(), m.group('op'), val))
    flush()
    groups.append(parts)
    if any(not g for g in groups):
        raise Unsupported(sel)
    return groups


def match_compound(n, c, scope):
    if c['scope'] and n is not scope:
        return False
    if c['tag'] and n.tag != c['tag']:
        return False
    if c['id'] and n.attrs.get('id') != c['id']:
        return False
    classes = n.attrs.get('class', '').split()
    if any(x not in classes for x in c['cls']):
        return False
    for name, op, val in c['attrs']:
        if name not in n.attrs:
            return False
        have = n.attrs[name]
        if op is None:
            continue
        if op == '=' and have != val:
            return False
        if op == '~=' and val not in have.split():
            return False
        if op == '^=' and not have.startswith(val):
            return False
        if op == '$=' and not have.endswith(val):
            return False
        if op == '*=' and val not in have:
            return False
        if op == '|=' and not (have == val or have.startswith(val + '-')):
            return False
    return True


def match_parts(n, parts, scope):
    def rec(node, i):
        if not isinstance(node, Node) or node.tag == '#document':
            return False
        comb, comp = parts[i]
        if not match_compound(node, comp, scope):
            return False
        if i == 0:
            return True
        if comb == '>':
            return rec(node.parent, i - 1)
        p = node.parent
        while isinstance(p, Node) and p.tag != '#document':
            if rec(p, i - 1):
                return True
            p = p.parent
        return False
    return rec(n, len(parts) - 1)


# ------------------------------------------------------------------------------------ schema

def load_schema(scripts, report):
    """(components, values), or None when the editor would ignore the schema."""
    blocks = [s for s in scripts if s[0].get('type', '').strip().lower() == SCHEMA_TYPE]
    if not blocks:
        return None
    attrs, source, in_head, line = blocks[0]
    if len(blocks) > 1:
        report('WARN', f'{len(blocks) - 1} more schema block(s) after line {line} are ignored; only the first is read')
    if 'src' in attrs:
        report('ERROR', f'line {line}: the schema must be inline, not loaded from src')
        return None
    if not in_head:
        report('NOTE', f'line {line}: the schema is outside <head>; the editor still reads it, but keep it in the head')
    def no_constant(c):
        raise ValueError(c)
    try:
        raw = json.loads(source, parse_constant=no_constant)
    except json.JSONDecodeError as e:
        report('ERROR', f'line {line}: the schema is not valid JSON ({e.msg} at line {e.lineno} col {e.colno}); the editor ignores it')
        return None
    except ValueError as e:
        report('ERROR', f'line {line}: the schema holds {e}, which JSON.parse refuses; the editor ignores it')
        return None
    if not isinstance(raw, dict):
        report('ERROR', 'the schema is not a JSON object; the editor ignores it')
        return None
    version = raw.get('version')
    if isinstance(version, bool) or version != 1:
        report('ERROR', f'schema version {raw.get("version")!r} is not supported (expected 1); the editor ignores it')
        return None
    if not isinstance(raw.get('components'), dict):
        report('ERROR', 'the schema has no "components" object; the editor ignores it')
        return None
    months = (raw.get('locale') or {}).get('months') if isinstance(raw.get('locale'), dict) else None
    if months is not None and not (isinstance(months, list) and len(months) == 12 and all(isinstance(m, str) and m.strip() for m in months)):
        report('WARN', 'locale.months must be 12 names; the editor falls back to English')
    components = {}
    for ctype, cdef in raw['components'].items():
        comp = check_component(ctype, cdef, report)
        if comp:
            components[ctype] = comp
    values = {}
    if 'values' in raw:
        if not isinstance(raw['values'], dict):
            report('ERROR', '"values" is ignored: not an object')
        else:
            for name, v in raw['values'].items():
                if not IDENT.match(name) or not isinstance(v, dict):
                    report('ERROR', f'value "{name}" is ignored: use letters, digits, - and _, and an object')
                    continue
                values[name] = {'label': v.get('label') if isinstance(v.get('label'), str) and v['label'].strip() else name}
    if not components and not values:
        report('ERROR', 'no usable component in the schema; the editor ignores it')
        return None
    return components, values


def check_component(ctype, cdef, report):
    if not IDENT.match(ctype):
        report('ERROR', f'component type "{ctype}" is ignored: use letters, digits, - and _')
        return None
    if not isinstance(cdef, dict) or not isinstance(cdef.get('fields'), list):
        report('ERROR', f'component "{ctype}" is ignored: it has no "fields" list')
        return None
    fields, names = [], set()
    for i, f in enumerate(cdef['fields']):
        field = check_field(ctype, i, f, report)
        if not field:
            continue
        if field['name'] in names:
            report('ERROR', f'{ctype}.{field["name"]} is ignored: the name is used twice')
            continue
        names.add(field['name'])
        fields.append(field)
    if not fields:
        report('ERROR', f'component "{ctype}" is ignored: no usable field')
        return None
    label = cdef['label'].strip() if isinstance(cdef.get('label'), str) and cdef['label'].strip() else ctype
    title = None
    if 'title' in cdef:
        want = cdef['title'].strip() if isinstance(cdef['title'], str) else cdef['title']
        named = next((f for f in fields if f['name'] == want), None)
        if not named:
            report('ERROR', f'{ctype}.title is ignored: no field "{cdef["title"]}"')
        elif named['type'] not in TITLE_TYPES:
            report('ERROR', f'{ctype}.title is ignored: a {named["type"]} field cannot name an instance')
        else:
            title = named['name']
    inline = cdef.get('inline') is True
    wrap = None
    if 'wrap' in cdef:
        if not inline:
            report('WARN', f'{ctype}.wrap is ignored: only an inline type wraps a selection')
        else:
            wrap = check_wrap(ctype, cdef['wrap'], report)
    if cdef.get('repeat') is True and inline:
        report('NOTE', f'{ctype}: "repeat" is ignored on an inline type')
    if inline and not wrap:
        report('NOTE', f'{ctype}: inline type without "wrap": its instances get fields, but the toolbar cannot add or remove them')
    return {'label': label, 'fields': fields, 'title': title, 'repeat': cdef.get('repeat') is True and not inline,
            'inline': inline, 'wrap': wrap}


def check_wrap(ctype, w, report):
    if not isinstance(w, dict):
        report('ERROR', f'{ctype}.wrap is ignored: not an object')
        return None
    tag = (w.get('tag') if isinstance(w.get('tag'), str) else 'span').strip().lower() or 'span'
    if tag not in INLINE_TAGS:
        report('ERROR', f'{ctype}.wrap is ignored: "{tag}" is not an element of running text')
        return None
    if 'class' in w and (not isinstance(w['class'], str) or not all(CLASS_NAME.match(c) for c in w['class'].split())):
        report('ERROR', f'{ctype}.wrap is ignored: "class" must be class names')
        return None
    append = w.get('append') if isinstance(w.get('append'), str) else ''
    err = append_error(append)
    if err:
        report('ERROR', f'{ctype}.wrap is ignored: "append" {err}')
        return None
    return {'tag': tag, 'append': append}


def check_field(ctype, i, f, report):
    where = f'{ctype}.fields[{i}]'
    if not isinstance(f, dict):
        report('ERROR', f'{where} is ignored: not an object')
        return None
    name = f.get('name') if isinstance(f.get('name'), str) else ''
    if not IDENT.match(name.strip()):
        report('ERROR', f'{where} is ignored: "name" must use letters, digits, - and _')
        return None
    name = name.strip()
    at = f'{ctype}.{name}'
    ftype = f.get('type')
    if ftype not in FIELD_TYPES:
        report('ERROR', f'{at} is ignored: unknown type {ftype!r}')
        return None
    target = f'[data-rt-field="{name}"]'
    if 'target' in f:
        target = f['target'].strip() if isinstance(f['target'], str) else ''
        if not target:
            report('ERROR', f'{at} is ignored: "target" is empty')
            return None
    attr = None
    if 'attr' in f:
        attr = (f['attr'] if isinstance(f['attr'], str) else '').strip().lower()
        if not ATTR_NAME.match(attr) or RESERVED_ATTR.match(attr):
            report('ERROR', f'{at} is ignored: it may not edit the attribute "{f.get("attr")}"')
            return None
    cls = None
    if ftype == 'toggle' and 'class' in f:
        cls = f['class'].strip() if isinstance(f['class'], str) else ''
        if not cls or re.search(r'[\s"\'<>]', cls):
            report('ERROR', f'{at} is ignored: "class" must be one class name')
            return None
        attr = None
    if ftype == 'url' and not attr:
        attr = 'href'
    if ftype == 'date' and not attr:
        attr = 'datetime'
    if ftype == 'image':
        if attr:
            report('NOTE', f'{at}: "attr" is ignored on an image field')
        attr = None
    if ftype in ('select', 'toggle') and not attr and not cls:
        report('ERROR', f'{at} is ignored: a {ftype} needs "attr"' + (' or "class"' if ftype == 'toggle' else ''))
        return None
    options = []
    if ftype == 'select':
        seen = set()
        for o in f.get('options') or []:
            if isinstance(o, dict) and isinstance(o.get('value'), str) and o['value'] not in seen:
                seen.add(o['value'])
                options.append(o['value'])
        if not options:
            report('ERROR', f'{at} is ignored: a select needs "options" with string values')
            return None
    ml = f.get('maxLength')
    if isinstance(ml, float) and ml.is_integer():
        ml = int(ml)
    max_length = ml if isinstance(ml, int) and not isinstance(ml, bool) and ml >= 1 and ftype in ('text', 'url') else None
    if 'multiline' in f and ftype != 'text':
        report('NOTE', f'{at}: "multiline" only applies to text fields')
    number = None
    pattern = None
    if ftype != 'text' and ('input' in f or 'pattern' in f):
        report('WARN', f'{at}: "input" and "pattern" apply to text fields; ignored')
    if ftype == 'text':
        number = check_number_rule(at, f, report)
        if 'pattern' in f:
            src = f['pattern']
            if not isinstance(src, str) or not src:
                report('ERROR', f'{at}.pattern is ignored: not a regular expression')
            elif js_u_refuses(src):
                report('ERROR', f'{at}.pattern is ignored: {js_u_refuses(src)}, which JavaScript refuses under the u flag the editor uses')
            else:
                try:
                    pattern = re.compile(r'(?:' + src + r')\Z', re.ASCII)
                except re.error:
                    report('NOTE', f'{at}.pattern: Python cannot read it to check current values; the editor uses '
                                   'JavaScript\'s rules (anchored, u flag), so check it in the editor')
    precision, fmt = 'day', None
    if ftype == 'date':
        if 'precision' in f:
            if f['precision'] in PRECISIONS:
                precision = f['precision']
            else:
                report('ERROR', f'{at}.precision is ignored: use "day", "month" or "year"')
        if 'format' in f:
            fmt = f['format'].strip() if isinstance(f['format'], str) else ''
            if not format_fits(fmt, precision):
                report('ERROR', f'{at}.format is ignored: use D, MMM and YYYY, each once (a {precision} has {", ".join(PRECISION_TOKENS[precision])}); '
                                'no other Latin letters')
                fmt = None
    return {'name': name, 'type': ftype, 'target': target, 'attr': attr, 'cls': cls, 'options': options,
            'maxLength': max_length, 'required': f.get('required') is True,
            'multiline': ftype == 'text' and f.get('multiline') is True and not number,
            'number': number, 'pattern': pattern, 'precision': precision, 'format': fmt}


def js_u_refuses(src):
    """What JavaScript's u flag refuses in a pattern that Python reads (the common slips), else None."""
    i, in_class = 0, False
    while i < len(src):
        c = src[i]
        if c == '\\' and i + 1 < len(src):
            e = src[i + 1]
            if not (e in 'dDwWsSbBnrtfvcxukpP0123456789' or e in '^$\\.*+?()[]{}|/' or (in_class and e == '-')):
                return f'the escape "\\{e}"'
            if e in 'pPu' and src[i + 2:i + 3] == '{' and '}' in src[i + 2:]:
                i = src.index('}', i + 2) + 1           # \p{L}, \u{1F600}
                continue
            i += 2
            continue
        if c == '[':
            in_class = True
        elif c == ']':
            in_class = False
        elif not in_class and c == '{' and not re.match(r'\{[0-9]+(?:,[0-9]*)?\}', src[i:]):
            return 'a "{" that is not a count'
        elif not in_class and c == '}' and not re.search(r'\{[0-9]+(?:,[0-9]*)?$', src[:i]):
            return 'a lone "}"'
        i += 1
    return None


def check_number_rule(at, f, report):
    if 'input' not in f or f['input'] == 'text':
        return None
    if f['input'] != 'number':
        report('ERROR', f'{at}.input is ignored: only "number" is known')
        return None

    def num(key, positive=False):
        v = f.get(key)
        if v is None:
            return None
        if isinstance(v, bool) or not isinstance(v, (int, float)) or (positive and v <= 0):
            report('ERROR', f'{at}.{key} is ignored: not a{" positive" if positive else ""} number')
            return None
        return Decimal(str(v))
    rule = {'min': num('min'), 'max': num('max'), 'step': num('step', True), 'integer': f.get('integer') is True}
    if rule['min'] is not None and rule['max'] is not None and rule['min'] > rule['max']:
        report('ERROR', f'{at}.max is ignored: below min')
        rule['max'] = None
    return rule


def format_fits(fmt, precision):
    tokens = re.findall(r'YYYY|MMM|D', fmt or '')
    rest = re.sub(r'YYYY|MMM|D', '', fmt or '')
    # Each token once: DD reads as D twice and would print the day twice.
    return (bool(tokens) and not re.search(r'[A-Za-z]', rest) and len(set(tokens)) == len(tokens)
            and all(t in PRECISION_TOKENS[precision] for t in tokens))


def number_error(rule, v):
    s = v.strip()
    if not NUMBER.match(s):
        return 'not a number (ASCII digits and a point)'
    if rule['integer'] and '.' in s:
        return 'not a whole number'
    n = Decimal(s)
    if rule['min'] is not None and n < rule['min']:
        return f'below min {rule["min"]}'
    if rule['max'] is not None and n > rule['max']:
        return f'above max {rule["max"]}'
    if rule['step'] is not None:
        base = rule['min'] if rule['min'] is not None else Decimal(0)
        try:
            if (n - base) % rule['step'] != 0:
                return f'not on a step of {rule["step"]}'
        except InvalidOperation:
            pass
    return None


# ---------------------------------------------------------------------------------- the page

def is_derived(n):
    return any(isinstance(a, Node) and 'data-rt-derived' in a.attrs for a in [n, *n.ancestors()])


def in_running_text(n):
    p = n.parent
    return p is not None and any(isinstance(c, str) and TEXT_PRESENT.search(c) for c in p.children)


def is_web_url(v):
    v = re.sub(r'[\x00-\x20]', '', v)
    m = re.match(r'^([a-z][a-z0-9+.-]*):', v, re.I)
    return not m or m.group(1).lower() in WEB_SCHEMES


def iso_precision(v):
    """'day', 'month' or 'year' for a valid ISO date (YYYY-MM-DD, YYYY-MM, YYYY), else None."""
    m = re.match(r'^([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?$', v.strip())
    if not m:
        return None
    if m.group(2) is None:
        return 'year'
    y, mo = int(m.group(1)), int(m.group(2))
    if not 1 <= mo <= 12:
        return None
    if m.group(3) is None:
        return 'month'
    leap = (y % 4 == 0 and y % 100 != 0) or y % 400 == 0
    days = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return 'day' if 1 <= int(m.group(3)) <= days[mo - 1] else None


def date_fits(precision, has):
    return has != 'month' if precision == 'day' else has == precision


def check_page(path):
    lines = []
    report = lambda level, msg: lines.append((level, msg))
    b = Builder()
    b.feed(open(path, encoding='utf-8').read())
    b.close()
    doc = b.root
    loaded = load_schema(b.scripts, report)
    everything = list(doc.descendants())

    for n in everything:
        if 'data-rt-derived' in n.attrs and not any('data-rt-derived' in a.attrs for a in n.ancestors() if isinstance(a, Node)):
            report('ERROR', f'{n.describe()} is marked data-rt-derived in the stored HTML: the editor drops it on load. Only scripts create derived nodes')
        gjs = [a for a in n.attrs if a.startswith('data-gjs-')]
        if gjs:
            report('WARN', f'{n.describe()} has {", ".join(gjs)}: editor internals; remove them')

    lives = [n for n in everything if LIVE in n.attrs and not is_derived(n)]
    marked = [n for n in everything if 'data-rt-component' in n.attrs]
    bound = [n for n in everything if VALUE in n.attrs]
    if loaded is None:
        if marked:
            report('ERROR', f'{len(marked)} element(s) carry data-rt-component but the page has no usable schema: none of them gets fields')
        elif bound:
            report('ERROR', f'{len(bound)} element(s) carry data-rt-value but the page has no usable schema')
        elif not any(l == 'ERROR' for l, _ in lines):
            report('NOTE', f'no {SCHEMA_TYPE} schema: the page is edited as plain markup')
        if lives:
            report('NOTE', f'declared Live areas: {", ".join(n.attrs[LIVE] or n.tag for n in lives)}')
        return lines, None
    schema, values = loaded

    roots, inline_roots = [], []
    for n in marked:
        ctype = n.attrs['data-rt-component']
        if ctype not in schema:
            report('WARN', f'{n.describe()}: data-rt-component="{ctype}" is not in the schema, so it stays plain markup')
        elif is_derived(n):
            report('ERROR', f'{n.describe()}: a component root may not be a derived node')
        elif schema[ctype]['inline']:
            inline_roots.append(n)
        elif in_running_text(n):
            report('WARN', f'{n.describe()}: sits in running text (text beside it), so the editor leaves it to its paragraph and it gets no fields. '
                           'Declare the type "inline": true to edit it through its paragraph')
        else:
            roots.append(n)
    root_set = set(map(id, roots + inline_roots))
    live_set = set(map(id, lives))

    def enclosing_root(n):
        for a in n.ancestors():
            if id(a) in root_set:
                return a
        return None

    def in_live(n):
        return any(id(a) in live_set for a in [n, *n.ancestors()])

    # An inline root without a title is named by its own words: its text without its fields'
    # elements. Text outside them (a page value in the note, a note that is not a field) joins the name.
    def own_words(n):
        out = []
        for c in n.children:
            if isinstance(c, str):
                out.append(c)
            elif 'data-rt-field' not in c.attrs:
                out.append(own_words(c))
        return ''.join(out)
    def under_field(d, root):
        while d is not None and d is not root:
            if 'data-rt-field' in d.attrs:
                return True
            d = d.parent
        return False
    for n in inline_roots:
        if schema[n.attrs['data-rt-component']]['title']:
            continue
        stray = [d for d in n.descendants() if VALUE in d.attrs and not under_field(d, n)]
        if stray:
            words = LAYOUT_SPACE.sub(' ', own_words(n)).strip()
            report('NOTE', f'{n.describe()}: named by its own words, "{words[:60]}", which take in the page value "{stray[0].attrs[VALUE]}"; '
                           'mark its element a field (data-rt-field) to keep it out of the name')

    def target_of(root, field):
        if field['target'] == ':scope':
            return root, True
        try:
            groups = parse_selector(field['target'])
        except Unsupported:
            return None, False
        for d in root.descendants():
            if any(match_parts(d, g, root) for g in groups):
                if is_derived(d) or id(d) in root_set or enclosing_root(d) is not root:
                    continue
                return d, True
        return None, True

    for n in everything:
        if 'data-rt-field' in n.attrs and enclosing_root(n) is None and id(n) not in root_set:
            report('WARN', f'{n.describe()}: data-rt-field="{n.attrs["data-rt-field"]}" is outside any component root; it does nothing')

    used = set()
    unchecked = set()
    all_roots = roots + inline_roots
    for ctype, cdef in schema.items():
        instances = [r for r in all_roots if r.attrs['data-rt-component'] == ctype]
        if not instances:
            report('NOTE', f'type "{ctype}" is declared but no instance is on this page')
            continue
        used.add(ctype)
        for field in cdef['fields']:
            missing = 0
            for root in instances:
                target, checked = target_of(root, field)
                if not checked:
                    unchecked.add(f'{ctype}.{field["name"]} ({field["target"]})')
                    break
                if target is None:
                    missing += 1
                    continue
                check_value(root, field, target, root_set, values, in_live, report)
            if missing == len(instances) and missing:
                report('NOTE', f'{ctype}.{field["name"]}: its target {field["target"]} is in none of the {len(instances)} instance(s), '
                               'so the field shows disabled everywhere. Fine for a field another edition of the page uses; otherwise check the target')
            elif missing:
                report('NOTE', f'{ctype}.{field["name"]}: missing in {missing} of {len(instances)} instance(s); disabled there ("Not in this component")')
        if cdef['title']:
            title_field = next(f for f in cdef['fields'] if f['name'] == cdef['title'])
            untitled = [r for r in instances if target_of(r, title_field)[0] is None]
            if untitled:
                report('NOTE', f'{ctype}: {len(untitled)} instance(s) have no "{cdef["title"]}" to be named by; ' +
                       ('the paragraph\'s Settings names them by their own words' if cdef['inline'] else 'Layers shows the label alone'))
    for u in sorted(unchecked):
        report('NOTE', f'{u}: selector not checked by this script (sibling combinators or pseudo-classes); check it in the editor')

    check_values(bound, values, in_live, report)
    for n in lives:
        root = enclosing_root(n)
        if id(n) in root_set:
            report('WARN', f'{n.describe()}: a component root declared Live: all its fields are disabled')
        elif root is not None:
            report('NOTE', f'{n.describe()}: Live inside {root.attrs["data-rt-component"]}; that component cannot be copied, and fields in the area are disabled')
    if lives:
        report('NOTE', f'declared Live areas ({len(lives)}): {", ".join(n.attrs[LIVE] or n.tag for n in lives)}')

    page_js = '\n'.join(s[1] for s in b.scripts if s[0].get('type', '').strip().lower() in ('', 'text/javascript', 'module', 'application/javascript'))
    if roots and 'rt-editor:' not in page_js:
        report('NOTE', 'no inline page script listens for rt-editor:select / rt-editor:change; fine for static components, needed if the page opens, reveals or derives parts')
    repeated = [t for t in used if schema[t]['repeat']]
    if repeated and 'rt-editor:change' in page_js and 'rt-editor:remove' not in page_js:
        report('NOTE', f'{", ".join(repeated)} can be duplicated, moved and deleted from Settings: if the script draws anything from the '
                       'set of instances (a chart, a count, a filter), redraw on rt-editor:remove and rt-editor:add too')
    summary = ', '.join(f'{t} x{sum(1 for r in all_roots if r.attrs["data-rt-component"] == t)}' for t in schema if t in used)
    if bound:
        summary += (', ' if summary else '') + ', '.join(
            f'value {v} x{sum(1 for n in bound if n.attrs[VALUE] == v)}' for v in sorted({n.attrs[VALUE] for n in bound}))
    return lines, summary or 'no instances'


def check_values(bound, values, in_live, report):
    by_name = {}
    for n in bound:
        name = n.attrs[VALUE]
        if name not in values:
            report('WARN', f'{n.describe()}: data-rt-value="{name}" is not in the schema\'s "values"; it stays plain text')
            continue
        if is_derived(n):
            report('WARN', f'{n.describe()}: a page value inside a derived node is never written (derived nodes are not content)')
            continue
        if n.elements():
            report('WARN', f'{n.describe()}: data-rt-value="{name}" holds markup ({", ".join(sorted({"<" + k.tag + ">" for k in n.elements()}))}); '
                           'an edit of the value replaces it with plain text')
        by_name.setdefault(name, []).append(n)
    for name in values:
        els = by_name.get(name, [])
        if not els:
            report('NOTE', f'page value "{name}" is declared but no element shows it')
            continue
        texts = [LAYOUT_SPACE.sub(' ', n.text()).strip() for n in els if not in_live(n)]
        live = sum(1 for n in els if in_live(n))
        differ = sum(1 for t in texts if texts and t != texts[0])
        bits = [f'page value "{name}": {len(els)} place(s)']
        if live:
            bits.append(f'{live} in a Live area (left as it is)')
        if differ:
            bits.append(f'{differ} say something else than "{texts[0]}"; an edit writes one text in all of them')
        report('WARN' if differ else 'NOTE', '; '.join(bits))


def check_value(root, field, target, root_set, values, in_live, report):
    where = f'{root.attrs["data-rt-component"]}.{field["name"]} in {root.describe()}'
    ftype, attr = field['type'], field['attr']
    if ftype == 'image':
        if target.tag != 'img':
            report('ERROR', f'{where}: an image field needs an <img> target, found <{target.tag}>')
        return
    if in_live(target):
        report('NOTE', f'{where}: in a declared Live area, so the field is disabled')
    owns_text = (ftype == 'text' and not attr) or ftype == 'date'
    if owns_text:
        bound = [d for d in [target, *target.descendants()] if VALUE in d.attrs and d.attrs[VALUE] in values]
        kids = target.elements()
        if bound:
            report('NOTE', f'{where}: holds the page value "{bound[0].attrs[VALUE]}", so the field is disabled; '
                           'the text is changed under Page values (or the field targets an element beside the value)')
        elif kids:
            tags = ', '.join(sorted({'<' + k.tag + '>' for k in kids}))
            inner_fields = [d for d in target.descendants() if 'data-rt-field' in d.attrs]
            if inner_fields:
                report('WARN', f'{where}: its element contains other fields ({", ".join(d.attrs["data-rt-field"] for d in inner_fields)}); the first edit replaces them with plain text')
            else:
                report('WARN', f'{where}: its element contains markup ({tags}); the first edit replaces it with plain text. Split it into one field per element')
        nested = [d for d in target.descendants() if id(d) in root_set]
        if nested:
            report('WARN', f'{where}: contains a nested component; an edit would remove it')
    value = None
    if ftype == 'toggle':
        return
    if attr:
        value = target.attrs.get(attr)
    else:
        value = LAYOUT_SPACE.sub(' ', target.text()).strip()
    if value is None:
        value = ''
    if field['required'] and not value.strip():
        report('WARN', f'{where}: required but empty now')
    if field['maxLength'] and len(value) > field['maxLength']:
        report('WARN', f'{where}: current value is {len(value)} characters, over maxLength {field["maxLength"]}; edits are refused until it is shortened')
    if ftype == 'select' and value and value not in field['options']:
        report('WARN', f'{where}: current {attr}="{value}" is not one of the options; the dropdown shows it as "(current)"')
    if ftype == 'select' and not value and '' not in field['options']:
        report('NOTE', f'{where}: no {attr} and no option with value ""; the dropdown shows "(none) (current)"')
    if ftype == 'date' and value:
        has = iso_precision(value)
        if has is None:
            report('WARN', f'{where}: {attr}="{value}" is not YYYY-MM-DD, YYYY-MM or YYYY; the date field shows empty')
        elif not date_fits(field['precision'], has):
            report('WARN', f'{where}: {attr}="{value}" is a {has}, but the field takes a {field["precision"]}' +
                   (' (or a year)' if field['precision'] == 'day' else '') + '; it cannot be edited back as it is')
    if ftype == 'text' and value:
        if field['number']:
            err = number_error(field['number'], value)
            if err:
                report('WARN', f'{where}: current value "{value}" is {err}; the number field refuses it until it is fixed')
        if field['pattern'] is not None and not field['pattern'].match(value):
            report('WARN', f'{where}: current value "{value}" does not match "pattern"; the field refuses it until it is fixed')
    if value and (ftype == 'url' or (attr in URL_ATTRS)) and not is_web_url(value):
        report('WARN', f'{where}: {attr}="{value}" is not a web URL; the field will not accept it back')


def main(paths):
    if not paths:
        print(__doc__.strip())
        return 2
    if any(p in ('-h', '--help') for p in paths):
        print(__doc__.strip())
        return 0
    failed = False
    for path in paths:
        lines, summary = check_page(path)
        print(f'{path}')
        if summary:
            print(f'  components: {summary}')
        order = {'ERROR': 0, 'WARN': 1, 'NOTE': 2}
        for level, msg in sorted(lines, key=lambda x: order[x[0]]):
            print(f'  {level:<5}  {msg}')
        errors = sum(1 for l, _ in lines if l == 'ERROR')
        warns = sum(1 for l, _ in lines if l == 'WARN')
        print(f'  -> {errors} error(s), {warns} warning(s)\n')
        failed = failed or errors > 0
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
