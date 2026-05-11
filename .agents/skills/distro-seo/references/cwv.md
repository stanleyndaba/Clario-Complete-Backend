# Core Web Vitals + Page Speed reference

Load this when the issue mentions LCP, INP, CLS, FCP, TTFB, Lighthouse Performance, render-blocking, unused JS / CSS, image weight, image format, cache policy, third-party code, long tasks, large payload, or font loading.

## Targets

| Metric | Good | Needs work | Poor |
|---|---|---|---|
| LCP | <= 2.5 s | 2.5 to 4 s | > 4 s |
| INP | <= 200 ms | 200 to 500 ms | > 500 ms |
| CLS | <= 0.1 | 0.1 to 0.25 | > 0.25 |
| FCP | <= 1.8 s | 1.8 to 3 s | > 3 s |
| TTFB | <= 800 ms | 800 to 1.8 s | > 1.8 s |

Google measures at p75 of CrUX field data. Lab data (Lighthouse) diverges from field.

---

## 1. Render-blocking resources

**Symptom**: Lighthouse "Eliminate render-blocking resources". Synchronous CSS in `<head>` and `<script>` without `defer`/`async` block first paint and LCP.

**Diagnose**:
```bash
curl -s "https://example.com" | grep -E '<link[^>]+stylesheet|<script[^>]+src' | grep -v 'defer\|async'
```

**Fix**:
```html
<style>/* critical above-the-fold CSS, ideally < 14 KB */</style>
<link rel="preload" href="/styles/main.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="/styles/main.css"></noscript>

<script src="/js/analytics.js" defer></script>
<script src="/js/widget.js" async></script>
```

**Next.js**:
```tsx
import Script from 'next/script'
<Script src="https://cdn.example/analytics.js" strategy="lazyOnload" />
```
Use `strategy="afterInteractive"` for chat widgets, `strategy="worker"` (experimental) to push to a Web Worker.

**Astro**: `client:idle`, `client:visible`, `client:media` directives on islands. `<script is:inline async>` for global.

**Verify**: Lighthouse "render-blocking resources" audit drops to 0. LCP falls 200 to 1500 ms depending on baseline.

---

## 2. LCP > 2.5 s

**Diagnose** (DevTools console):
```js
new PerformanceObserver((list) => {
  const last = list.getEntries().at(-1)
  console.log('LCP:', last.startTime.toFixed(0), 'ms', 'element:', last.element)
}).observe({ type: 'largest-contentful-paint', buffered: true })
```

**Root-cause tree**:

| Sub-cause | Check | Fix |
|---|---|---|
| TTFB > 800 ms | `curl -w '%{time_starttransfer}'` | See Issue 5 |
| LCP element is image | observer prints an `<img>` | Image LCP fix below |
| LCP element is text | observer prints a text node | See Issue 15 (font blocking) |
| Render-blocking CSS / JS | head full of sync `<link>`/`<script>` | See Issue 1 |
| LCP added by JS post-hydration | `view-source` lacks the LCP node | SSR / SSG / streaming |

**Image LCP fix**:
```html
<link rel="preload" as="image" href="/hero.avif" fetchpriority="high"
      imagesrcset="/hero-640.avif 640w, /hero-1280.avif 1280w" imagesizes="100vw">
<img src="/hero.avif" alt="..." width="1280" height="720" fetchpriority="high">
```
Never `loading="lazy"` on the LCP image — it pushes LCP later.

**Next.js**:
```tsx
<Image src="/hero.avif" alt="..." width={1280} height={720} priority fetchPriority="high"
       sizes="(max-width: 768px) 100vw, 1280px" />
```
For a remote LCP image, register the domain in `next.config.ts` `images.remotePatterns`.

**Verify**: PSI mobile LCP < 2.5 s. Observer's element matches the intended hero.

---

## 3. INP > 200 ms

**Diagnose**:
```js
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (e.duration > 200) console.warn('Slow interaction', {
      type: e.name, duration: e.duration, target: e.target,
      processing: e.processingEnd - e.processingStart
    })
  }
}).observe({ type: 'event', buffered: true, durationThreshold: 16 })
```

**Common causes + fixes**:

1. **Long task in click handler** — yield, then compute:
```js
button.addEventListener('click', async () => {
  button.classList.add('is-loading')                // immediate visual feedback
  await new Promise(r => requestAnimationFrame(r))  // yield once
  const result = expensiveCompute(items)
  render(result)
})
```

2. **React re-render storm** — wrap heavy children in `React.memo`, move state down, use `useDeferredValue` for filter inputs.

3. **Third-party widgets** — defer chat / analytics until idle or first interaction:
```js
const load = () => import('https://widget.example/embed.js')
window.addEventListener('scroll', load, { once: true, passive: true })
window.addEventListener('click', load, { once: true })
```

4. **Large DOM** (> 1500 nodes) — paginate, virtualize lists (`react-window`, `vue-virtual-scroller`, native `content-visibility: auto`).

**Verify**: with DevTools 4x CPU throttle, the worst interaction logs INP < 200 ms.

---

## 4. CLS > 0.1

**Diagnose**:
```js
let cls = 0
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (!e.hadRecentInput) {
      cls += e.value
      console.log('shift', e.value, e.sources?.map(s => s.node))
    }
  }
}).observe({ type: 'layout-shift', buffered: true })
```

**Causes + fixes**:

| Cause | Fix |
|---|---|
| Images without dimensions | `width` + `height` (or CSS `aspect-ratio`) on every `<img>`, `<video>`, `<iframe>` |
| Web font swap | `font-display: optional`, or match fallback metrics with `size-adjust` |
| Ads / late embeds | Reserve `min-height` on the slot, `contain-intrinsic-size` for lazy content |
| Cookie banner pushing content | Render as overlay, not inline |
| Late hero | Skeleton placeholder of identical dimensions |

```css
img, video, iframe { aspect-ratio: attr(width) / attr(height); height: auto; }

@font-face {
  font-family: 'Brand';
  src: url('/fonts/brand.woff2') format('woff2');
  font-display: optional;
  size-adjust: 97.5%;
  ascent-override: 90%;
}
```

**Verify**: PSI field CLS < 0.1. Lab CLS in Lighthouse < 0.05.

---

## 5. TTFB > 800 ms

**Diagnose**:
```bash
for i in 1 2 3; do
  curl -o /dev/null -s -w "TTFB: %{time_starttransfer}s  Total: %{time_total}s\n" "https://example.com"
done
```

**Fixes by stack**:

| Stack | Fix |
|---|---|
| Static / SSG | Deploy to a CDN edge (Vercel, Cloudflare Pages, Netlify). TTFB drops to < 200 ms globally. |
| SSR (Next, Nuxt, SvelteKit) | Move latency-bound routes to Edge / Fluid Compute. Cache responses with `Cache-Control: s-maxage=60, stale-while-revalidate=300`. |
| WordPress / Shopify | Enable full-page cache, upgrade hosting tier, put Cloudflare in front, audit plugins. |
| DB-bound API | Index hot queries, add Redis between API and DB, batch N+1, paginate. |

Probe from 3 regions to confirm consistency. A US-only CDN with EU users will still show TTFB > 800 ms in CrUX.

**Verify**: PSI field TTFB < 800 ms.

---

## 6. Unused JavaScript

**Diagnose**: Chrome DevTools → Coverage tab (Cmd+Shift+P → "Coverage") → reload → sort by Unused Bytes desc.

**Fixes**:
- **Code-split routes**: dynamic `import()` for non-critical modules.
```js
const Editor = lazy(() => import('./Editor'))
```
- **Tree-shake**: import only what you use. `import { debounce } from 'lodash-es'`, not `import _ from 'lodash'`.
- **Replace heavy deps**: moment.js (300 KB) → date-fns or `Temporal`. lodash → native methods. axios → fetch.
- **Trim polyfills**: set `browserslist: ["> 0.5%, last 2 versions, not dead"]`.
- **Defer SDKs**: Stripe.js, Intercom, GA — load on interaction (see Issue 11).

**Verify**: re-record Coverage, target < 30% unused per file. Lighthouse "Reduce unused JavaScript" < 50 KB.

---

## 7. Unused CSS

**Diagnose**: same Coverage tab, filter by CSS.

**Fixes**:
- **Tailwind / utility CSS**: ensure `content` glob in `tailwind.config.ts` covers every template path. v4 uses `@source` directives.
- **Component CSS**: split global stylesheets, scope to components (CSS Modules, Vanilla Extract, CSS-in-JS).
- **Critical CSS**: inline above-the-fold CSS in `<head>`, async-load the rest (Issue 1).
- **Drop unused frameworks**: if Bootstrap is loaded for one button, replace the button.

One-shot tools:
```bash
npx purgecss --css "dist/**/*.css" --content "dist/**/*.html"
npx critical https://example.com --inline
```

**Verify**: unused CSS bytes < 20 KB.

---

## 8. Properly size images

**Diagnose**:
```bash
curl -s "https://example.com" | grep -oE 'src="[^"]+\.(jpg|png|webp|avif)[^"]*"' | sort -u
```
Open each in DevTools, compare natural size vs displayed size. Anything 2x+ over is wasted bytes.

**Fix**:
```html
<img src="/hero-1280.webp"
     srcset="/hero-640.webp 640w, /hero-1280.webp 1280w, /hero-2560.webp 2560w"
     sizes="(max-width: 768px) 100vw, 1280px"
     width="1280" height="720" alt="...">
```

**Next.js**: `<Image>` with `sizes` does srcset + responsive automatically.
**Astro**: `<Image>` from `astro:assets` with `widths` and `sizes`.

**Verify**: Lighthouse "Properly size images" passes. Wasted bytes < 50 KB.

---

## 9. Serve images in next-gen formats (AVIF / WebP)

**Convert in bulk**:
```bash
# AVIF (smallest, ~50% lighter than JPEG)
for img in src/assets/*.jpg; do
  npx @squoosh/cli --avif '{"cqLevel":33}' "$img" -d src/assets/
done

# WebP fallback
for img in src/assets/*.jpg; do cwebp -q 80 "$img" -o "${img%.jpg}.webp"; done
```

**Serve with `<picture>` for fallback**:
```html
<picture>
  <source type="image/avif" srcset="/hero.avif">
  <source type="image/webp" srcset="/hero.webp">
  <img src="/hero.jpg" alt="..." width="1280" height="720">
</picture>
```

Frameworks with built-in image components (Next, Astro, Nuxt, SvelteKit) emit both formats — verify the config.

**Verify**: payload reduction 30 to 70% per image. Lighthouse next-gen format audit passes.

---

## 10. Efficient cache policy on static assets

**Diagnose**:
```bash
curl -I "https://example.com/static/main.js" | grep -i cache-control
```
`max-age=0` or no header → fix.

**Vercel** (`vercel.ts`):
```ts
import { routes, type VercelConfig } from '@vercel/config/v1'
export const config: VercelConfig = {
  headers: [
    routes.cacheControl('/static/(.*)', { public: true, maxAge: '1 year', immutable: true }),
    routes.cacheControl('/_next/static/(.*)', { public: true, maxAge: '1 year', immutable: true }),
    routes.cacheControl('/(.*\\.(jpg|webp|avif|svg|woff2))', { public: true, maxAge: '1 year', immutable: true }),
  ],
}
```

**Nginx**:
```nginx
location ~* \.(js|css|woff2|webp|avif|jpg|png|svg)$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}
```

**Cloudflare Pages** (`_headers`):
```
/static/*
  Cache-Control: public, max-age=31536000, immutable
```

Hashed filenames (Vite, Next, Webpack default) make `immutable` safe.

**Verify**: re-load the asset, headers show `cache-control: public, max-age=31536000, immutable`.

---

## 11. Reduce unused third-party code

**Diagnose**: DevTools → Network → filter by Domain (third party).

**Fixes**:
- **Audit cost**: every third-party script costs LCP + INP. Drop anything below "must have".
- **Self-host fonts** (Google Fonts adds 200 to 500 ms):
```html
<!-- Drop this -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<!-- Add @font-face from local /fonts -->
```
- **Defer chat / analytics / A/B**:
```html
<script src="/intercom.js" defer></script>
```
- **Facade pattern**: render a static placeholder, boot the real widget on interaction (YouTube embeds, Disqus).

**Verify**: third-party byte budget < 200 KB. Long task count on first load drops.

---

## 12. Avoid enormous network payloads

**Budgets**:
- Total transfer < 1.5 MB compressed
- JS < 300 KB compressed
- CSS < 100 KB compressed
- Above-the-fold images < 800 KB total

**Common offenders**:
- Single hero > 500 KB → next-gen format + responsive (Issues 8, 9)
- Single JS bundle > 500 KB → code-split routes (Issue 6)
- All-in-one icon font (FontAwesome 200 KB+) → SVG sprites or per-icon imports

**Verify**: WebPageTest "Total Byte Weight" < 1.5 MB.

---

## 13. Long main-thread tasks

**Diagnose**:
```js
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) console.warn('long task', e.duration.toFixed(0), 'ms', e)
}).observe({ type: 'longtask', buffered: true })
```

**Fix**:
- Break loops with `await scheduler.yield()` (or `setTimeout(r, 0)`) every ~50 ms.
- Move CPU work to a Web Worker (`Comlink` simplifies).
- Defer hydration of below-the-fold islands (Astro `client:visible`, React Server Components).
- Audit third-party scripts (Issue 11).

**Verify**: 0 long tasks > 50 ms in the first 5 s after page load.

---

## 14. Layout shift sources

Cross-reference Issue 4. The CLS observer logs `e.sources[].node` — those are your culprits. Walk each, apply the matching fix from Issue 4's table.

---

## 15. Web fonts blocking text render

**Fix the FOIT**:
```css
@font-face {
  font-family: 'Brand';
  src: url('/fonts/brand.woff2') format('woff2');
  font-display: swap;
  /* OR font-display: optional; — no swap, no CLS, fallback wins on slow networks */
}
```

**Preload the critical font** (the one used in the LCP element):
```html
<link rel="preload" href="/fonts/brand-regular.woff2" as="font" type="font/woff2" crossorigin>
```

**Subset**: ship only the characters/weights you actually use. `glyphhanger` or `fonttools subset` cut a font ~80%.

**Self-host**: drop `fonts.googleapis.com`, ship the woff2 from same origin.

**Next.js**: `next/font/google` auto-self-hosts and inlines `font-display: swap` with zero CLS.

**Verify**: first-paint text within 100 ms. CLS contribution from font swap < 0.05.

---

## Lighthouse CI (lock the gains)

`.github/workflows/lighthouse.yml`:
```yaml
- uses: treosh/lighthouse-ci-action@v12
  with:
    urls: |
      https://example.com
      https://example.com/key-page
    budgetPath: ./budget.json
    uploadArtifacts: true
```

`budget.json`:
```json
[{
  "path": "/*",
  "timings": [
    {"metric": "interactive", "budget": 3000},
    {"metric": "first-contentful-paint", "budget": 1800}
  ],
  "resourceSizes": [
    {"resourceType": "script", "budget": 300},
    {"resourceType": "total", "budget": 1500}
  ]
}]
```
