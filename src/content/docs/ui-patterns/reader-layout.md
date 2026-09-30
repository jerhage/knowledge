---
title: "Reading-App Layout: Direction, Sheets and Sliders"
description: "Mirroring controls for RTL, one list in two places, bottom sheets that do not reflow the page, and range-input ticks."
tags: [ui-patterns, i18n, css, svelte-5, mobile]
sidebar:
  order: 2
---

Layout choices for a reader (books, comics, long documents), where the page itself is the expensive thing to lay out.

## Mirroring controls with the reading direction

Dokseo, my manga and book reader, turns pages three ways: a page slider, a pair of turn buttons next to it, and the arrow keys. Right-to-left books, like manga, flip "next". In RTL, the next page is to the *left*, so each of those controls has to point the other way. Instead of writing separate RTL versions, I keep one rule and mirror it:

- the page slider gets `dir={direction}`, so its minimum is on the right in RTL;
- the turn buttons are one group, placed at the slider's forward end (`before` for rtl, `after` for ltr). So "next" is always the outermost button, on the side its arrow points to;
- a small mapping turns the physical arrow keys into next/previous (more on key handling in [keyboard shortcuts](/interaction/keyboard/)).

Each of those decisions is a small function of the direction. Unit-test these as pure functions. The markup just reads them.

## One list, two homes: the nav column and a phone sheet

My tag screens have a list of tags with a filter field above it. On a wide screen the list belongs in a nav column beside the content, and on a phone there's no room for that column. A filterable list like this can render from one snippet in two places: a nav column that only shows on wide screens, and a `Modal` sheet opened from a header button that only shows on narrow ones.

- The snippet takes where it's rendering as an argument, so the two filter inputs get different ids.
- Both bind the same view-model filter.
- Each link closes the sheet on click.

If there's a window-level key handler behind the sheet, it has to ignore events whose target is inside a `dialog`. Otherwise someone types in the sheet's filter, presses an arrow key to move the caret, and the handler behind the sheet acts on that key too, moving through the page underneath.

## A bottom sheet that shrinks the page costs a reflowing viewer a relayout

On a phone, Dokseo's controls live in a bottom sheet. It peeks up from the bottom of the screen, and it can be opened, closed and dragged. The question is whether the page gets smaller to make room for it. If the sheet is laid out as a flex sibling of the page, it takes its height from the page area. Then every open, close and drag frame resizes whatever fills the page. An image viewer only rescales, so it looks like nothing happened. But an ebook renderer (foliate) re-paginates the chapter on every resize (see [foliate-js chapters](/ebooks/foliate-chapters/)). So someone drags the sheet open over a book, and the chapter is laid out again on every frame of the drag.

Keep the sheet out of the flow: absolutely positioned over a fixed reserved area the size of its peek state. Then pass how much it covers back to the frame as a number, so the chrome and the pinned controls move and the page doesn't. This is the bottom sheet in my [component contract](/design-systems/component-contract/#options-a-system-adds-beyond-the-baseline). Why the collapsing part has to hold the size is under [a dock that hides](/css/layout-quirks/#a-dock-that-hides-must-be-sized-by-its-content-not-by-a-class).

## Tick marks over a native range input

Dokseo's page bar uses a native range input as the page slider, and it marks where each chapter starts with a tick on the track. You can absolutely position chapter ticks over a range input's track, from a `--at` percentage set at runtime. `inset-block-start: 50%; translate: -50% -50%` puts them on the track's center line. `inset-block: 0` would stretch them over the whole height of the thumb.

Another thing from the same bar: a probe component that needs the colors it's drawn in doesn't have to get them from its host. An ink probe can read its own inherited `color` and `color-scheme`. So one self-contained probe component works in any host, without any reference to the host element.
