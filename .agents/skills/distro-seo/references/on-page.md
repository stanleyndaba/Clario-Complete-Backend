# On-Page SEO reference

Load this when the issue mentions title tags, meta descriptions, H1 or heading hierarchy, image alt text, internal links, content-to-code ratio, thin content, Open Graph, or Twitter Card.

---

## 1. Title tag missing, generic, or duplicate

**Audit (every URL in the sitemap)**:
```bash
curl -s https://example.com/sitemap.xml | grep -oE '<loc>[^<]+' | sed 's|<loc>||' | while read url; do
  title=$(curl -s "$url" | grep -oE '<title>[^<]+' | head -1)
  echo "$url || $title"
done
```

**Rules**:
- 50 to 60 characters (Google truncates ~60).
- Unique per page.
- Primary keyword near the front.
- Brand at the end (homepage exception: brand first).

**Templates**:
- Product: `[Product] | [Category] | [Brand]`
- Article: `[Title]: [Subhead] | [Brand]`
- Homepage: `[Brand]: [One-line value prop]`

```html
<title>Premium Blue Widgets | Wholesale Pricing | Acme</title>
```

**Next.js (App Router)**:
```ts
export const metadata = { title: 'Premium Blue Widgets | Wholesale Pricing | Acme' }
```
Or with a template:
```ts
// app/layout.tsx
export const metadata = { title: { default: 'Acme', template: '%s | Acme' } }
// app/products/[slug]/page.tsx
export const metadata = { title: 'Premium Blue Widgets' }   // becomes "Premium Blue Widgets | Acme"
```

**Verify**: Lighthouse SEO "Document has a `<title>` element" passes. No duplicate titles across the site (re-run the audit script above).

---

## 2. Meta description missing or duplicate

**Rules**:
- 150 to 160 characters.
- Unique per page.
- Includes primary keyword + a CTA or differentiator.
- Reflects page content (don't bait-and-switch).

```html
<meta name="description" content="Wholesale blue widgets at 40% off retail. Free shipping over $50, 30-day returns, 4.9 stars from 12,000 buyers. Shop the full range.">
```

**Next.js**:
```ts
export const metadata = { description: 'Wholesale blue widgets at 40% off retail. ...' }
```

**Astro**: `<meta name="description" content={description}>` in the layout, with `description` per-page from frontmatter.

**Verify**: every indexable page has a unique description. Lighthouse SEO check passes.

---

## 3. H1 missing, multiple, or duplicate

**Rules**:
- Exactly one `<h1>` per page (HTML5 lets you have more, but for SEO clarity, stick to one).
- Matches the search intent and the title tag's core keyword.
- Unique per page.

```html
<h1>Premium Blue Widgets, Built to Last</h1>
```

**Audit**:
```bash
curl -s https://example.com/page | grep -oE '<h1[^>]*>[^<]+' | wc -l   # should be 1
```

**Heading hierarchy**: do not skip levels (h1 → h2 → h3, never h1 → h3). Section your content semantically — `<section><h2>...` for top-level groupings, `<article><h2>...` for self-contained pieces.

**Verify**: 1 H1 per page. No skipped heading levels (Lighthouse Accessibility "Heading elements appear in a sequentially-descending order").

---

## 4. Image alt text missing

**Audit**:
```bash
curl -s https://example.com | grep -oE '<img[^>]+>' | grep -v 'alt='
```

**Rules**:
- Decorative images: `alt=""` (empty string, intentional).
- Content images: descriptive, includes context (50 to 125 chars).
- Avatars: `alt="Photo of Jane Doe"`.
- Logos: `alt="Brand Name logo"`.
- No keyword stuffing — this is for accessibility *and* SEO; stuffing breaks both.

```html
<img src="/widget.webp" alt="Blue widget with brushed-aluminum housing, mounted on a wood desk">
```

**Verify**: 0 `<img>` without `alt`. Lighthouse Accessibility "Image elements have `[alt]` attributes" passes.

---

## 5. Internal links broken or orphan pages

**Audit**:
```bash
npx broken-link-checker https://example.com --recursive
```

**Fix**:
- Broken internal links → 301 to closest match, or restore the page.
- Orphan pages → link from homepage, hub page, or related content. Every indexable page should be reachable from the homepage in <= 3 clicks.
- Anchor text → descriptive. "Learn more" → "Read the case study on growth tactics for indie SaaS".

**Verify**: 0 internal 404s. Crawl depth <= 3 for every indexable URL.

---

## 6. Low content-to-code ratio

**Why it matters**: bloated HTML relative to text reduces semantic density, lowers crawl efficiency, weakens AI citation likelihood. Target >= 10%.

**Diagnose**:
```bash
url="https://example.com"
total=$(curl -s "$url" | wc -c)
text=$(curl -s "$url" | sed 's/<[^>]*>//g' | tr -s ' \n\t' ' ' | wc -c)
echo "ratio: $(echo "scale=3; $text / $total * 100" | bc)%"
```

**Fix patterns**:
- **Surface real data**: turn database stats and FAQ answers into visible body copy. 50 to 100 words per FAQ answer, not 1 sentence.
- **Add a 150-300 word "How it works" or "About the data" section** between hero and main content.
- **Expand FAQ items** with full answers, schema-marked (see `technical.md` Issue 7).
- **Remove unused CSS / JS** (see `cwv.md` Issues 6, 7) — markup bloat hurts the ratio directly.
- **Inline only critical CSS** (`cwv.md` Issue 1) — but balance, too much inline pushes the ratio down.

Example FAQ expansion:
```html
<!-- Before: 12 words of body text -->
<h3>Where does the data come from?</h3>
<p>Public sources.</p>

<!-- After: 60 words, schema-friendly, citable -->
<div itemscope itemtype="https://schema.org/Question">
  <h3 itemprop="name">Where does the data come from?</h3>
  <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
    <p itemprop="text">All tactics are extracted from public sources: founder
    interviews, App Store review histories, X threads, podcast transcripts,
    and Product Hunt launch pages. Each tactic is manually verified against
    the cited source before publication. We re-check sources weekly and retire
    any that go behind a paywall or get deleted.</p>
  </div>
</div>
```

**Verify**: ratio >= 10%. Recompute with the snippet above.

---

## 7. Thin content (< 300 words on indexable page)

**Audit**:
```bash
curl -s https://example.com/page | sed 's/<[^>]*>//g' | wc -w
```

**Fix**:
- Category / list page → add a 200-word intro framing the category.
- Product page → spec table + use-case section + FAQ.
- Tag pages with no content → noindex them (`<meta name="robots" content="noindex">`), don't bulk up with filler.
- Thin blog posts → merge into a stronger pillar post, 301 the old URL.

Don't fake depth. Google detects AI-generated thin filler now and demotes it.

**Verify**: every indexable page has > 300 words of unique substantive copy.

---

## 8. Open Graph + Twitter Card tags missing

**Fix template**:
```html
<meta property="og:title" content="Premium Blue Widgets | Acme">
<meta property="og:description" content="Wholesale pricing, free shipping over $50.">
<meta property="og:image" content="https://example.com/og/widgets.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="https://example.com/widgets">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Acme">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Premium Blue Widgets | Acme">
<meta name="twitter:description" content="Wholesale pricing, free shipping over $50.">
<meta name="twitter:image" content="https://example.com/og/widgets.png">
<meta name="twitter:site" content="@acme">
```

**Next.js**:
```ts
export const metadata = {
  openGraph: {
    title: 'Premium Blue Widgets | Acme',
    description: '...',
    images: [{ url: 'https://example.com/og/widgets.png', width: 1200, height: 630 }],
    url: 'https://example.com/widgets',
    siteName: 'Acme',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Premium Blue Widgets | Acme',
    description: '...',
    images: ['https://example.com/og/widgets.png'],
  },
}
```

**Dynamic OG image** (Next.js): `app/opengraph-image.tsx` returning JSX rendered via `@vercel/og`.

**Verify**: paste URL into https://opengraph.dev/ — image renders 1200x630, all four critical meta tags present.
