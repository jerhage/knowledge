---
title: Captures, Tags and Search
description: What a capture is in Dokseo, its card and editor, optimistic removal and Undo over the query cache, cards not stored yet, tag colors, capture links, and the ⌘K search over one book or all uploads.
tags: [dokseo, ocr, svelte, svelte-5, tanstack-query, keyboard, unicode, indexeddb]
sidebar:
  order: 63
---

Every time I drag over a bubble and Dokseo, my manga and book reader, recognizes the text, it keeps the result as a capture. A capture holds the recognized text, the regions of the page it came from, a note, tags and a creation time. Captures are stored in IndexedDB and shown as cards in the captures panel beside the page, where I can edit the text, add a note, tag them, remove them and search them. The general patterns are in [Saving and Undo](/ui-patterns/saving-and-undo/), [Folding Text for Search](/text/search-folding/) and [keyboard shortcuts](/interaction/keyboard/). How the text is made is on [the pipeline page](/projects/dokseo/recognition/pipeline/).

## Why captures live in recognition

Dokseo's code is split into domains, and some of them are leaves: a leaf domain imports no other domain. Captures could have been their own leaf. But `CapturePanel`, the component that shows them, is recognition UI, and it couldn't have imported a `captures` leaf. Captures are what recognition produces, so they live in the `recognition` domain. The import graph forced that (see [the domains](/projects/dokseo/architecture/domains/)).

## The card

Each capture shows as a card, `recognition/ui/capture/CaptureCard.svelte`, and the card renders the reading as `<p class="m-0 text-lg" lang={language}>{card.text}</p>`, plain selectable text. When I edit a card, that paragraph is replaced by an editor with a `textarea`, and the paragraph comes back when I save or cancel the edit. The edit and remove actions sit in a menu in a row of their own below the text, so they don't sit on top of the reading.

The `Card` a card draws is built by `cardOf` in `capture-card-projection.ts`, a pure module. It's a ts-pattern `match` over a `PanelCapture`, with one handler per status (`pending`, `done`, `empty` and `failed`), and each returns a `Card`. One of a `Card`'s fields, `tone`, is typed `CaptureStatus`, a union of string literals. At first each handler had to write `'pending' as CaptureStatus`. Without the cast, the code didn't compile, because ts-pattern infers each handler's result on its own, and a string in an object literal widens to `string`, which isn't a `CaptureStatus`. The fix was to name the output type, `match<PanelCapture, Card>(capture)`. Every handler is then checked against `Card`, the literals stay literals, and a missing field fails in the handler that's missing it ([why](/typescript/type-checking-techniques/#ts-pattern-infers-a-matchs-output-from-its-handlers-so-a-string-literal-widens)). `card-tools.ts` and `CaptureCard.svelte` write `match<Input, Output>` the same way.

## Editing a card

The editor that swaps in for the paragraph was first `CardEditor.svelte`. It took the text to edit as an `initial` prop and seeded its own draft from it with `let draft = $state(initial)`. svelte-check flagged that line with `state_referenced_locally`: the draft captures the prop's value at mount and never reads the prop again.

In this case the component was correct anyway. A fresh editor mounted for every edit, so mount was exactly when the draft should be taken. But the warning can't detect that, and this project doesn't allow `svelte-ignore` comments to silence it.

The fix moved the draft out of the component ([a prop read into state warns](/svelte/state-and-props/#a-prop-read-into-state-warns-move-the-state-out-of-the-component)). Today the editor is `InlineEditor.svelte`, and it owns no draft at all. The drafts live in `CardDrafts`, which `CaptureView` holds: one draft per field (text or note) and capture. The card passes the editor the draft as `value` and gets each change back through `oninput`, so the editor owns nothing but its form and `textarea`.

## Saving, removing and Undo

IndexedDB can fail a write, so the card editor has to check whether a save happened. At first, the text and note editors closed before the write. When the write failed, I lost what I had typed. When the write was skipped, the card still showed the new text as if it had been saved.

Now `CaptureEdits.edit` and `annotate` return `'saved' | 'failed'`. The new text reaches the card only after the write succeeds, and `CardDrafts.save` keeps the editor open on `'failed'`. It also keeps it open when I typed more while the save ran, so a save never closes over text it didn't write ([keep an editor open](/ui-patterns/saving-and-undo/#keep-an-editor-open-until-the-storage-outcome-is-known)).

The cards come from the query cache: each book's captures are one query, keyed by the book, and `CaptureCache` wraps the few cache edits that the view models writing captures make. Removing a card offers Undo, and that's `CaptureRemoval`, a view model over two mutations, one that removes and one that restores. The removal is optimistic, so the card leaves the panel before the write finishes:

- Before the write, `onMutate` cancels any read of that book's captures still in flight, so a read that started before the removal can't land afterwards and bring the row back. Then it drops the row from the book's cached list.
- If the removal comes back `storage-unavailable` (a blocked store), or the write throws, `CaptureRemoval` puts back only that row with `cache.put`. It doesn't restore a snapshot of the whole list taken before the removal, because another write may have changed a different row in the meantime, and the old snapshot would undo that change.
- Whatever the outcome, `onSettled` refreshes the book's captures and the list of every capture, so the cache ends at what storage holds.
- Undo runs the restore mutation. `restoreCapture` calls the repository's `save`, which is a `put`, so the id, note, tags and creation time come back unchanged. The row goes back into the cache only after that write succeeds. If it fails, the card stays out and Dokseo shows an error.

The row goes into the cache entry of the capture's own book. If I've moved to another book and press Undo late, there's nothing to check: storage is restored, the row lands in the old book's entry, and the card shows up when that book opens again. The general pattern is [a removal snapshot is the hook for Undo](/ui-patterns/saving-and-undo/#a-removal-snapshot-is-the-hook-for-undo).

### Cards that aren't stored yet

The panel also shows cards that storage doesn't hold yet: a recognition still running, a capture whose save failed, a note I've started writing before it's saved. Those aren't query data, so they don't go in the cache. They live in `UnsavedCards`, a small view model, and the pure function `listedCards` lays them after the stored rows (oldest first), leaving out any whose row has already landed.

When a capture is saved, it goes into the cache with `setQueryData` and leaves `UnsavedCards`, and both happen in the same tick. That works because a query notifies its observers synchronously: in query-core 5.104 with svelte-query 6.3, `setQueryData` updates every `readQuery` on that key before the next line runs. If there were a frame where the card was in neither list, the keyed `{#each}` that draws the panel would rebuild its row, and an open editor in that card would lose focus.

Because the cards come from that join and not from the read alone, the panel's read state, `CaptureRead`, is `loading`, `failed` with a message, or `ready` with no value.

## Scrolling a new capture into view

When a new capture arrives, its card should scroll into view once, as soon as it shows in an open panel. The card's `<li>` has an attachment (Svelte's `{@attach}`, a function that runs on the element) that does the scroll. But the panel's list is a keyed `{#each}` over a `$derived` list, and every time that list is rebuilt, the attachment runs again. So "scroll when the element appears" can't rely on the attachment running once.

Instead the attachment calls the panel view model's `reveals(id, visible)` to check whether to scroll, which passes the latest capture's id on to `CaptureCards.reveals(id, latest, visible)`. That method steps a `CaptureReveal` from `capture-reveal.ts`: `none`, `pending` with an id, or `done` with an id. The state is kept in a plain field, not `$state`, so checking it writes nothing reactive from inside an effect. A new capture sets it to `pending`. The method returns true only for that id while the panel is visible, and then records `done`. A capture made while the panel is closed stays `pending` until it opens ([a one-shot attachment](/svelte/attachments-and-listeners/#a-one-shot-attachment-keeps-its-mark-in-the-view-model)).

The panel sits in the `Dock`, which can be closed. The attachment reads the `visible` prop, so opening the dock re-runs it, with no `$effect` and no callback. It runs in a plain effect, in the same phase as `$effect` and after the render effects of the same update, so the `Dock` panel's `hidden` attribute is already updated by the time it measures or scrolls ([an attachment that reads a prop](/svelte/attachments-and-listeners/#an-attachment-that-reads-a-prop-runs-again-when-the-prop-changes)).

## Tags

A capture can have tags, and each tag has a color from a small palette in `tag-colour.ts`. `nextColour` picks a color based on the colors the existing tags have. Keeping `tag-colour.ts` from importing `tag.ts` took a small type trick, described on [dependency rules](/projects/dokseo/architecture/dependency-rules/). One palette color was renamed (`ember` became `copper`), and tags already stored with the old name needed no migration, only a fallback when they're loaded: see [storage](/projects/dokseo/library/storage/).

The tag screens show a filterable list of tags. On a wide screen it sits in the `layout-app-shell-nav` column (`layout-app-shell-wide-only`). On a narrow one, a header button (`layout-app-shell-narrow-only`) opens it in a top `Modal`. Both come from one snippet. The snippet takes where it renders as an argument so the two filter inputs get different ids, both inputs bind the same `view.filter`, and each link closes the sheet on click. The screen also has a window-level key handler, and it ignores events from inside a `dialog`. Otherwise arrow keys typed into the sheet's filter would also move through the page underneath ([one list, two homes](/ui-patterns/reader-layout/#one-list-two-homes-the-nav-column-and-a-phone-sheet)).

## Capture links

A capture can be linked. The link goes to the read route, and its url names the capture's region, so opening it goes to that page with the region marked. The url format, the rounding and the match by distance are on [Reading Place, Links and Arrivals](/projects/dokseo/library/reading-place/). The glow that marks a search arrival on the page is drawn with `toPageFraction` (see [the pipeline page](/projects/dokseo/recognition/pipeline/#2-regionsin-one-screen-rect-into-a-region-per-page)).

## Search: ⌘K for this book, ⌘⇧K for all uploads

The search dialog has two scopes: `This book`, the book that's open, and `All uploads`, every book I've uploaded. ⌘K opens it on `This book` and ⌘⇧K on `All uploads`.

Searching all uploads needs every capture and every tag, and most of the time nobody opens the dialog. So `CaptureFindData`, the data component that owns those two reads, starts with both queries disabled. A disabled query reads nothing, and invalidating it doesn't refetch it either, so a capture saved while the dialog is closed costs no read. Each time the dialog opens, it calls the component's `reload()`: the first call enables the queries, which fetches them, and later calls refetch them, so the results are current whenever the dialog shows. What the dialog holds while it's open (the query, the scope, the selected row and the rows themselves) is UI state, and it lives in `SearchPalette`, a view model ([data components and view models](/projects/dokseo/architecture/data-components-and-view-models/)).

The first handler checked `event.key === 'k' && event.metaKey`. I assumed that with shift held the browser would report `'K'` and the check wouldn't match. That shipped a bug. As far as I could tell, on macOS ⌘⇧K arrived as lowercase `'k'`, matched the unshifted check, and opened the dialog on `This book`. I measured the handler against both reports: a chord reported as `'K'` opened nothing at all, and the same chord reported as `'k'` opened on the wrong scope. Browsers differ on the letter's case while a command modifier is held, so the case doesn't show whether shift is down.

The check, now `searchKey` in `search-keys.ts`, matches the letter case-insensitively and reads shift from its own flag:

```ts
function isShortcut(press: SearchKeyPress): boolean {
  return press.key.toLowerCase() === 'k' && (press.metaKey || press.ctrlKey);
}

// in searchKey:
if (isShortcut(press)) {
  const scope: SearchScope = !context.hasBook || press.shiftKey ? 'all' : 'book';
  // …
}
```

With no book open, both chords search everything. The general rule is on [keyboard](/interaction/keyboard/#eventkey-does-not-show-that-shift-is-held-and-a-shortcut-that-reads-shift-from-it-will-misfire).

## Folding library titles

The search also matches book titles in the library. I searched for `나` and got the capture that held it, but not the book titled `나 혼자만 레벨업 1권`, which was right there on screen.

A book's title comes from its filename or folder name, and on macOS a filename can be stored decomposed: `나` as two code points, `U+1102 U+1161`. The `나` I type is the single composed `U+B098`, and OCR output is composed too. The search compares folded text, and `foldForSearch` walked the title one code point at a time and normalized each one. Normalizing one code point at a time can never combine two code points into one. I measured the same title at 12 UTF-16 units composed and 25 decomposed, and only the composed one matched.

`foldForSearch` now walks grapheme clusters with `Intl.Segmenter`, and a decomposed Hangul syllable is one cluster, so normalizing the cluster composes it. It also keeps the highlighting working. The fold records `origins`, an offset into the original string for each folded unit. A cluster has one offset in the original, so `segmentsOf` can still slice the highlight out of the text I searched. The details, including why HFS+ and APFS differ here, are in [fold by grapheme cluster](/text/search-folding/#fold-by-grapheme-cluster-because-a-filename-is-decomposed).

## The search dialog's small gotchas

The search dialog is a `<dialog>` with a search input, and it keeps its query between opens. What caught me about it:

- **Escape.** With text in the search field, the first Escape only clears the field, and the dialog's cancel doesn't fire. A browser probe that typed a query and pressed Escape once left the dialog open. Everything behind a modal dialog is inert, so the probe's next click timed out with an error that didn't mention the dialog. A probe has to press Escape until `dialog[open]` is gone ([Escape in a search input](/html/forms-and-labels/#escape-in-a-search-input-clears-it-before-it-closes-the-dialog)).
- **The caret.** In Playwright WebKit, refocusing the field on a reopen put the caret at the start of the old query, so typing `ga` after `Man` gave `gaMan`. Chromium put it at the end. A probe that types after a reopen has to set the selection first, or it searches for something other than the intended text ([the caret](/html/forms-and-labels/#webkit-puts-the-caret-at-the-start-of-a-refocused-field)).
- **Focus on close.** Closing a dialog returns focus to whatever had it when the dialog opened. WebKit doesn't focus a button when it's clicked or tapped, so after opening the dialog from a button and closing it, focus landed on `<body>`, and a keyboard or VoiceOver user was back at the top of the page. The dialog now records its opener when it opens (the focused element, or failing that the last `button` or `a` received by a window `pointerdown` capture listener). On the `close` event, if `document.activeElement` is still `<body>`, it focuses the opener. Other modals in the app still have the WebKit behavior. The browser fact is on [browser support](/projects/dokseo/engineering/browser-support/) and [dialog focus](/html/dialog-focus/#webkits-dialog-focus-restore-lands-on-body-after-a-tap).
