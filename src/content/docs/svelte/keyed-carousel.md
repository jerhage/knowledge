---
title: A Page Carousel with Keyed Panes
description: Keeping loaded pages across a turn by keying panes, and reading a transition that a state class turns on.
tags: [svelte, svelte-5, css, motion]
sidebar:
  order: 6
---

My reader shows an image book one page at a time, and you turn pages with a swipe or a page-turn control. The carousel behind it has up to three slots: the previous page, the current page and the next page. The two neighbors sit beside the current page, off screen, and a turn slides them into place. The CSS side of this carousel (three keyed slots, a settling class, the fallback timer) is in the [component contract](/design-systems/component-contract/#options-a-system-adds-beyond-the-baseline). This page is the Svelte side.

## A keyed pane keeps a loaded page across a turn

I wanted the next page to show up with no flash of an empty page while it loads. The answer was to mount the neighbor ahead of time and let the turn give it a new role: the pane that was "next" becomes "current".

That only works if the pane's DOM survives the change of role. I use a keyed `{#each}` over panes, keyed by the first image in each page group. With a key, Svelte moves the existing DOM node instead of making a new one. A canvas keeps its bitmap, and an `<img>` keeps its decoded image and object url. If a carousel component keys its slots by each slide's `key` and renders slides through a snippet, every place that uses it gets this for free.

Moving panes between roles brings its own problems. The rules I ended up with:

- The pane holding the current page has to stay in the layout flow. A frame whose only children are absolute collapses to 0×0 when no stylesheet sizes it. (A browser test that renders without the global stylesheet catches this. It misses it if the panes are `container-type: size`, because that gives no intrinsic size either. In a test like that, load the global stylesheet.)
- Anything that queries pages by attribute (a [selection layer's](/interaction/selection-marquee/) `[data-image-index]`) must not find the off-screen ones. Otherwise a selection could be measured against a page nobody can see. The neighbors are `inert`, but `inert` doesn't hide an element from `querySelectorAll`, so the neighbor leaves the attribute off.
- Both roles need the same geometry, or the page moves when its role changes. Every pane is a frame-wide slot: the current one in flow with `flex: 0 0 100%`, the neighbors absolute. Every strip uses the same origin-0 translate-and-scale. A neighbor's viewport is the one the viewer will apply when the page arrives. I once showed a neighbor at the current zoom. It looked right until fit-to-width recomputed the zoom after the turn, and then the page jumped.
- If the new role has to reuse a measurement, store it under the pane's key, not on the element playing the current role. An attachment that moves a reference over to the new current element runs in its own effect, and nothing makes it run before other effects. So an effect that reads the size through that reference on arrival can still read the old element. Instead, on arrival, read the size the pane reported while it was still a neighbor.
- An `{@attach factory(item.key)}` inside a keyed `{#each}` over a `$derived` list re-runs every time the list is rebuilt. Each item is a new object, and the attach expression tracks it. When the attachment has to live as long as the element, read the key inside `untrack`. (More on how attachments re-run in [attachments and listeners](/svelte/attachments-and-listeners/).)

**Reduced motion makes every transition instant.** The carousel waits for a turn's transition to finish before it treats the turn as done. Say a reduced-motion override sets `transition-duration: 0s` and `transition-delay: 0s`. Then a transition never starts, so no `transitionend` fires. JS that waits for one has to finish right away when the computed duration is zero, or wait on `getAnimations()`, which comes back empty. A fallback timer on its own turns an instant change into a delay as long as the timer's margin.

## Reading a computed transition that a state class switches on

When someone releases a turn, the slots ease into their resting place. I call that the settle. The settle normally ends on `transitionend`, and if that never arrives, a fallback timer ends it. The timer's length comes from the slot's `transition-duration`.

Reading that duration at the obvious moment gives the wrong answer. The slot has `transition: none` until a `.is-settling` class is on it, and that class arrives with Svelte's next DOM update, not with the state assignment. So if you read `getComputedStyle(slot).transitionDuration` inside the event handler that sets the state, you get `"0s"`.

Start the timer in an `$effect` on that state instead. Effects run after the DOM update, so the class is there. When the state changes, the effect's teardown clears the timer, so I don't need a timer variable I manage by hand.

The value itself needs parsing. Chromium reports the duration in seconds (`"0.18s"`), and it can be a comma-separated list. Take the longest and round the seconds to whole milliseconds (`0.14 * 1000` is `140.00000000000003`).

The same reading works for a design token. To pass a length token to TypeScript, register it with `@property` as a `<length>`. Its computed value then comes back in pixels. An unregistered one comes back as its specified value with the `var()`s substituted. Details in [registered custom properties](/css/registered-custom-properties/#computed-values).
