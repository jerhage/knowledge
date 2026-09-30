---
title: Sanitizing Whole Documents with DOMPurify
description: Why whole XHTML documents need `IN_PLACE`, what `PARSER_MEDIA_TYPE` then does, and allowing `blob:` URLs.
tags: [security, html]
sidebar:
  order: 1
---

Dokseo, my manga and book reader, displays EPUB books, and an EPUB chapter is a whole XHTML document that came from someone else's file. Before a chapter is shown, I run it through DOMPurify, a library that removes anything that could run script, like script elements and inline event handlers. DOMPurify is built to sanitize a fragment of HTML. If you hand it a whole document, especially an XHTML one like an EPUB chapter, it goes wrong in ways the documentation doesn't warn you about. I checked everything here against `dompurify` 3.4.x in Chromium. The second layer under the sanitizer, the page's CSP, is in [CSP for blob documents and workers](/security/csp-blobs-and-workers/).

## Sanitize a whole document `IN_PLACE`, never as a string

The obvious call is `sanitize(string)` with the chapter's markup. That doesn't work, and neither does the next thing you'd try. None of it behaves the way the documentation leads you to expect.

**`sanitize(string)` always wraps what you give it.** `_initDocument` prepends `<html xmlns="..."><head></head><body>` and appends `</body></html>` whenever `PARSER_MEDIA_TYPE` is XHTML. A whole XHTML document is already a document. So this nests `<html>` inside `<html>`, the result fails to parse as XML, and `sanitize` returns Chromium's parser-error page. Someone opens a chapter and its text is just gone, with no throw and no warning.

**Passing `documentElement` as a node without `IN_PLACE` is no better.** The `nodeName === 'HTML'` branch misses, because an XML document's root node name is lower-case `html`. So the real document gets appended inside DOMPurify's own wrapper.

**So parse it myself and sanitize in place:**

```ts
const doc = new DOMParser().parseFromString(markup, mediaType);
DOMPurify.sanitize(doc.documentElement, { IN_PLACE: true, ...policy });
return new XMLSerializer().serializeToString(doc);
```

`IN_PLACE` skips `_initDocument` entirely. Then you don't need `WHOLE_DOCUMENT` either. Apart from adding `html`, `head` and `body` to the allow-list (they're already in the default one), it only changes DOMPurify's own parsing and serialization: which element `_initDocument` returns, and `body.outerHTML` (plus the doctype) over `body.innerHTML` at the end. `IN_PLACE` skips the first and returns before the second. The `<head>` survives because I serialize the document myself.

## Under `IN_PLACE`, `PARSER_MEDIA_TYPE` only controls case folding

`PARSER_MEDIA_TYPE` sets whether DOMPurify treats the markup as HTML or XHTML, and for an EPUB chapter it's tempting to set it to XHTML. Once `IN_PLACE` takes over the parsing, the option does exactly one thing:

```ts
transformCaseFunc = PARSER_MEDIA_TYPE === 'application/xhtml+xml'
  ? stringToString
  : stringToLowerCase;
```

Its only other uses are the wrap above and a namespace branch that can't be reached unless `ALLOWED_NAMESPACES` is widened.

The allow-lists and each node name both go through that function, so lower-case folding matches them against each other correctly. Turning the folding off (by passing the XHTML media type) breaks two things and gets you nothing:

1. **Camel-cased SVG dies.** DOMPurify lower-cases the built-in allow-lists when it builds them (the source spells `feGaussianBlur` in camel case, but the set holds `fegaussianblur`), so `linearGradient`, `clipPath` and `feGaussianBlur` get removed, and `viewBox` and `preserveAspectRatio` get dropped.
2. **An HTML root throws** `root node is forbidden and cannot be sanitized in-place`, because an HTML document's root node name is `HTML` and `ALLOWED_TAGS['HTML']` is undefined. Whatever promise wraps the sanitize call then rejects, and the document never renders.

It gets you nothing because a working XHTML event handler still has to be spelled `onerror`, and that's caught under either rule.

## `blob:` URLs are stripped by default

DOMPurify checks every URL attribute against a pattern of allowed schemes and empties the attribute if the URL doesn't match. The default `IS_ALLOWED_URI` pattern admits `http(s)`, `ftp(s)`, `mailto`, `tel`, `callto`, `sms`, `cid`, `xmpp`, `matrix`, anything not starting with a letter, and any string without a scheme. `blob:` is none of those.

This matters whenever a library has already rewritten a document's resources to object URLs before I sanitize it. foliate-js does exactly that before it fires its `data` event (see [foliate chapters](/ebooks/foliate-chapters/)). At the defaults, every `src`, `href`, `poster` and `xlink:href` gets emptied. The element survives with its attribute gone. So a test that checks the element still exists passes, while every picture, stylesheet and font is lost without an error. **Assert the URL, not the element.**

The fix is the default pattern with one alternative added, passed as `ALLOWED_URI_REGEXP`. The default, as DOMPurify ships it in `src/regexp.ts`:

```ts
/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
```

With `blob` added:

```ts
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;
```

I write the dash unescaped and last in each character class, `[a-z+.-]` rather than `[a-z+.\-]` (and `[^a-z+.:-]`, since `.-:` in the middle would be a range), because oxlint's `no-useless-escape` rejects the escaped form that the library itself ships (DOMPurify silences the rule with a comment).

Two other options sound like they widen what's allowed, but they narrow it:

- **`USE_PROFILES` replaces the allowed sets** instead of extending them. `{ html: true, svg: true }` also drops MathML and every SVG filter element, because the default is `html ∪ svg ∪ svgFilters ∪ mathMl ∪ text`.
- **`ADD_TAGS` is needed for `link` and `meta`.** Neither is in the default allow-list. Losing `link` costs a document its own stylesheet. Losing `meta` costs its `charset`. A document served from a `text/html` blob with no charset parameter then gets decoded as windows-1252, and Japanese shows up as `æ—¥æœ¬èªž`.

## References

- [DOMPurify README](https://github.com/cure53/DOMPurify#readme)
- [DOMPurify `src/regexp.ts`](https://github.com/cure53/DOMPurify/blob/main/src/regexp.ts)
