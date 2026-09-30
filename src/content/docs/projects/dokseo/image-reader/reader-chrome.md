---
title: "Reader Chrome: Bars, Dock, Focus and the Scroll Lock"
description: "How `ReaderFrameView` and `ReaderFrame` show and hide the bars, return focus to the page, lift pinned elements over the dock, lock the document scroll, and separate a tap from a drag."
tags: [dokseo, focus, keyboard, mobile, layout, svelte, svelte-5]
sidebar:
  order: 42
---

The chrome is everything in the image reader that isn't the page: a top bar and a bottom bar, the page bar with its slider, a hint bar, and a dock (a side panel on a wide screen, a bottom sheet on a narrow one). A tap on the page hides the bars so the page gets the whole screen, and another tap brings them back. The state behind this is a view model, `ReaderFrameView` in `shared/reader-frame.svelte.ts`: it holds whether the bars were asked for, `barsShown` and `toggleBars`, the dock's placement and the frame's measurements. `ReaderFrame` (`shared/ReaderFrame.svelte`) lays the chrome out around the viewer from it. Both are shared because the ebook reader has the same chrome: `ReaderScreen`, the image reader's screen, and `FlowViewer`, the ebook reader's, each build their own `ReaderFrameView`.

`ReaderScreen` mounts one `ReaderFrame` and keeps it mounted for as long as the route shows image books. The viewer goes in the frame's `page` slot inside `ReaderBookData`, a data component that only swaps the stage: it shows the viewer once the book's pages are open, and `ReaderCurtain` in its place in every other state, such as opening, failed or empty. So when you switch from one image book to another, only the stage changes. The frame, the bars, the dock with the capture panel, the sheet height, the capture list's scroll and the focus all stay as they were. Data components are on [data components and view models](/projects/dokseo/architecture/data-components-and-view-models/).

Most of the problems the chrome hit are general, and written up in [inner scrollers](/scrolling/inner-scrollers/), [focus around modal dialogs](/html/dialog-focus/) and [Svelte rendering gotchas](/svelte/rendering-gotchas/).

## Showing and hiding the bars

When the bars hide, they become `inert`, so nothing in them can be clicked or focused. That causes problems around focus.

**A bar that's busy.** The bars shouldn't hide while you're using one of them, so there's a check, `chromeHolds` in `shared/reader-chrome.ts`, that tests whether a bar contains the focused element (or an open popover) with `bar.contains(node)`. The catch is timing. When a bar becomes `inert` while it holds focus, the browser drops the focus a moment later, not in the same tick. So right after hiding, the check still found the hidden bar "holding" focus, and showed it again. `chromeHolds` now skips any bar whose `inert` is already true before it checks focus. See [`inert` and `document.activeElement` are out of step for a moment](/html/dialog-focus/#inert-and-documentactiveelement-are-out-of-sync-for-a-moment).

**Where focus goes.** Say you click a bar button, then click the page. The bars hide, the button that had focus is now inert, and the browser drops focus to `<body>`. From there the arrow keys no longer turn pages. So `returnFocusToPage` in `shared/reading-surface.ts` blurs the control and focuses the reading surface, with `{ preventScroll: true, focusVisible: false }` so there's no scroll jump and no focus ring after a click. For that to work the surface has to be focusable. The paged frame has `tabindex="-1"`. The strip's scroller has no tabindex, because Chromium 132+ and Firefox already make a scroller focusable when it holds no focusable content (Safari doesn't). One gap remains: on touch, after a tap in the strip, focus still ends up on `<body>`. The details are in [returning focus to the page when chrome hides](/scrolling/inner-scrollers/#handing-focus-to-the-page-when-chrome-hides).

## A tap is not a finished drag

The page has two pointer gestures that end the same way, with the pointer going up. A tap toggles the chrome. A drag draws a box for a capture. `SelectionLayer`, the component that draws the box, used to classify them itself: in `pointerup`, a box smaller than `MIN_SELECTION_PX` on both axes, or one covering no page, called `tap()`, and anything else called `select()`.

The trouble is that a capture can fail for reasons that have nothing to do with size: the wrong `pointerTypes` allowed, a lost anchor, a page whose natural size is still zero. Each of those fell through to `tap()`. So you'd drag a box over a page, the capture would silently not happen, and the header would appear instead, as if you'd tapped.

Now the classification is `marqueeEnd` in `components/marquee-selection.ts`, which classifies the end as a click, too small, or a selection, and the drag itself is handled by the base `MarqueeSelection` and its `MarqueeDrag` view model (on [reading components](/projects/dokseo/design-system/reading-components/#marqueeselection)). Only a `selection` end reaches the region mapping in `SelectionLayer`, and only a click taps, through `onclick`. A mouse drag that ends too small or catches no page taps nothing.

A browser spec guards it, `viewer-drag.svelte.spec.ts`. It mounts both viewers, draws a page from an `ImageBitmap` so `naturalSizeOf` reads the size from the canvas attributes, sizes the mount container, and drags across the page, with `setPointerCapture` and friends mocked to no-ops because they throw on a synthetic pointer. Why this can only be a browser test is in [a finished drag must never be reported as a tap](/interaction/selection-marquee/#a-finished-drag-must-never-be-reported-as-a-tap-and-only-a-browser-test-can-check-it).

## Chrome focus without `state_unsafe_mutation`

To track whether a bar holds focus, the chrome listens for `focusout` and re-reads the focus into state (`held = look()`). That line started throwing Svelte's `state_unsafe_mutation`, which Svelte raises when state is written while it's in the middle of rendering.

The cause is a Chromium behavior. When Svelte removes a branch of the page (an `{#if}` turning false) and that branch holds focus, Chromium fires `focusout` synchronously, from inside the removal. So the listener ran while Svelte was still tearing down the block, and the write was rejected. Firefox and Safari don't fire `focusout` on removal. The mechanism is in [a DOM event can arrive inside Svelte's render work](/svelte/rendering-gotchas/#a-dom-event-can-arrive-inside-sveltes-render-work-and-a-state-write-there-is-rejected).

Three actions reached it, all through the same line:

- closing the model consent dialog;
- closing the capture palette;
- a client-side navigation, where SvelteKit's `reset_focus` moves focus.

The fix is to read focus a moment later instead of inside the event. Reading it during `focusout` is wrong anyway, because the browser hasn't moved focus to the new element yet. `ChromeFocus` in `shared/chrome-focus.svelte.ts` is a view model that takes a `Defer` function and folds every `refresh()` in one turn into a single read on the next microtask. A spec can drive it from Node with a queue it flushes by hand. In the browser the `Defer` is a small wrapper:

```ts
const NEXT_MICROTASK: Defer = (read) => queueMicrotask(read);
```

The first version passed `queueMicrotask` itself as the value. It passed every unit test and then threw `TypeError: Illegal invocation` in the browser. `queueMicrotask` is a `Window` method that checks what it's called on. A bare `queueMicrotask(read)` call is fine, but a stored function called with some other object as its receiver throws. Node doesn't check, so the unit tests couldn't detect it. See [`queueMicrotask` passed as a value loses its receiver](/javascript/gotchas/#queuemicrotask-passed-as-a-value-loses-its-receiver).

### Which dialogs can reach it

Not every dialog can trigger this. A native modal `<dialog>` returns focus to whatever opened it before it fires its `close` event, so by the time the `{#if}` around it turns false, nothing inside holds focus and no `focusout` fires ([the general page](/svelte/rendering-gotchas/#a-native-dialog-returns-focus-before-its-close-event)).

I checked it in Chromium. `flowing/ui/FlowContentsDialog.svelte` and `FlowSettingsDialog.svelte` are `<dialog>` + `showModal()`, and closing them with Escape, the Close button, the backdrop or by picking an entry was clean against the unfixed listener. The one that threw was `recognition/ui/capture/CapturePalette.svelte` (now `SearchDialog.svelte`), a plain `<div role="dialog">` behind `{#if shown}` that focused its own input.

The palette's reach was wider than its own component. The read route renders `<SearchDialog>` outside `BookData`, the data component whose `{#if flowing !== null}` branch holds `FlowViewer`. So in an ebook, pressing ⌘K and then Escape reached `FlowViewer`'s own focus listener. The ebook side is on [chapters](/projects/dokseo/ebook-reader/chapters/).

## The scroll lock

While a book is open, `ReaderScreen` needs `overflow: hidden` on `html`, so the document behind it can't scroll. Once you leave the book, that has to be gone again.

It first did that with `:global(html) { overflow: hidden }` in its `<style>`. Svelte scopes a component's selectors, but not the lifetime of its stylesheet: once the chunk has loaded, its CSS stays in the document. So you'd open a book, go back to the library, and the library (which uses `min-height: 100vh` and document scroll) couldn't scroll past the first screen. It never broke on the first visit, only after a book had been opened.

Now the lock is `lockScrolling` in `src/lib/platform/dom/scroll-lock.ts`. `ReaderScreen` calls it in `onMount` and returns the release function it gets back, and Svelte runs a function returned from `onMount` when the component unmounts. It puts back the previous inline value instead of a hard-coded one, and counts holders so a second lock can't record `hidden` as the value to restore. See [component CSS is global once the chunk loads](/svelte/rendering-gotchas/#component-css-is-global-once-the-chunk-loads-so-global-outlives-the-component).

## Measuring the frame

The chrome's layout depends on measurements: how wide the frame's body is, where the top bar is. `ReaderFrame` writes its measurements straight into the `ReaderFrameView` it's given:

```svelte
bind:clientWidth={frame.bodyWidth}
bind:ref={frame.topBar}
```

`bodyWidth` and `topBar` are `$state` class fields, and a `$state` field compiles to an accessor, so the binding assigns through it and everything reading the field updates. The reader then reads the derived values, `narrow` and `placement`, as getters on the same object. There's no bindable prop and no `$effect` copying values out. The pattern is [a child binds into a view model's state fields](/svelte/state-and-props/#a-child-binds-into-a-view-models-state-fields).

`narrow` sets the structure: a side dock on a wide screen, a bottom sheet on a narrow one. The switch point is the `--breakpoint-compact` token. A media or container query can't use it, because `var()` isn't allowed in a size condition. So `ReaderFrame` renders a `BreakpointProbe`, an invisible, zero-height element whose width is `var(--breakpoint-compact)`, and binds its measured width into the view model next to the body's width. `narrow` compares the two with a pure `isNarrow(width, breakpoint)` from `shared/panel-dock.ts`. Exactly at the breakpoint counts as wide, and so does the moment before the first measurement. The general version is [a breakpoint token measured by a probe](/css/tokens-at-runtime/#a-breakpoint-token-measured-by-a-probe).

## Lifting pinned elements over the dock

Some elements are pinned to the bottom of the screen with `.pin-bottom`: the viewers' hint bar, and `ReaderScreen`'s own footer. When the dock is up, the hint bar has to move up above it. `ReaderFrame` sets a custom property, `--pin-lift`, on the element that holds the viewer and its footer. A custom property does nothing until a rule reads it, and only `.pin-lift` reads this one. The hint bar has `.pin-lift` and the footer doesn't, so only the hint bar moves. Before this, `reader-screen.css` reached into both viewers' scoped styles to name what to lift. One detail: `.pin-lift` has to come after `.pin-bottom`, in the same layer and at the same specificity, so its offset wins. See [an inherited offset moves only the elements with a rule that reads it](/design-systems/in-practice/#an-inherited-offset-moves-only-the-elements-with-a-rule-that-reads-it).

Toasts need to clear the bars and the dock too, but they can't read `--pin-lift`: the toast region sits beside every screen, not inside one. So `ReaderFrame` sets it directly with `<ToastClearance blockEnd={px} />`, passing its bottom bar's height (while the bars show), plus how far the open sheet covers the page, plus the space below its page area (the phone dock), measured as `bodyHeight - pageHeight`. Why toasts live outside the screens is in [a toast above a modal must live inside the modal](/html/top-layer/#a-toast-above-a-modal-must-live-inside-the-modal).

## The dock and the capture panel

The capture panel is shown in the `Dock`. When you make a capture while the dock is closed, its card should scroll into view when you next open the dock. Each card's `<li>` has an attachment that does the scrolling, and it reads the dock's `visible` prop. An attachment re-runs when anything it reads changes, so opening the dock re-runs it, with no `$effect` or callback. It runs after the render effects of the same update, so the `Dock` panel's `hidden` attribute is already off when it measures and scrolls ([an attachment that reads a prop runs again](/svelte/attachments-and-listeners/#an-attachment-that-reads-a-prop-runs-again-when-the-prop-changes)). How it scrolls each new card only once is on [captures](/projects/dokseo/recognition/captures/).

## Chapter ticks on the page bar

The page bar is a native range input for moving through the book. It shows the chapters as tick marks, absolutely placed over the track from a runtime `--at` percentage, and centered on the track's line so they don't stretch over the thumb. The probe that reads the theme's ink colors, `PageInkProbe` (its main use is painting ebook chapters, on [chapters](/projects/dokseo/ebook-reader/chapters/#painting-a-chapter-in-the-theme)), reads its own inherited `color` and `color-scheme`. Because it only reads what it inherits, one probe serves any reader with no reference to the element it sits in. See [tick marks over a native range input](/ui-patterns/reader-layout/#tick-marks-over-a-native-range-input).
