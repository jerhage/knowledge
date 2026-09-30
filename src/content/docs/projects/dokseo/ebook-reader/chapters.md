---
title: "The Ebook Reader: Chapters, Styles and Keys"
description: "How `FlowViewer` loads foliate chapters through DOMPurify under the page's CSP, paints them in the theme, keeps them on one writing mode, relays keys out of the frame, and separates a move from a re-layout."
tags: [dokseo, foliate-js, iframes, security, theming, keyboard, i18n, svelte-5]
sidebar:
  order: 50
---

In Dokseo, my manga and book reader, the ebook reader opens EPUB books, where the text reflows into pages to fit the screen. The component is `FlowViewer`, a Svelte wrapper around the foliate-js 1.0.1 renderer (`<foliate-view>`). foliate loads each chapter as its own document in a same-origin `blob:` iframe (`sandbox="allow-same-origin allow-scripts"`), and lays it out in columns, showing one screen of them at a time. Because every chapter lives in an iframe, the main question is what does and doesn't cross from the chapter to Dokseo around it. The general side is in [foliate chapter styles and writing modes](/ebooks/foliate-chapters/), [foliate positions](/ebooks/foliate-positions/), [same-origin iframes](/html/iframes/) and [sanitizing whole documents with DOMPurify](/security/dompurify/).

## Loading a chapter through DOMPurify

An EPUB chapter is an XHTML document from a file I didn't write, so Dokseo sanitizes it before foliate shows it. foliate offers a hook for that: when it loads a chapter, it first rewrites the chapter's links to images, stylesheets and fonts into object URLs, and then fires a `data` event with the markup. Dokseo sanitizes the chapter in that event, with `dompurify` 3.4.15, pinned. Everything below was checked against that version in `node_modules` and in Chromium.

DOMPurify is built for fragments of HTML, not whole documents, so Dokseo parses the chapter itself, sanitizes the parsed document in place, and serializes it back:

```ts
const chapter = new DOMParser().parseFromString(markup, mediaType);
DOMPurify.sanitize(chapter.documentElement, { IN_PLACE: true, ...policy });
return new XMLSerializer().serializeToString(chapter);
```

Why it's done that way is on [the DOMPurify page](/security/dompurify/). What each piece protects in Dokseo:

- **Not `sanitize(string)`.** Given an XHTML chapter as a string, DOMPurify wraps it in its own `<html>`, so the chapter's `<html>` ends up inside another one. That's not valid XML, so the parse failed and `sanitize` returned Chromium's parser-error page instead. You'd open the book and see no text at all, with no error thrown and no warning.
- **Case folding stays on.** With folding off (`PARSER_MEDIA_TYPE: 'application/xhtml+xml'` under `IN_PLACE`), an HTML chapter's root element throws `root node is forbidden and cannot be sanitized in-place`. In Dokseo that rejects `createURL`'s promise, and the chapter never renders.
- **`blob:` URLs are allowed.** DOMPurify's default URL pattern doesn't match `blob:`, and by the time `data` fires, foliate has turned every `src` and `href` into a blob URL. At the defaults, DOMPurify emptied all of those attributes but kept the elements. So every picture, stylesheet and font disappeared, while a test that only checked the elements were still there passed. Dokseo's pattern is the default with one alternative added. The dash in it is written unescaped (`[a-z+.-]`), because `oxlint`'s `no-useless-escape` rejects the escaped form the library ships.
- **`ADD_TAGS` for `link` and `meta`.** Neither is allowed by default. Without `link` a book loses its own stylesheet. Without `meta` it loses its `charset`, and a chapter served from a `text/html` blob with no charset is decoded as windows-1252, so Japanese arrives as `æ—¥æœ¬èªž`.

The sanitizer is one layer. The other is the page's CSP, which is in [Dokseo's security policy](/projects/dokseo/engineering/security-policy/).

## Painting a chapter in the theme

Dokseo has themes, and a chapter should use the theme's text and link colors. The theme lives in custom properties like `--color-text` on Dokseo's page, and custom properties don't cross into the chapter's iframe. So Dokseo computes the actual colors on its own side and writes them into the chapter's CSS.

`PageInkProbe` renders probe elements colored with `--color-text`, `--color-text-link` and `--color-primary-soft`, and reads their computed `color`, which is a plain color the chapter can use. A pure `pageInk` turns those readings into a `PageInk`, and `flowStyles(settings, ink)` builds the chapter CSS from it. `pageScheme` gives the frame the host's used `color-scheme` too, because otherwise Chromium paints an opaque background behind the chapter's text. When the theme changes, `paint` on `FlowAppearance` (`flowing/ui/flow-appearance.svelte.ts`, the view model that holds the ebook's look) skips an ink that's the same as before and otherwise restyles the chapter, which is one call to foliate's `setStyles`. The details (no `transition` on the probes, what to observe) are in [theme colors into a foliate chapter iframe](/ebooks/foliate-chapters/#theme-colors-into-a-foliate-chapter-iframe).

## Settings are just `setStyles`

Dokseo also has text settings, and they go into the chapter CSS the same way: `flowStyles` includes them, and one `setStyles` call applies the result. Changing a setting re-paginates the chapter, so my worry was that it would move you to a different place in the book.

It doesn't, and Dokseo doesn't have to do anything about it. foliate stores your place as the last visible `Range` in the chapter, and after any re-layout it scrolls back to that range by itself. `setStyles` also keeps the styles for every chapter loaded after this one. So Dokseo saves and restores nothing around a settings change: no re-open, and no round trip through a CFI (the EPUB position string). A CFI round trip would actually make it worse, because a CFI is coarser than the range foliate already holds. The `relocate` event that follows includes the new CFI, and the debounced position save stores it.

The settings themselves are stored in IndexedDB and read through the app's query cache (svelte-query). Opening a book needs them before foliate draws the first chapter, and the open can't wait on a reactive read. So the read route wraps `FlowViewer` in a data component, `ReadingSettingsData`, which mounts the viewer only once the settings read has settled and passes it the settings. If the read fails, the viewer gets the default settings, so the book still opens. `FlowView.open` takes the settings as an argument and reads nothing. The cost shows on the first ebook I open with no settings in the cache: the page stays blank for the length of one IndexedDB read, without the opening curtain, because the viewer that draws the curtain isn't mounted yet. How the data component works is on [data components and view models](/projects/dokseo/architecture/data-components-and-view-models/#the-kinds-of-data-component). Saving the settings is a mutation that also writes the new settings into the cache before the save runs. The open itself stays outside the cache, because foliate needs its host element before the open can finish. The general side is on [svelte-query v6](/svelte/svelte-query/). The trace through foliate's code is in [foliate re-anchors to the last visible range](/ebooks/foliate-positions/#foliate-re-anchors-to-the-last-visible-range-so-a-re-flow-keeps-the-place).

## One writing mode for the whole book

Japanese books are often set vertically, with lines running top to bottom. foliate computes the direction for each chapter separately, from that chapter's computed writing mode, and it swipes each chapter by that. That broke on a book with vertical text and some horizontal image chapters that didn't declare a direction: on a phone you swiped up on one page and left on the next.

For a vertical book, `flowStyles` now sets `html, body { writing-mode: … !important }`. foliate applies the styles before it reads a chapter's direction, so every chapter comes out vertical. See [foliate pages and swipes each chapter by its own writing mode](/ebooks/foliate-chapters/#foliate-pages-and-swipes-each-chapter-by-its-own-writing-mode-a-click-by-the-books-direction).

That requires Dokseo to detect a book's direction before foliate renders anything. `writing-mode-probe.ts` loads a chapter through foliate's own loader into a hidden, sandboxed frame and reads the computed `writingMode`, and also reads `<meta name="primary-writing-mode">` from the book's package file (`book.resources.opf`). The same frame gives `chapterDirection`, which combines `body.dir`, the body's computed `direction` and `documentElement.dir` the same way foliate does. The touch guide uses it to name the swipe foliate will really turn by, instead of using the book's declared direction. The technique is [a chapter's computed style can be measured before foliate shows it](/ebooks/foliate-chapters/#a-chapters-computed-style-can-be-measured-before-foliate-shows-it).

## Keys out of the frame

Dokseo has keyboard shortcuts, like ⌘K for search, and they listen on the host window with `<svelte:window onkeydown>`. But after you click into the text, focus is inside the chapter's iframe, and a key event there stays in the iframe's own document. It never reaches the host. So in an ebook, ⌘K did nothing.

The fix has two parts. Dokseo binds `keydown` on every chapter document as foliate loads it, and `key-relay.ts` dispatches a copy of each key event on the host. How the copy behaves (what its `target` is, how the host's `preventDefault()` gets back to the original, and a `WeakSet` to identify copies) is in [a keydown in a chapter frame never leaves it](/html/iframes/#a-keydown-in-a-chapter-frame-never-leaves-it-and-a-re-dispatched-copy-lands-on-the-hosts-own-target).

The copy also includes `isComposing` and `keyCode`. When you type Japanese through an input method, Safari sends the Enter that confirms a conversion with `isComposing` false and `keyCode` 229. Without `keyCode` on the copy, the host would handle that as a real Enter. The shared rule for those keys is on [browser support](/projects/dokseo/engineering/browser-support/).

Some keys should be left alone, for example when the key landed on a control in the chapter. `FlowViewer` detects that with a few small checks on the event's target: `controlType`, `isEditable`, and `controlRole`, which reads the element's `role`. They're pure functions in `flowing/ui/flow-keys.ts`, and `keyTarget` there combines them with the tag name into the description the turn logic reads. The target comes from the chapter's iframe, a separate JavaScript realm, so `instanceof HTMLElement` fails on it. `controlRole` reads `role` with `in` plus `typeof` instead, which works across realms. It reads the `role` attribute, not the element's implicit role, so a check for buttons has to read the tag name as well. See [`role` is a reflected IDL property](/html/iframes/#role-is-a-reflected-idl-property-so-role-in-target-reads-it-across-a-realm).

Because the checks only use `in` and `typeof`, `flow-keys.spec.ts` runs them in bare Node with no DOM at all. A fixture is a plain `EventTarget` with the fields copied on, which type-checks without a cast:

```ts
Object.assign(new EventTarget(), { tagName: 'INPUT', type: 'range' });
```

## Clicks in frame coordinates

Dokseo needs the screen position of a click inside a chapter. That's harder than it sounds, because of how foliate lays out a chapter. It makes the chapter's iframe as wide as the whole chapter, all columns side by side, and scrolls one screen's worth into view. So inside a chapter, `innerWidth` is the whole chapter's width, and `event.clientX` counts from the chapter's left edge, not the screen's. I measured an `innerWidth` of 8471 px in a 414 px viewport, and 3571 px at 1280 px.

The bridge back to the screen is the iframe element. Its `getBoundingClientRect().left` is where the chapter's left edge is on the screen, so:

```text
hostX = event.clientX + frameElement.getBoundingClientRect().left
```

The rect has to be read when the event arrives, since it moves with every page turn. Checked against real clicks at 10 %, 50 % and 90 % of the stage, that gave `26 + 15`, `192 + 15`, `358 + 15` on the first page, and `796 - 755`, `962 - 755`, `1128 - 755` two pages in, where the rect's left has gone negative. Why nothing foliate offers does this instead is in [a chapter frame's `innerWidth` is the whole columnized section](/html/iframes/#a-chapter-frames-innerwidth-is-the-whole-columnized-section-and-frameelementgetboundingclientrect-is-the-only-bridge-back-to-the-screen).

When I measured it, a vertical book hid the problem, because its columns run down the page, so the frame is tall and `innerWidth` is close to the screen width. Test with a horizontal book. The Vitest browser project caught me too: the test page is itself an iframe of about 414 × 896. A stage sized bigger than that puts `userEvent.click(host, { position })` outside the page, and the click lands on nothing, silently. So the test sizes the stage from `window.innerWidth`.

## Dropdowns over a chapter

Dokseo's `Dropdown` menus should close when you click outside them. But an outside-click rule on the host `document` (a `pointerdown` listener, or a popover's light dismiss) never receives a click in a chapter, because that click goes to the chapter's own document. You'd open a dropdown, click in the text, and the menu stayed open over the page.

What the host does receive is a focus change: the click moves focus into the iframe, and the host `window` fires `blur`. `window` only fires `blur` when the whole document loses focus, never when focus moves between elements in the page, so it's a safe second signal. `Dropdown.svelte` and `Popover.svelte` now also close on `window` `blur` while they're open. See [a click inside an iframe never reaches the host document](/html/iframes/#a-click-inside-an-iframe-never-reaches-the-host-document-the-window-blurs-instead).

## Moves and re-layouts

foliate reports position changes with a `relocate` event, and Dokseo uses it to save your place. But foliate also fires `relocate` when you didn't move: when fonts finish loading, when the chapter is resized, and after every `setStyles`. Those have the reason `anchor`, and because the CFI is taken from the visible range, a re-layout of the same page can report a different CFI. So Dokseo never treats "a different CFI" as "you moved".

The reason is only on the renderer's event. `View`'s own `relocate` event drops it. So Dokseo listens on `view.renderer`, which only exists after `view.open()`, and takes the place from `view.lastLocation`, which the view has already updated by the time Dokseo's listener runs. The full list of reasons is in [foliate relocates without the reader moving](/ebooks/foliate-positions/#foliate-relocates-without-the-reader-moving-and-reports-the-reason-only-on-the-renderer).

Going to a place (a link in the book, a saved CFI) is `navigate` in `flow-surface.ts`. foliate reports "not found" as `null` (for a link the book doesn't have) or an index of `-1` (for a CFI past the end), but `view.goTo` still returns the target. The first version only checked for `undefined`, so it either threw on `resolved.index` or counted a move that never happened as an arrival. Now `navigate` returns a `Navigation` union, `arrived | unresolved | no-body | refused`, and treats `null`, `undefined` and an index outside `[0, sections)` as `unresolved`. See [foliate's not-found values are null and -1](/ebooks/foliate-positions/#foliates-not-found-results-are-null-and--1-not-undefined).

## Svelte bugs in `FlowViewer`

**The open is keyed on `book.id`.** `FlowViewer` opens the book when its stage element mounts (in an effect when I hit this, in an attachment on the element now), and the open read the `book` prop. The ebook settings let you change a book's language. The `book` prop comes from `BookData`, the data component that holds the book's record from the query cache, and a successful save refreshes the library's queries, so `BookData` passes `FlowViewer` a new object with the same id. An attachment, like an effect, re-runs when an object it read is replaced, so saving would have closed and reopened the ebook and shut the settings dialog. Now the attachment tracks `book.id` and takes the object with `untrack(() => book)`, so it re-runs only for a different book or a new stage element. See [an effect keyed on an id](/svelte/effects/#an-effect-keyed-on-an-id-not-on-the-object-that-holds-it).

**The Text button that opened nothing.** The Text button in the reader bars opens `FlowSettingsDialog`. The dialog got a new required `language` prop, and `FlowViewer` never passed it. At runtime `language` was `undefined`, and it reached `match(language)...exhaustive()` inside a `$derived`. ts-pattern threw while Svelte was evaluating that derived for an `{#if}`, and a throw during render leaves the whole component blank. So the Text button opened nothing, in every book, and the only trace was one `pageerror` in the console. A `<svelte:boundary>` above it would have caught the throw, but there wasn't one at the time. Now the root layout has one. It would log the same throw and show a "Something went wrong" message with a Try again button, though in place of the whole screen, not only `FlowViewer`. The boundary is on [use cases and failure](/projects/dokseo/architecture/use-cases-and-failure/#boundaries-and-logging). svelte-check did flag the missing prop (`FlowViewer.svelte 413:8 "Property 'language' is missing in type ... but required in type 'Props'"`), so the bug got through because the check wasn't run to the end. See [a rune that throws takes the whole component with it](/svelte/rendering-gotchas/#a-rune-that-throws-takes-the-whole-component-with-it).

`FlowContentsDialog` and `FlowSettingsDialog` are native `<dialog>` + `showModal()`, which is why closing them never tripped the focus bug described on [reader chrome](/projects/dokseo/image-reader/reader-chrome/#which-dialogs-can-reach-it).
