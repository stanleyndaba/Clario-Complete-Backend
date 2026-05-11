---
name: distro-seo
description: End-of-audit SEO + Core Web Vitals fixer. Use this skill whenever the user hands you failing audit issues from Lighthouse, PageSpeed Insights, Google Search Console, an SEO crawler, or the DistributionMarket SEO scan and asks you to fix, solve, remediate, or improve them. Triggers include "fix these SEO issues", "solve audit findings", "improve page speed", "fix Core Web Vitals", "remediate Lighthouse failures", "boost AI search visibility", "GEO optimization", "fix LCP / INP / CLS", "fix render-blocking resources", "missing meta tags", "broken sitemap", "robots.txt is blocking AI crawlers", "improve SEO score". Use even when the user just pastes a list of issues without explicit framing — that pattern alone is the trigger.
license: MIT
metadata:
  author: distributionmarket
  version: "1.1.0"
  homepage: https://thedistributionmarket.com
---

# Distro SEO

You did the audit. This skill turns the issue list into committed code fixes. Framework-aware (Next.js, Astro, SvelteKit, Remix, Vite, plain HTML), surgical, no aspirational refactors.

## How to use this skill

The user arrives with one or more failing audit findings. They might paste a Lighthouse report, name issues directly ("LCP > 4 s, render-blocking JS, missing canonical"), or hand you a screenshot from a third-party tool. Treat each named issue as a separate fix. Do not bundle, do not refactor surrounding code.

For each issue:

1. **Classify it** into one of the four domains and load the matching reference. Do not load all four — load only what you need (these references are the bulk of the skill content; loading them all wastes context).
2. **Diagnose** with the snippet given in the reference, on the actual page. Confirm the failure mode before changing anything.
3. **Apply the fix** for the user's framework. Edit files directly. The references give framework-specific recipes (Next.js, Astro, SvelteKit, Remix, plain HTML).
4. **Verify** with the post-fix check listed in the reference.
5. **Move on** to the next issue.

End with a one-line summary: "Fixed N of M. Skipped K (reasons listed)."

## Domain routing

| If the issue mentions... | Load |
|---|---|
| LCP, INP, CLS, FCP, TTFB, Lighthouse Performance score, render-blocking, unused JS / CSS, image weight, AVIF / WebP, cache policy, third-party code, long tasks, font loading, large payload | `references/cwv.md` |
| Title tag, meta description, H1, alt text, internal links, content-to-code ratio, thin content, Open Graph, Twitter Card, heading hierarchy | `references/on-page.md` |
| robots.txt, sitemap.xml, canonical, HTTPS, mixed content, redirect chains, mobile viewport, tap targets, hreflang, structured data, JSON-LD, rich results | `references/technical.md` |
| AI crawlers (GPTBot, PerplexityBot, ClaudeBot, Google-Extended, etc.), llms.txt, AI search visibility, citability, JavaScript-only rendering, GEO | `references/geo.md` |

When an issue could plausibly fit two domains (e.g., "blocked AI crawlers" is in both `technical.md` robots.txt and `geo.md` AI access), prefer `geo.md` — it's tuned for the AI-search angle and links back to technical when needed.

## Targets (the bar)

| Metric | Good | Needs work | Poor | Notes |
|---|---|---|---|---|
| LCP | <= 2.5 s | 2.5 to 4 s | > 4 s | mobile p75 |
| INP | <= 200 ms | 200 to 500 ms | > 500 ms | mobile p75 |
| CLS | <= 0.1 | 0.1 to 0.25 | > 0.25 | mobile p75 |
| FCP | <= 1.8 s | 1.8 to 3 s | > 3 s | mobile p75 |
| TTFB | <= 800 ms | 800 to 1800 ms | > 1800 ms | server response |
| Lighthouse Performance | >= 90 | 50 to 89 | < 50 | mobile, lab |
| Lighthouse SEO | 100 | 90 to 99 | < 90 | full marks expected |
| Content-to-code ratio | >= 10% | 5 to 10% | < 5% | text bytes / total HTML |

Google ranks on **CrUX field data** at the **p75** of real users. Lighthouse lab scores diverge from field. After a deploy, verify with PageSpeed Insights field data, not just lab runs (CrUX rolls up over 28 days).

## Output format per issue

For every issue you address, respond in this exact block so the user can scan and copy-paste into a PR description:

```
## Issue: [name]
**Diagnosed cause**: [one-line root cause]
**Files changed**: [list]
**Fix applied**:
[brief summary or diff]
**Verification**: [how to confirm — the command, the check, the URL]
**Expected impact**: [metric, ballpark — e.g. "LCP down 1.2 to 1.8 s"]
```

End with: `Fixed N of M issues. Skipped K: [issue → reason].`

## When to stop and ask

Some fixes need human judgment. Surface the question and stop on that issue rather than guess:
- Rewriting thin content (we can suggest structure but not invent claims).
- Opting out of AI training (`Google-Extended`, `GPTBot` block) — business decision, not technical.
- Picking a primary host (www vs apex) when both serve different content.
- Choosing canonicals when faceted nav has SEO value (color filters, etc.).

## Verification loop (do once at the end)

After fixing the batch:

1. Re-run PageSpeed Insights on the same URL: `https://pagespeed.web.dev/analysis?url=<URL>`
2. Lab data updates immediately. **Field data takes up to 28 days** — that's normal.
3. Re-fetch with AI user agents (curl with `-A "GPTBot/1.0"`) to confirm not blocked.
4. Re-test rich results: `https://search.google.com/test/rich-results`
5. Submit a re-crawl in GSC: URL Inspection → Request Indexing.
6. Add a Lighthouse CI step to prevent regression (recipe in `references/cwv.md`).

## Anti-patterns (never)

- Refactor the entire site to fix one image. Surgical only.
- Keyword-stuff titles, headings, or alt text.
- Add structured data that doesn't match the page content. Google flags it as spam.
- `noindex` thin content as a "fix". Either improve it or 410 it.
- Block AI crawlers in robots.txt out of vague training-data fear. You lose citations and traffic.
- Inline > 14 KB of CSS. It hurts LCP more than it helps.
- `loading="lazy"` on the LCP image. Pushes LCP later.
- `font-display: block`. Causes invisible text and wrecks LCP.
- Run Lighthouse once and call it shipped. CrUX is what Google actually uses.

## References

The four references below are the issue catalogue. Each is a self-contained set of fix recipes (diagnostic → code → framework adapter → verification). Load only what the active issue needs.

- `references/cwv.md` — Core Web Vitals + page speed. 15 issues across LCP, INP, CLS, FCP, TTFB, render-blocking, unused JS / CSS, image sizing, next-gen formats, cache policy, third-party code, payload, long tasks, font loading.
- `references/on-page.md` — On-page SEO. 8 issues across titles, meta descriptions, H1 hierarchy, alt text, internal links, content-to-code ratio, thin content, Open Graph + Twitter Card.
- `references/technical.md` — Technical SEO. 7 issues across robots.txt, XML sitemap, canonical tags, HTTPS / redirects / mixed content, mobile, hreflang, structured data.
- `references/geo.md` — Generative Engine Optimization (AI search). 4 issues across AI crawler access, llms.txt, citability, JavaScript-only rendering. This is what makes you cite-able by ChatGPT, Perplexity, Claude, Gemini, and Google AI Overviews.
