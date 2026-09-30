---
title: "foliate-js: Chapter Styles and Writing Modes"
description: Getting theme colors into chapter iframes, how chapter writing mode sets swipe direction, and measuring a chapter before it shows.
tags: [foliate-js, iframes, color-scheme, i18n, playwright]
sidebar:
  order: 2
---

My reader shows EPUB books with foliate-js, a library that lays a book out in pages. foliate-js renders each chapter in its own iframe. What does and doesn't cross that boundary in general is on [same-origin iframes](/html/iframes/).

## Theme colors into a foliate chapter iframe

The reader has themes, and each theme defines its colors as CSS custom properties (tokens) on the host page. A chapter's text, links and highlights should use those colors too. But custom properties don't cross into a chapter iframe, so the host has to resolve them to actual colors itself and pass those in. I use probe elements (hidden elements that exist only to be measured) that carry the text, link and highlight color tokens. Their computed `color` already resolves [`light-dark()`](/css/color-scheme/). The probes must have no `transition`, or `getComputedStyle` returns values from the middle of the transition. A plain `<a>` often transitions `color`. (Resolving a token to a color in general is on [tokens where `var()` cannot reach](/css/tokens-at-runtime/).)

A pure function turns the readings into an ink object (the set of colors a chapter needs), and a style builder writes that into the chapter CSS. Give the frame the host's *used* `color-scheme`, or Chromium paints an opaque canvas behind the text.

The colors change when someone switches theme or when the system switches between light and dark, so re-apply on a `MutationObserver` watching the theme and scheme attributes on the root, and on a `prefers-color-scheme` listener. If the ink hasn't changed, skip it. Otherwise call `setStyles` once, and foliate [re-anchors](/ebooks/foliate-positions/) so the reader keeps their place.

To probe chapters in Playwright: the view's shadow roots are closed, so reach a chapter through `page.frames()` filtered to `blob:` URLs.

## foliate pages and swipes each chapter by its own writing mode, a click by the book's direction

Japanese books are often set vertically, with lines running top to bottom, so which way a page turns depends on the book. On a phone, someone turns pages by swiping, and on a desktop by clicking or pressing keys. foliate-js keeps track of two directions, and swipes and clicks don't use the same one.

- `book.dir` is the spine's `page-progression-direction`. `View.goLeft`/`goRight` flip on it, so clicks and keys follow the book.
- The paginator's `#vertical` and `#rtl` come from `getDirection(doc)`, which runs on *every* chapter load. `vertical` means the body's computed `writing-mode` is `vertical-rl`/`vertical-lr`. `rtl` comes from the body's `dir`, its computed `direction` or the root's `dir`.

The second pair sets the paging axis, the column order and the scroll sign. So it also sets which way a touch swipe (`#onTouchMove` → `scrollBy`, `#onTouchEnd` → `snap`) turns: up for a vertical chapter, and sideways by `rtl` for a horizontal one. That means a book whose chapters differ (vertical text with unmarked horizontal image chapters) swipes up on one page and left on the next.

What controls it is the chapter's computed writing mode, and host styles get there in time. foliate's `afterLoad` creates the two `<style>` elements that `setStyles` fills, and `#goTo`'s `onLoad` calls `setStyles` for each new chapter. Both happen *before* `getDirection` reads the computed style. So for a vertical book, setting `html, body { writing-mode: … !important }` through `setStyles` puts every chapter on one axis.

What does *not* work:

- `dir="rtl"` on a horizontal chapter's root flips `#rtl`, but it also flips the text's direction. If you force the body back to `ltr`, foliate ends up measuring left-to-right columns with its right-to-left formula, and the page count comes out wrong.
- Taking touches away from foliate with a capture-phase listener and turning pages through `goLeft`/`goRight` makes the page go back and forth on a phone, and leaves foliate's `#locked` turn lock stuck.

Leave swipes to foliate. A horizontal book keeps foliate's per-chapter swipe, turned by each chapter's own `rtl`. My reader shows a first-use touch guide that tells people which way to swipe, so the guide should measure that `rtl` instead of reading the spine.

## A chapter's computed style can be measured before foliate shows it

To force one writing mode for a vertical book, and to tell the touch guide which way to swipe, the reader has to know a chapter's writing mode and direction before foliate shows anything. The way to get them is to load the chapter yourself, through foliate's own loader. `book.sections[i].load()` goes through foliate's loader. The loader rewrites the chapter's links to blob URLs (style sheets, images) and fires the `data` transform that a sanitizer can hook into (see [sanitizing whole documents with DOMPurify](/security/dompurify/)). `unload()` gives the reference back. The loader counts references per href, so a load and an unload before foliate opens that chapter leave nothing behind, and foliate's own load later starts fresh.

Render the returned URL in a sandboxed (`allow-same-origin`, no scripts) iframe that's visually hidden but still laid out (1 px, so every engine computes the style). That gives you `getComputedStyle(body).writingMode`, the same value foliate would read. `section.createDocument()` only parses, with no style sheets. That's enough to check whether a chapter has text, but not how it's laid out. foliate doesn't parse `<meta name="primary-writing-mode">`, but it keeps the raw package document as `book.resources.opf`.

The same frame gives you the chapter's `rtl` exactly the way foliate's `getDirection` reads it: `body.dir`, the computed `direction` of the body, and `documentElement.dir`. Combine the three, and the swipe direction you get is the one foliate will turn by.

## A probe can open foliate's closed shadow roots

A probe is a throwaway Playwright script that opens the real page and reads or screenshots something, like the highlights foliate paints over a chapter. Those are hard to reach. `<foliate-view>` and `<foliate-paginator>` attach `mode: 'closed'` shadow roots. In a Playwright probe (never in app code or a committed test), an init script that wraps `Element.prototype.attachShadow` and forces `mode: 'open'` makes both reachable:

```text
foliate-view → shadowRoot → foliate-paginator → shadowRoot → the overlayer's svg
```

A highlight is a `g` with `fill` and the group opacity. An outline is a `g` with `stroke` and `stroke-width` set, holding one `rect` per line. Other probe techniques are on [browser probes](/testing/browser-probes/).
