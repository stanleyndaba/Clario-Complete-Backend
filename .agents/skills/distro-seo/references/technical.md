# Technical SEO reference

Load this when the issue mentions robots.txt, XML sitemap, canonical tags, HTTPS, mixed content, redirect chains, mobile viewport, tap targets, hreflang, structured data, JSON-LD, or rich results.

For AI-crawler robots.txt entries (GPTBot, PerplexityBot, ClaudeBot, Google-Extended), see `geo.md` Issue 1.

---

## 1. robots.txt missing, broken, or blocking key paths

**Fetch + lint**:
```bash
curl -s https://example.com/robots.txt
```

**Minimum healthy template**:
```
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/internal/

# Allow CSS, JS, images so Googlebot can render the page
Allow: /*.css$
Allow: /*.js$

Sitemap: https://example.com/sitemap.xml
```

**Common breakage**:
| Pattern | Effect | Fix |
|---|---|---|
| `Disallow: /` | Blocks the entire site, fatal | Remove |
| Blocking `/static/`, `/_next/`, `/assets/` | Googlebot can't render JS pages | Allow these |
| Missing `Sitemap:` directive | Slower discovery | Add it |
| `Disallow: /*?*` | Blocks every URL with a query string | Scope it (e.g., `Disallow: /*?sort=`) |

**Next.js (App Router)**: `app/robots.ts`:
```ts
import type { MetadataRoute } from 'next'
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin/', '/api/internal/'] }],
    sitemap: 'https://example.com/sitemap.xml',
  }
}
```

**Verify**: Google Search Console robots.txt tester reports no blocked critical paths. `curl -A "Googlebot" https://example.com -o /dev/null -w "%{http_code}\n"` returns 200.

---

## 2. XML sitemap missing or stale

**Audit**:
```bash
curl -s https://example.com/sitemap.xml | head -40
curl -s https://example.com/sitemap.xml | grep -c '<url>'
```

**Rules**:
- One URL per indexable canonical page.
- Accurate `<lastmod>` dates (not "today" for every page — Google detects and discounts).
- 50,000 URL / 50 MB cap per file. Use a sitemap index for larger sites.
- HTTPS-only URLs.
- Only URLs that return 200 (no redirects, no 404s).

**Hand-rolled**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2026-04-15</lastmod>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://example.com/blog/post-1</loc>
    <lastmod>2026-04-10</lastmod>
    <priority>0.7</priority>
  </url>
</urlset>
```

**Next.js (App Router)** — `app/sitemap.ts`:
```ts
import type { MetadataRoute } from 'next'
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getPosts()
  return [
    { url: 'https://example.com', lastModified: new Date(), priority: 1 },
    ...posts.map(p => ({
      url: `https://example.com/blog/${p.slug}`,
      lastModified: p.updatedAt,
      priority: 0.7,
    })),
  ]
}
```

For sites > 50,000 URLs, generate `app/sitemap.ts` returning a sitemap index, then per-segment sitemaps in route handlers.

**Submit**: Google Search Console → Sitemaps → submit `https://example.com/sitemap.xml`. Bing Webmaster Tools too. IndexNow API (Bing + Yandex) for instant push on changes.

**Verify**: sitemap returns 200, parses, URL count matches actual indexable pages.

---

## 3. Canonical tag missing or pointing wrong

**Rules**:
- Every indexable page has a self-referencing canonical: `<link rel="canonical" href="https://example.com/this-page">`.
- Absolute URL, HTTPS, no extraneous query params.
- Pagination: each page canonicals to **itself**, not to page 1.
- Faceted nav: canonical to the un-faceted version (or to the most valuable filtered combo if you want to rank for it).
- Don't canonical across languages — use `hreflang` for that (Issue 6).

**Audit**:
```bash
curl -s https://example.com/page | grep -i 'rel="canonical"'
```

**Fix template**:
```html
<link rel="canonical" href="https://example.com/products/blue-widget">
```

**Next.js**:
```ts
export const metadata = {
  alternates: { canonical: 'https://example.com/products/blue-widget' }
}
```

**Common mistake**: client-side router updates the URL but leaves the canonical pointing at the static prerendered path. Verify the canonical from `view-source`, not from rendered DOM.

**Verify**: every page has exactly one canonical tag, pointing to the HTTPS, lowercase, trailing-slash-normalized version of itself.

---

## 4. HTTPS / mixed content / redirect chains

**Audit**:
```bash
# Redirect chain
curl -sILo /dev/null -w "%{redirect_url} -> %{http_code}\n" http://example.com

# Mixed content (http:// inside https:// page)
curl -s https://example.com | grep -E 'http://[^"]+' | head -20
```

**Fix**:
- Force HTTPS at the edge. Single 301 from `http://` to `https://` (no chain).
- Force one canonical host: pick `www` or apex, redirect the other once. Two 301s (`http://www` → `https://www` → `https://example.com`) is one chain too many.
- Replace any in-HTML `http://` reference with `https://` or protocol-relative (`//example.com/...`).
- Add HSTS:
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```
- Submit to https://hstspreload.org/ once you're confident.

**Verify**: `http://example.com` → 301 → `https://example.com` in **one hop**. Zero `http://` references in HTML. SSL Labs grade A or A+.

---

## 5. Mobile viewport, tap targets, readability

**Fix**:
```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

**Tap targets** — every interactive element >= 44x44 px with >= 8 px gap:
```css
button, a.button { min-height: 44px; min-width: 44px; padding: 12px 16px; }
```

**Readability**:
- Body text >= 16 px.
- Line-height 1.5.
- Contrast ratio >= 4.5:1 (WCAG AA).
- Line length 50 to 75 characters max (`max-width: 65ch` on prose).

**Verify**: Lighthouse Mobile-Friendly + Accessibility passes. Google's Mobile-Friendly Test passes.

---

## 6. hreflang implementation broken

**Fix template** — every language variant has the **full** set, including a **self-reference** and an **x-default**:
```html
<link rel="alternate" hreflang="en" href="https://example.com/page">
<link rel="alternate" hreflang="fr" href="https://example.com/fr/page">
<link rel="alternate" hreflang="de" href="https://example.com/de/page">
<link rel="alternate" hreflang="x-default" href="https://example.com/page">
```

**Rules**:
- **Reciprocal**: if EN points to FR, FR must point back to EN. Otherwise Google ignores both.
- ISO 639-1 language codes (en, fr, de) and ISO 3166-1 region codes (en-US, en-GB, fr-CA).
- Include `x-default` as the language picker / fallback.
- Self-referencing entry required.

**Next.js**:
```ts
export const metadata = {
  alternates: {
    canonical: 'https://example.com/page',
    languages: {
      'en': 'https://example.com/page',
      'fr': 'https://example.com/fr/page',
      'de': 'https://example.com/de/page',
      'x-default': 'https://example.com/page',
    },
  },
}
```

**Verify**: https://technicalseo.com/tools/hreflang/ reports no errors.

---

## 7. Structured data missing or invalid

**Pick the schema** that matches the page intent:

| Page intent | Schema type |
|---|---|
| Homepage | `Organization` + `WebSite` (with `SearchAction` for sitelinks search box) |
| Article / blog post | `Article`, `BlogPosting`, or `NewsArticle` |
| Product listing | `Product` + `Offer` + `AggregateRating` |
| FAQ | `FAQPage` |
| Breadcrumb trail | `BreadcrumbList` |
| Local business | `LocalBusiness` |
| How-to | `HowTo` |
| Recipe | `Recipe` |
| Job posting | `JobPosting` |
| Event | `Event` |

**Article template**:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "How to Pick a Blue Widget",
  "image": ["https://example.com/img/widget.webp"],
  "datePublished": "2026-04-01T08:00:00+00:00",
  "dateModified": "2026-04-15T10:00:00+00:00",
  "author": [{"@type": "Person", "name": "Jane Doe", "url": "https://example.com/authors/jane"}],
  "publisher": {
    "@type": "Organization",
    "name": "Acme",
    "logo": {"@type": "ImageObject", "url": "https://example.com/logo.png"}
  }
}
</script>
```

**FAQPage template**:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Where does the data come from?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "All data is collected from public sources..."
      }
    }
  ]
}
</script>
```

**BreadcrumbList template**:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://example.com/"},
    {"@type": "ListItem", "position": 2, "name": "Products", "item": "https://example.com/products/"},
    {"@type": "ListItem", "position": 3, "name": "Blue Widget"}
  ]
}
</script>
```

**Organization with sameAs** (boosts knowledge-panel + AI citation):
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Acme",
  "url": "https://example.com",
  "logo": "https://example.com/logo.png",
  "sameAs": [
    "https://twitter.com/acme",
    "https://www.linkedin.com/company/acme",
    "https://github.com/acme"
  ]
}
```

**Don't fake it**: schema must reflect what's visible on the page. Faked `AggregateRating` or `Review` is a manual-action risk.

**Verify**: paste into https://validator.schema.org/ AND https://search.google.com/test/rich-results — 0 errors, 0 warnings.
