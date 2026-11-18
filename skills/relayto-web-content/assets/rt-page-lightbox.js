/* rt-page-lightbox.js: page references open the document in a lightbox (RELAYTO web content).
   A link to one page of a RELAYTO content, /e/<slug>?…&page=<0-based index>, shows RELAYTO's embed
   of that content on that page over the current page instead of navigating away. Links without
   page= (an "Open the report" button) navigate as usual.

   Use: upload next to the page's own script and add, before </body>:
     <script src="https://cdn.relayto.com/workspace/<id>/files/<folder>/js/rt-page-lightbox.js"></script>
   Optional, on a link: data-rt-lightbox-title="Q3 2026 earnings slides" (the bar's title; else the
   link's text), data-rt-lightbox="off" (navigate instead).
   Optional, in the page CSS: --rtlb-accent (button colour, default #fff), --rtlb-ink (its text),
   --rtlb-bar (bar background, default #000), --font-body.

   Visitors only: in RELAYTO's editor it does nothing (links don't navigate there). The overlay is a
   full-screen fixed element with a z-index, which also makes RELAYTO's floating chat and
   call-to-action step aside while it is open. The click listener runs in the capture phase on the
   page's own root, before RELAYTO routes the link inside the app. */
(() => {
  const doc = document;
  const root = doc.documentElement;
  // Once per page: a marker on the page's own root, not a global (globals outlive the page in
  // RELAYTO's app window, so a global flag would switch it off on the next visit).
  if (root.hasAttribute('data-rt-editor') || root.hasAttribute('data-rtlb-ready')) return;
  root.setAttribute('data-rtlb-ready', '');
  const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const CSS = '.rtlb{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:clamp(12px,3vw,40px);background:rgba(0,0,0,.78);opacity:0;transition:opacity .2s ease}'
    + '.rtlb.is-open{opacity:1}'
    + '.rtlb__box{display:flex;flex-direction:column;width:min(1280px,100%);height:min(860px,100%);background:var(--rtlb-bar,#000);box-shadow:0 24px 80px rgba(0,0,0,.5)}'
    + '.rtlb__bar{display:flex;align-items:center;gap:16px;padding:10px 10px 10px 18px;color:#fff;font:500 15px/1.3 var(--font-body,Arial,sans-serif)}'
    + '.rtlb__title{flex:1;min-width:0;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.rtlb__open{color:var(--rtlb-ink,#000);background:var(--rtlb-accent,#fff);border-radius:999px;padding:9px 16px;text-decoration:none;white-space:nowrap}'
    + '.rtlb__close{flex:none;width:40px;height:40px;border:0;border-radius:999px;background:rgba(255,255,255,.14);color:#fff;font:400 24px/1 Arial,sans-serif;cursor:pointer}'
    + '.rtlb__close:hover,.rtlb__open:hover{background:#fff;color:#000}'
    + '.rtlb__frame{flex:1;width:100%;border:0;background:#fafafa}'
    + '@media (max-width:700px){.rtlb{padding:0}.rtlb__box{height:100%}.rtlb__open{display:none}}'
    + '@media (prefers-reduced-motion:reduce){.rtlb{transition:none}}';
  let box = null;
  let lastFocus = null;

  function close() {
    if (!box) return;
    const b = box;
    box = null;
    b.classList.remove('is-open');
    setTimeout(() => b.remove(), reduce ? 0 : 200);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function open(link) {
    const href = link.getAttribute('href');
    const url = new URL(href, location.origin);
    const page = parseInt(url.searchParams.get('page'), 10) || 0;
    const embed = new URL(url.pathname, location.origin);
    embed.searchParams.set('embed', '1');
    embed.searchParams.set('w', '2'); // no RELAYTO logo in the embed's controls
    embed.searchParams.set('page', String(page));
    if (!doc.querySelector('style[data-rtlb]')) {
      const st = doc.createElement('style');
      st.setAttribute('data-rtlb', '');
      st.textContent = CSS;
      (doc.head || root).appendChild(st);
    }
    close();
    lastFocus = link;
    const name = link.getAttribute('data-rt-lightbox-title') || link.textContent.replace(/\s+/g, ' ').trim();
    const title = name + (/\bp(age|\.)\s*\d/i.test(name) ? '' : ', page ' + (page + 1));
    const b = doc.createElement('div');
    b.className = 'rtlb';
    b.setAttribute('data-rt-derived', '');
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-modal', 'true');
    b.setAttribute('aria-label', title);
    b.innerHTML = '<div class="rtlb__box"><div class="rtlb__bar"><p class="rtlb__title"></p>'
      + '<a class="rtlb__open">Open the full document</a>'
      + '<button type="button" class="rtlb__close" aria-label="Close">×</button></div>'
      + '<iframe class="rtlb__frame" allow="fullscreen" allowfullscreen></iframe></div>';
    b.querySelector('.rtlb__title').textContent = title;
    b.querySelector('.rtlb__open').setAttribute('href', href);
    const frame = b.querySelector('.rtlb__frame');
    frame.title = title;
    frame.src = embed.pathname + embed.search;
    (doc.body || root).appendChild(b);
    box = b;
    requestAnimationFrame(() => b.classList.add('is-open'));
    b.querySelector('.rtlb__close').focus();
  }

  root.addEventListener('click', (e) => {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (!t || !t.closest) return;
    if (box) {
      if (t.closest('.rtlb__close') || t === box) { e.preventDefault(); close(); return; }
      if (t.closest('.rtlb__open')) { close(); return; }
    }
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = t.closest('a[href^="/e/"]');
    if (!a || a.getAttribute('data-rt-lightbox') === 'off' || !/[?&]page=\d+/.test(a.getAttribute('href'))) return;
    e.preventDefault();
    e.stopPropagation();
    open(a);
  }, true);
  window.addEventListener('keydown', (e) => { if (box && e.key === 'Escape') close(); });
})();
