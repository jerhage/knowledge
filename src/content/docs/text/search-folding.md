---
title: Folding Text for Search Without Losing Offsets
description: Folding by grapheme cluster with an offset map, kana and voiced-mark gotchas, and NFC for storage vs NFKC for matching.
tags: [unicode, i18n, javascript]
sidebar:
  order: 2
---

A search fold turns text into something you can compare: lowercase, width, NFKC compatibility forms, katakana to hiragana. The hard part is highlighting the match afterwards, because folding changes lengths. Background on the normalization forms is in [Unicode normalization forms](/text/unicode-normalization/).

## Whole-string NFKC cannot keep an index map

`NFKC` changes length in both directions: `ｶﾞ` (two code points) becomes `ガ` (one), `㌔` (one) becomes `キロ` (two). So a match index in the folded string doesn't point at the same position in the original, and a highlight drawn from it lands in the wrong place.

Instead, walk the original piece by piece, fold each piece, and push an origin index (where in the original it came from) for each UTF-16 *unit* of output. Per unit, not per code point: `indexOf` returns a UTF-16 index, and astral kanji (code points above U+FFFF) take two units.

My first version walked by code point. That isn't enough. The piece has to be a grapheme cluster (UAX #29's approximation of what a reader sees as one character), for the reason in the next section.

## Fold by grapheme cluster, because a filename is decomposed

My reader's library search folds the query and each book's title, then looks for one inside the other. A search for `나` found nothing in titles, even with `나 혼자만 레벨업 1권` right there on screen, while the same query found the same text elsewhere.

macOS filenames are often *decomposed*. HFS+ stored every name in a decomposed form. APFS keeps whatever form a name was created in, so a name that was written decomposed stays decomposed. A title that comes from a filename or a folder name has `나` as `U+1102 U+1161` (two code points), while the `나` you type is the single `U+B098`. Text from other sources (OCR output, typed input) is composed.

A search fold that walks code points and calls `normalize('NFKC')` on each one can *never* compose a sequence that spans two characters. I measured it: the same title is 12 UTF-16 units composed and 25 decomposed, and only the composed one matched.

The fix is to walk grapheme clusters instead:

```ts
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
```

Under UAX #29, a decomposed Hangul syllable is one cluster, so normalizing the cluster composes it. This also keeps the offset map for highlighting. A cluster has one offset into the *original* string, and each UTF-16 unit the cluster folds to gets that origin index, so a highlighter still slices the original text. Normalizing the whole string first would be simpler, but it would break that, because the offsets would then point into the normalized copy.

Japanese folding isn't affected. The standalone voiced marks `゛` and `゜` are their own clusters, so a fold that joins them to the kana before them still works.

The general rule: any text someone *types* is composed, and any text that came from a filesystem may not be. Compare them folded, and fold by cluster.

## Per-piece NFKC breaks the voiced kana, so recompose by hand

`'ｶﾞ'.normalize('NFKC')` is `ガ`, but folded one code point at a time it's `カ` followed by U+3099, which isn't the same string. Walking by grapheme cluster already handles this pair. The halfwidth `ﾞ` (U+FF9E) is `Grapheme_Extend`, so `ｶﾞ` is one cluster, and NFKC composes it. The standalone `゛`/`゜` aren't. They're their own clusters, and once they're mapped to U+3099/U+309A (next section), they still have to be joined by hand. After emitting each folded part, compose a combining U+3099/U+309A onto the previous character with `NFC` and keep the base character's origin. Fall through when the composition doesn't collapse to one character (`あ` + U+3099 has no precomposed form).

## The spacing voiced marks decompose to a space

`'゛'.normalize('NFKC')` is `" ゙"`: U+0020 then U+3099. If you leave it, that space ends up in the middle of the folded text and breaks every comparison around it. Map U+309B and U+309C to the combining forms before normalizing.

## The kana shift must stop at U+30F6

Katakana folds onto hiragana by subtracting 0x60, but only over U+30A1 to U+30F6. Just past the end, `ヷ` to `ヺ` (U+30F7 to U+30FA) would map to U+3097 to U+309A: two unassigned code points and the two combining voiced marks. `・` (U+30FB) would become U+309B, the spacing voiced mark, and `ー` (U+30FC), the prolonged sound mark, would become U+309C, the spacing semi-voiced mark. `ヽ` and `ヾ` are different: they shift onto their real counterparts `ゝ` and `ゞ`, but they sit after `ー`, so a single range can't take them without it. Everything inside the range, small kana and `ヵ`/`ヶ` included, has a hiragana counterpart.

## NFC at the boundary, NFKC only for matching

Compose with `normalize('NFC')` at the boundary where a `File` becomes domain data, so a title gets stored in canonical form whatever form the filesystem returned. That does *not* replace the cluster folding above:

- a *query* can arrive decomposed too. Paste a name out of Finder and you're searching for a decomposed string in a composed title, the same bug the other way round;
- data stored before the boundary existed is already decomposed;
- folding runs anyway, for lowercase, width, katakana to hiragana and the standalone voiced marks. Clusters change *how* it walks the text, not whether it runs.

So the fold makes search correct, and the boundary keeps storage clean.

**NFC is safe for every language, with one CJK exception.** It's canonical composition. It's idempotent (running it again changes nothing) and canonically equivalent to its input, so the rendered text doesn't change. There's no reason to branch on language, and you can't know a filename's language anyway. Two things look like faults and aren't. Several Indic and Hebrew sequences stay multi-code-point under NFC, because NFC means canonical, not shortest. And combining marks may get reordered into canonical order, which looks identical.

The exception is the CJK compatibility ideographs (460 of the 472 assigned characters in U+F900 to U+FAFF, and all of U+2F800 to U+2FA1D; the twelve others in the first block are ordinary unified ideographs). Each one has a singleton canonical decomposition (it decomposes to exactly one other code point). So every normalization form, NFC included, replaces it with its unified ideograph: `'侮'.normalize('NFC')` is U+4FAE. A font that drew the two differently can't anymore, and the original code point is gone. Text that has to keep that distinction uses the standardized variation sequences, which normalization leaves alone. For book titles that's rare enough that I accept it, but NFC isn't strictly lossless.

**NFKC is a different thing and must not reach storage.** It's *compatibility* composition, and it's lossy on purpose:

```text
ﬁ → fi        ① → 1        Ａ → A        ㍉ → ミリ
```

That's right for matching and wrong for keeping. A search fold uses NFKC on purpose. Using it at the storage boundary too would silently store `①巻` as `1巻`. Pin this down with a test that a title keeps `①`, `ﬁ` and `Ａ` exactly.

Sorting the folded results has its own gotchas: `Intl.Collator` isn't a total order. See [JavaScript gotchas](/javascript/gotchas/).
