---
title: Unicode Normalization Forms
description: "Canonical and compatibility equivalence, the four forms NFC, NFD, NFKC and NFKD, String.prototype.normalize, decomposed filenames, and grapheme clusters with Intl.Segmenter."
tags: [unicode, i18n, javascript]
sidebar:
  order: 1
---

The same visible text can be stored as different code points. `é` is either U+00E9 or `e` followed by U+0301 COMBINING ACUTE ACCENT, and `===` returns `false`. Normalization turns a string into one agreed form, so comparisons work. The search side of this (folding text and keeping an index map for highlighting) is in [search folding](/text/search-folding/).

```js
const composed = "é";     // é
const decomposed = "é";  // é
composed === decomposed;                       // false
composed.length, decomposed.length;            // 1, 2
composed === decomposed.normalize("NFC");      // true
```

## Two kinds of equivalence

UAX #15 defines two.

**Canonical equivalence** means the sequences are the same abstract character and should always look and behave the same. UAX #15's examples:

| Kind | Example |
| --- | --- |
| combining sequence | `Ç` ↔ `C` + U+0327 |
| order of combining marks | `q` + U+0307 + U+0323 ↔ `q` + U+0323 + U+0307 |
| Hangul and conjoining jamo | `가` ↔ U+1100 + U+1161 |
| singleton | U+2126 OHM SIGN ↔ U+03A9 `Ω` |

**Compatibility equivalence** is weaker: the same abstract character, but with a visual or formatting difference that matters in some contexts and not others.

```js
"ﬁ".normalize("NFKC");  // "fi"     ligature
"①".normalize("NFKC");  // "1"      circled digit
"Ａ".normalize("NFKC");  // "A"      fullwidth
"㍉".normalize("NFKC");  // "ミリ"   squared katakana
"ｶﾞ".normalize("NFKC"); // "ガ"     halfwidth katakana plus voiced mark
```

Anything canonically equivalent is also compatibility equivalent, but not the other way round.

## The four forms

| Form | Steps | Result |
| --- | --- | --- |
| NFD | canonical decomposition | decomposed, canonically equivalent |
| NFC | canonical decomposition, then canonical composition | composed, canonically equivalent |
| NFKD | compatibility decomposition | decomposed, compatibility equivalent |
| NFKC | compatibility decomposition, then canonical composition | composed, compatibility equivalent |

The K stands for compatibility (C was taken by composition).

`String.prototype.normalize(form)` takes `"NFC"` (the default), `"NFD"`, `"NFKC"` or `"NFKD"`, and throws a `RangeError` for anything else.

### NFC and NFD are lossless

The result is canonically equivalent to the input, so it renders the same. Three things that look like bugs and aren't:

- **NFC isn't "shortest".** Some characters are excluded from composition, so NFC decomposes them and leaves them decomposed. `"क़".normalize("NFC")` (Devanagari `क़`) is U+0915 U+093C, two code points. UAX #15 lists script-specific exclusions for some Indic scripts, Tibetan and Hebrew.
- **Combining marks can be reordered** into canonical order. The text looks the same.
- **Singletons never survive.** U+212B ANGSTROM SIGN becomes U+00C5 `Å` under NFC too.

UAX #15 also guarantees stability: a string normalized under one Unicode version stays normalized under every later version (for characters that existed in that version).

### NFKC and NFKD are lossy on purpose

UAX #15: "Normalization Forms KC and KD must not be blindly applied to arbitrary text." It compares them to case mapping: useful for matching, wrong for storing. `①巻` stored through NFKC becomes `1巻`, and nothing can bring the `①` back.

NFKC results that break naive code:

- It changes length both ways: `ｶﾞ` (2 code points) → `ガ` (1), `㍉` (1) → `ミリ` (2). An index into the NFKC string doesn't point into the original.
- `"゛".normalize("NFKC")` (U+309B, the spacing voiced mark) is `" ゙"`: a space followed by U+3099. So a space shows up in the middle of the text.

How I handle both in a search fold is in [search folding](/text/search-folding/).

## Normalizing isn't closed under concatenation

Two normalized strings joined together aren't necessarily normalized. UAX #15's examples:

```js
("a" + "̂").normalize("NFC");               // "â": each part was already NFC
("ᄀ" + "ᅡᆨ").normalize("NFC");    // "각"
```

This happens in NFD too, because marks on either side of the join get reordered. So normalize the string after you build it, not just the pieces.

## Where decomposed text comes from

- **Filenames from macOS.** HFS+ stored names in a decomposed form (a variant of NFD). APFS preserves whatever form it's given and compares names normalization-insensitively, so names created on HFS+, or by software that decomposes, stay decomposed. In practice I got a Korean title from a macOS folder name as `나` = U+1102 U+1161, while the `나` I typed was U+B098. The whole title was 25 UTF-16 units instead of 12.
- **Pasting from Finder**, which brings the decomposed name with it.
- Text from other sources is usually composed: typed input and OCR output were, in my case.

So text that came from a file system gets `normalize("NFC")` at the boundary where it becomes app data ([large files](/files/large-files/) is where `File` objects enter). Anything that compares strings from two sources compares them normalized.

`localeCompare` already treats canonically equivalent strings as equal: ECMA-262 requires it to return 0 for them. `===`, `includes`, `indexOf`, `Map` keys and `Set` membership don't.

## Grapheme clusters

A grapheme cluster is UAX #29's approximation of what a reader sees as one character. UAX #29 defines the default (extended) grapheme clusters, and `Intl.Segmenter` implements them:

```js
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

[...graphemes.segment("é")].length;             // 1
[...graphemes.segment("난")].length;  // 1 (난 as three jamo)
[...graphemes.segment("👨‍👩‍👧")].length;                // 1 (8 UTF-16 units)
[...graphemes.segment("🇯🇵")].length;                 // 1
```

Each segment has `segment` (the text), `index` (its UTF-16 offset in the input) and `input`.

Why this matters for normalization: a decomposed Hangul syllable or a letter plus combining marks is one cluster. So normalizing cluster by cluster composes it, while normalizing code point by code point can't compose anything that spans two code points. And each cluster keeps its `index` into the original string, which normalizing the whole string first would lose. A spacing mark like U+309B `゛` is its own cluster, while the combining U+3099 joins the cluster before it.

Segmenting is also the right way to count or truncate "characters": `.length` counts UTF-16 units and `[...str]` counts code points, and both of them split `👍🏽` or `e` + U+0301.

## Browser support

MDN lists `String.prototype.normalize()` in Chrome 34, Firefox 31 and Safari 10, and `Intl.Segmenter` in Chrome 87, Firefox 125 and Safari 14.1. Firefox is the late one for `Intl.Segmenter`.

## References

- [UAX #15: Unicode Normalization Forms](https://www.unicode.org/reports/tr15/)
- [UAX #29: Unicode Text Segmentation](https://www.unicode.org/reports/tr29/)
- [MDN: `String.prototype.normalize()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize)
- [MDN: `Intl.Segmenter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)
- [ECMA-262: `String.prototype.localeCompare`](https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.localecompare)
- [Apple: APFS FAQ](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html)
- [Apple TN1150: HFS Plus Volume Format](https://developer.apple.com/library/archive/technotes/tn/tn1150.html)
