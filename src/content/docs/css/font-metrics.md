---
title: "Font Metrics: Centering Caps, Keeping Descenders and Subsetting"
description: "Centering capitals with `ascent-override`/`descent-override`, clipping one axis so descenders survive, and fetching a Latin subset."
tags: [css, fonts, typography]
sidebar:
  order: 10
---

How I self-host and declare my fonts is on [directory structure](/design-systems/directory-structure/#fonts). Behind that setup are font metric overrides that center text, a clip on one axis that keeps descenders, and a Latin subset fetched from Google Fonts.

## Centering text in pills and buttons: font metric overrides, not padding

Text in a badge, tag or button usually gets `line-height: 1`. The browser then centers the face's ascent + descent box, not its capitals. Ascent is how far the font's box reaches above the baseline, and descent is how far it reaches below. If a face's ascent is tall compared to its cap height, the capitals sit below the pill's center. If the ascent is short, they sit above it.

These are the faces I measured (hhea ascent / descent, cap height, and how far the caps sit below center, all in em):

| Face | Asc / desc | Cap | Drop |
| --- | --- | --- | --- |
| Zen Kaku Gothic New, Zen Maru Gothic | 1.160 / 0.288 | 0.700 | +0.086 (low) |
| Literata | 1.177 / 0.308 | 0.701 | +0.084 (low) |
| Newsreader | 0.735 / 0.265 | 0.676 | −0.103 (high) |
| Courier Prime | 0.781 / 0.342 | 0.580 | −0.070 (high) |
| system-ui | 0.967 / 0.211 | 0.705 | +0.026 |
| most Latin UI faces | | | −0.03 … +0.03 |

In pixels, that came out 0.7 to 1.9 px low in both Chromium and WebKit. You can see that in a row of badges.

**The fix goes in the `@font-face` rules.** Every face sets `ascent-override` and `descent-override` so the cap height sits in the exact middle of the line box, while `A + D` stays the same. Because the total doesn't change, nothing that uses `line-height: normal` changes height. The formula is on [directory structure](/design-systems/directory-structure/#fonts). Here are the computed values for the faces I measured:

| Face | ascent-override | descent-override |
| --- | --- | --- |
| Zen Kaku Gothic New, Zen Maru Gothic | 107.4% | 37.4% |
| Literata | 109.3% | 39.2% |
| M PLUS Rounded 1c | 106.25% | 33.25% |
| M PLUS 1 Code | 98.25% | 25.25% |
| Newsreader | 83.8% | 16.2% |
| Courier Prime | 85.15% | 27.15% |
| Share Tech Mono | 91.35% | 21.35% |
| Archivo | 88.7% | 20.1% |
| Bricolage Grotesque | 93% | 27% |
| Figtree | 95% | 25% |
| Outfit | 98% | 28% |
| DM Sans, DM Mono | 100.1% | 30.1% |
| IBM Plex Mono | 99.9% | 30.1% |
| Geist, Geist Mono | 100.5% | 29.5% |
| JetBrains Mono | 102.5% | 29.5% |

To add a face, read the head, hhea and OS/2 tables from the woff2 and compute the two percentages. A small brotli + WOFF2 table reader does this without any dependency. Both Chromium and WebKit apply the overrides: a 50% / 50% test face measures exactly 100 px tall at 100 px in both. You can't override `system-ui`.

**Result:** with the overrides in place, every pill is within ±0.5 px of center in Chromium and ±0.64 px in WebKit. That's the same leftover error `system-ui` has. What remains comes from ascent and descent getting rounded to whole pixels, plus the baseline snapping to a pixel, and no font-level fix gets below it. Pill and button heights don't change.

**Side effect:** a line that mixes the body face with an inline mono face (`code`, `kbd`) used to be taller than its line height. The two faces had mismatched ascent boxes, and they pushed the line box apart. With balanced faces, the line drops back to its nominal height (1 to 4 px shorter), and code / kbd chips grow 1 px. (For why a `kbd` changes height between inline and flex, see [layout quirks](/css/layout-quirks/#a-kbd-as-a-flex-item-is-taller-than-an-inline-kbd).)

**What doesn't work:**

- `text-box: trim-both cap alphabetic` does nothing on `inline-flex` components, because text-box-trim applies to block containers and inline boxes. It only works if the label is in its own block span, and that changes each component's markup and its height per face.
- Extra padding per theme only fixes the symptom for one face.

**Measuring a face's offset.** Screenshot the element with its text, then again with `-webkit-text-fill-color: transparent`, at 4× device scale. The rows that differ are the ink. Swap the label for "HHHH" to get the cap center.

## A line-height-1 box with `overflow: hidden` cuts off descenders

A one-line label that truncates with an ellipsis, like a badge or a title in a list row, usually gets `overflow: hidden` so that `text-overflow: ellipsis` has something to cut. But `overflow: hidden` clips *both* axes at the padding box, even if you only wanted the inline overflow for an ellipsis. A one-line element is one line box tall. At `line-height: 1` the line box is shorter than the font's content area: the half-leading (the extra space split above and below the text) is negative, so the descenders hang below the box and get clipped. With ascent/descent overrides that center the content area on the cap height ([above](#centering-text-in-pills-and-buttons-font-metric-overrides-not-padding)), the ascent side survives, and the descent side is what gets cut (`p`, `g`, `y`, `q`, `j`). A heading at a tight line height (1.15) can clip a pixel or two if the face's descenders run past its descent.

The fix is to clip only one axis: `overflow: clip visible` (clip on x, visible on y). The shorthand is physical, and in horizontal text x and y are inline and block. `text-overflow: ellipsis` works with `clip`. Two things differ from `hidden`, and both matter:

- `clip` doesn't make a scroll container. So a flex or grid item loses the automatic minimum size of 0 that `hidden` gave it, and stops shrinking below its text. Set `min-inline-size: 0` and `min-block-size: 0` along with it.
- You can't pair `overflow: hidden` with `overflow-y: visible` (it computes to `auto`). Only `clip` can pair with `visible`.

My [`.truncate` utility](/design-systems/naming-conventions/#utility-pattern) bundles exactly this.

`overflow-clip-margin` (which grows the clip box) isn't in WebKit, so it can't be the fix.

To measure a clip like this, render the element twice, once as is and once with `overflow: visible`. Count the pixels that differ outside the element's box, leaving out the last em or so where the ellipsis replaces text.

## Fetching a font's Latin subset from Google Fonts

I self-host my fonts, and for most faces I only need the Latin subset. Google Fonts serves each family through a CSS API that points at one woff2 file per subset, so the job is to find the Latin file's URL. Fetch the CSS API with a current Chrome user agent:

```sh
curl -A 'Mozilla/5.0 … Chrome/130 …' \
  'https://fonts.googleapis.com/css2?family=Outfit:wght@400..600&family=DM+Mono:wght@400;500&display=swap'
```

You get back one `@font-face` per unicode-range subset. Each has a comment naming it (`/* latin */`, `/* latin-ext */`, and for a Japanese face, around a hundred numbered slices). Without a modern user agent, the API returns TTF. The `src` url in the `/* latin */` block is the woff2 to download from fonts.gstatic.com.

- A weight range (`wght@400..600`) on a variable family comes back as one file declared `font-weight: 400 600`. A static family gives one file per weight you listed.
- The license is at `https://raw.githubusercontent.com/google/fonts/main/ofl/<family>/OFL.txt`. Some of them come with CRLF line endings, which `tr -d '\r'` strips.

The files are small because the subset is small. A CJK face's Latin subset is under 10 KB per weight, while the whole face is megabytes.
