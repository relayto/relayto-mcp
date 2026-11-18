# Third-party embeds in a RELAYTO page

Embed snippets that are a `<script src=…>` reading its own settings ("copy this code") usually
find themselves with `document.currentScript`. RELAYTO's viewer runs a page's scripts against a
stand-in document, where that is not the snippet's tag, so the snippet aborts and the box stays
empty. Almost every such widget is an iframe in the end: build the iframe in `app.js` instead.

Wrap it as a component so editors can change its settings, and declare the container the script
fills as Live:

```html
<figure class="quote-card" data-rt-component="share-price" data-symbol="NASDAQ:AAPL" data-range="12M">
  <figcaption data-rt-field="label">Apple Inc. · NASDAQ: AAPL</figcaption>
  <div class="quote-card__chart" data-rt-live="Share price"></div>
  <p class="quote-card__note"><span data-rt-field="note">Delayed quote by TradingView.</span></p>
</figure>
```

```json
"share-price": {
  "label": "Share price",
  "fields": [
    {"name": "label", "label": "Caption", "type": "text"},
    {"name": "symbol", "label": "Symbol (EXCHANGE:TICKER)", "type": "text", "target": ":scope", "attr": "data-symbol",
     "pattern": "[A-Z0-9_]+:[A-Z0-9_.]+", "patternHelp": "Like NASDAQ:AAPL or LSE:AZN"},
    {"name": "range", "label": "Default range", "type": "select", "target": ":scope", "attr": "data-range",
     "options": [{"value": "1M", "label": "1 month"}, {"value": "12M", "label": "1 year"}, {"value": "60M", "label": "5 years"}]},
    {"name": "note", "label": "Note", "type": "text"}
  ]
}
```

## TradingView symbol overview

The widget's iframe takes its settings as URL-encoded JSON in the hash, with `locale` in the query:

```js
(() => {
  const HOST = 'https://www.tradingview-widget.com/embed-widget/symbol-overview/';
  const css = (el, name, fallback) =>
    getComputedStyle(el).getPropertyValue(name).trim() || fallback;

  function draw(root) {
    const box = root.querySelector('[data-rt-live]');
    if (!box) return;
    const symbol = root.getAttribute('data-symbol');
    const name = (root.querySelector('[data-rt-field=label]') || {}).textContent || symbol;
    const line = css(root, '--brand-primary', '#2962ff');
    const settings = {
      symbols: [[name.trim(), symbol + '|' + (root.getAttribute('data-range') || '12M')]],
      chartOnly: false, width: '100%', height: '100%', autosize: true,
      colorTheme: 'light', isTransparent: true,
      chartType: 'area', lineColor: line, topColor: line + '33', bottomColor: line + '00', lineWidth: 2,
      fontFamily: css(root, '--font-body', 'system-ui, sans-serif'), fontColor: css(root, '--ink', '#222'),
      showVolume: false, showMA: false, hideDateRanges: false, hideMarketStatus: false, hideSymbolLogo: true,
      scalePosition: 'right', scaleMode: 'Normal', valuesTracking: '1', changeMode: 'price-and-percent',
      dateRanges: ['1d|1', '1m|30', '3m|60', '12m|1D', '60m|1W', 'all|1M'],
      utm_source: location.hostname, utm_medium: 'widget', utm_campaign: 'symbol-overview'
    };
    const frame = document.createElement('iframe');
    frame.title = name.trim() + ' share price';
    frame.loading = 'lazy';
    frame.setAttribute('frameborder', '0');
    frame.setAttribute('allowtransparency', 'true');
    frame.src = HOST + '?locale=en#' + encodeURIComponent(JSON.stringify(settings));
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
    box.replaceChildren(frame);
  }

  const all = () => document.querySelectorAll('[data-rt-component=share-price]').forEach(draw);
  all();
  // In the editor: redraw after a field edit (the editor may also have replaced the elements).
  document.addEventListener('rt-editor:change', (e) => {
    const root = e.target.closest && e.target.closest('[data-rt-component=share-price]');
    if (root) draw(root);
  });
})();
```

- On a dark field use `colorTheme: 'dark'` and a light `fontColor`; the card behind the transparent
  iframe gives the background.
- `topColor`/`bottomColor` take 8-digit hex (`#RRGGBBAA`): give `--brand-primary` as `#RRGGBB`.
- Give the container an explicit height (`aspect-ratio` or `height`), the iframe fills it.
- The widget's own fonts and colours are only partly configurable; the card around it carries the
  brand.
- The quote is delayed and its content is not indexed by the chat (it is script output). State
  the period figures in markup elsewhere on the page.
- For a single-line ticker use `embed-widget/single-quote/` with `{symbol, colorTheme,
  isTransparent, width: '100%'}`, or `embed-widget/mini-symbol-overview/` for a compact chart.
