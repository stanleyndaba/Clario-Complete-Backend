# GEO (Generative Engine Optimization) reference

Load this when the issue mentions AI crawlers (GPTBot, PerplexityBot, ClaudeBot, Google-Extended, OAI-SearchBot, ChatGPT-User, CCBot, Bytespider, Applebot-Extended), llms.txt, AI search visibility, citability, JS-only rendering, or "GEO".

This is the highest-leverage domain in 2026: ChatGPT, Perplexity, Claude, Gemini, Copilot, and Google AI Overviews increasingly send referral traffic. If you're invisible to them, you're missing the new long tail.

---

## 1. AI crawlers blocked in robots.txt

**Why it matters**: blocking these user agents removes you from ChatGPT search, Perplexity citations, Claude browse, Gemini, and Google AI Overviews. Founders block them by accident (a CDN default, an "AI training opt-out" toggle) and lose downstream traffic without ever seeing it in GA.

**Audit**:
```bash
curl -s https://example.com/robots.txt | grep -iE 'GPTBot|PerplexityBot|ClaudeBot|Google-Extended|OAI-SearchBot|ChatGPT-User|CCBot|Bytespider|Applebot-Extended|Amazonbot|FacebookBot'
```

**The matrix to know**:

| Crawler | Powers | Block effect |
|---|---|---|
| `Googlebot` | Google Search + AI Overviews (rendering) | Fatal — drops you from Google entirely |
| `Google-Extended` | Gemini + AI Overviews **training** | You stay in Search but lose AI Overview eligibility over time |
| `Bingbot` | Bing + Copilot + ChatGPT (via Bing) | Loses ChatGPT search citations, Copilot |
| `GPTBot` | ChatGPT browse + training | Loses ChatGPT browse + future ChatGPT search |
| `OAI-SearchBot` | ChatGPT search results (separate from GPTBot) | Loses ChatGPT search ranking specifically |
| `ChatGPT-User` | ChatGPT user-initiated fetches | Loses on-demand ChatGPT fetches |
| `PerplexityBot` | Perplexity citations | Loses Perplexity entirely |
| `ClaudeBot` | Claude browse | Loses Claude browse |
| `CCBot` | Common Crawl (training data for many open models) | Loses presence in many open-source LLMs |
| `Applebot-Extended` | Apple Intelligence | Loses Apple Intelligence |
| `Bytespider` | TikTok / Doubao | Loses Doubao + TikTok AI features |
| `Amazonbot` | Alexa / Rufus | Loses Alexa, Rufus shopping |
| `FacebookBot` | Meta AI | Loses Meta AI |

**Important nuance**: blocking `Google-Extended` does **not** block `Googlebot`. Search rankings are unaffected, but AI Overview eligibility quietly degrades. Most sites should leave `Google-Extended` allowed unless they have a specific data-licensing reason to opt out.

**Fix — allow everything by default**:
```
User-agent: *
Allow: /
Disallow: /admin/

Sitemap: https://example.com/sitemap.xml
```

**Fix — opt out of AI training but stay in AI search** (rare, mostly publishers with licensing deals):
```
User-agent: Google-Extended
Disallow: /

User-agent: GPTBot
Disallow: /

User-agent: CCBot
Disallow: /

# Leave OAI-SearchBot, PerplexityBot, ClaudeBot, ChatGPT-User allowed —
# they are search-time fetchers, not training.

User-agent: *
Allow: /
```

**Verify**: curl with each AI user-agent returns 200 on key URLs.
```bash
for ua in "GPTBot/1.0" "PerplexityBot/1.0" "ClaudeBot/1.0" "OAI-SearchBot/1.0" "Googlebot/2.1"; do
  code=$(curl -A "$ua" -s -o /dev/null -w "%{http_code}" https://example.com/)
  echo "$ua → $code"
done
```
All should be 200. If any return 403/404 from a CDN (Cloudflare, AWS WAF, Vercel firewall), check the bot-management ruleset — these often block non-Googlebot AI crawlers by default.

---

## 2. llms.txt missing or weak

**What**: `https://example.com/llms.txt` is a Markdown file at the site root that summarizes the site for LLMs. Spec: https://llmstxt.org/. It's an emerging standard, modeled after `robots.txt` and `sitemap.xml`. Helps Claude, Perplexity, ChatGPT, and other agents pick the right pages to fetch and cite.

**Template** (`/llms.txt`):
```markdown
# Acme

> One-sentence positioning. What you do, who for, what makes you different.

A short paragraph (60 to 120 words) describing the product, the audience, the
data you publish, and the unique angle. Use real numbers, real categories, real
names. Not marketing fluff. LLMs will quote this verbatim when asked "what is
Acme?".

## Docs

- [Quickstart](https://example.com/docs/quickstart): Get started in 5 minutes.
- [API reference](https://example.com/docs/api): All endpoints + auth.

## Data

- [Channel index](https://example.com/channels): 84 distribution channels with cost, effort, ramp time.
- [App profiles](https://example.com/apps): 60 fast-growing apps with peak revenue.

## Policies

- [Terms](https://example.com/terms)
- [Privacy](https://example.com/privacy)
- [Attribution policy](https://example.com/attribution)
```

**Optional** `/llms-full.txt` — same structure but with the **full Markdown body** of every linked page concatenated, so an LLM can ingest the whole site in one fetch. Worth doing for docs sites and reference sites.

**Serve with the right content type**:
```
Content-Type: text/markdown; charset=utf-8
```
or `text/plain` is acceptable.

**Next.js**: place `llms.txt` in `public/`. Add a route handler if you want to generate dynamically:
```ts
// app/llms.txt/route.ts
export async function GET() {
  const md = await buildLlmsTxt()
  return new Response(md, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
```

**Verify**: `curl -i https://example.com/llms.txt` returns 200 + Markdown body + correct content type.

---

## 3. Content not citable

**Why AI engines don't cite you**: claims are vague, no source attribution, no quantitative data, no expert byline, no datestamp. AI synthesizers prefer pages where they can grab a clear, attributable, dated, authored claim.

**Fix patterns**:

| Symptom | Fix |
|---|---|
| Claim buried in paragraph 5 | Front-load: "X is Y because Z" in the first 100 words. |
| Vague quantifier ("most users", "many founders") | Quantify: "62% of users (n=1,184 surveyed Jan 2026)". |
| No primary source | Inline `<cite>`, `<a href>`, or footnote linking the dataset / paper / filing. |
| Anonymous content | Visible author byline + bio + credentials + Person schema (`technical.md` Issue 7). |
| No publish / update date | Visible "Published Jan 2026, updated Apr 2026" + `datePublished` / `dateModified` in Article schema. |
| Buried key claims | Use `<blockquote>` or pull-quotes for the most extractable lines. |

**Example transformation**:

```html
<!-- Before: vague, undated, unauthored, no sources -->
<p>Many indie founders find that growth is hard. Most of them try a lot of channels.</p>

<!-- After: front-loaded, dated, authored, cited, quantified -->
<article>
  <header>
    <h1>62% of indie founders try 4+ channels before finding product-market fit</h1>
    <p class="byline">By <a rel="author" href="/authors/jane">Jane Doe</a>, ex-Google PM. Published <time datetime="2026-04-01">April 1, 2026</time>.</p>
  </header>
  <blockquote>
    Across 1,184 indie SaaS founders surveyed in January 2026, the median founder
    tested 4 distinct distribution channels (X, SEO, Reddit, Product Hunt) before
    one drove > 30% of MRR.
  </blockquote>
  <p>Source: <a href="https://example.com/data/founder-survey-2026">DistributionMarket Founder Survey, Q1 2026 (n=1,184)</a>.</p>
</article>
```

**Add author Person schema** (boosts E-E-A-T and AI trust signals):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "Jane Doe",
  "url": "https://example.com/authors/jane",
  "jobTitle": "Lead Researcher",
  "worksFor": {"@type": "Organization", "name": "Acme"},
  "sameAs": [
    "https://twitter.com/janedoe",
    "https://www.linkedin.com/in/janedoe"
  ]
}
</script>
```

**Verify**: paste the page into https://www.perplexity.ai/ and ask a question that should be answered by it. If Perplexity does NOT cite you, the page isn't citable yet. Iterate. ChatGPT and Claude.ai with web search are the other two checks.

---

## 4. JavaScript-only rendering

**Symptom**: `view-source` shows an empty `<div id="root">` or `<div id="__next">` with the real content only appearing after JS executes. **AI crawlers do not run JavaScript.** Many search crawlers do but slowly, with limited budget.

**Audit — what does a no-JS crawler see?**:
```bash
curl -s https://example.com | sed 's/<script[^>]*>.*<\/script>//g' | sed 's/<[^>]*>//g' | tr -s ' \n' ' ' | wc -w
```
Should be > 300 words of substantive copy. If under 50, the page is JS-only and AI crawlers see nothing.

**Fix**:

| Stack | Fix |
|---|---|
| Next.js (App Router) | Default is RSC = server-rendered. Convert `'use client'` components to server components where possible. |
| Next.js (Pages Router) | `getServerSideProps` or `getStaticProps`. Avoid pure client-side data fetching for above-the-fold content. |
| Astro / SvelteKit / Remix | SSR / SSG by default — opt into client islands only where needed (`client:visible`, `client:idle`). |
| Plain SPA (CRA, Vite-React, Vue SPA) | Switch to a framework with SSR (Remix, Next, Nuxt, SvelteKit). Or pre-render with `prerender.io`, `react-snap`, or `react-snapshot`. |
| Documentation site | Use Astro Starlight, Docusaurus (SSG), Mintlify, or VitePress — all SSR-by-default. |

**Minimum viable shell** (if you can't move off SPA right now): hand-write an SEO/AI shell in `index.html` so crawlers see the headline, the hero copy, the key claims, and links — even if the interactive app boots client-side.

```html
<noscript>
  <h1>Premium Blue Widgets, Built to Last</h1>
  <p>Acme makes wholesale-priced blue widgets shipped to 14 countries...</p>
  <p><a href="/products">View all products</a> · <a href="/about">About us</a></p>
</noscript>
```
But really: move to SSR.

**Verify**:
```bash
curl -s https://example.com | grep -i 'your-actual-headline'
```
Should return the actual hero text. If empty, the page is still JS-only.

Also test what AI crawlers get:
```bash
curl -A "PerplexityBot/1.0" -s https://example.com | sed 's/<[^>]*>//g' | wc -w
```
Should match the curl test above. If a CDN serves a different (worse) response to bots than to browsers, fix the cache config.
