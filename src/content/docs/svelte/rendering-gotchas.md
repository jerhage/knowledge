---
title: Svelte 5 Rendering Gotchas
description: "Throws inside `$derived`, rejected state writes during teardown, native dialog focus timing, `:global` lifetime, template whitespace, and a local named `state`."
tags: [svelte, svelte-5, focus, dialog, css]
sidebar:
  order: 5
---

## A rune that throws takes the whole component with it

A component got a new required prop, and one caller never passed it. At runtime the prop was `undefined`. It reached `match(value)...exhaustive()` inside a `$derived`, and ts-pattern threw `Pattern matching error: no pattern matches value undefined` while Svelte was evaluating the derived for an `{#if}`. Nothing rendered (the panel that component draws just never opened), and the only trace was one `pageerror` in the console.

What I keep from that:

- **`$derived` is evaluated during render, so a throw inside one gives you a blank component, not a bad value.** There's no partial paint and no fallback, unless a `<svelte:boundary>` above it catches the error. Any guard that determines whether markup exists (`.exhaustive()`, a `find` that can't fail, an `at(...)`) runs on the render path, and when it throws it takes the subtree with it.
- **svelte-check *does* catch the missing prop**, and names it exactly: `"Property 'x' is missing in type ... but required in type 'Props'"`. A bug like this reaches a browser because the type check didn't run to completion, not because the types missed it.

## A DOM event can arrive inside Svelte's render work, and a state write there is rejected

Svelte rejects a state write while it's in the middle of certain work, and raises `state_unsafe_mutation`. The error reads as if it's only about writing state from inside a `$derived`, but the check is wider. `svelte/internal/client/reactivity/sources.js` rejects `set()` whenever `active_reaction` (the reaction Svelte is currently running) has any of the flags `DERIVED | BLOCK_EFFECT | ASYNC | EAGER_EFFECT`. An `{#if}` or `{#each}` block is a `BLOCK_EFFECT`. So a write is also rejected while Svelte is building or tearing down one of those blocks.

An ordinary event listener can end up running at that moment, because **in Chromium, removing a node that holds focus dispatches `blur` and `focusout` synchronously, from inside the removal.** Firefox and Safari don't fire either one on removal, which matches the HTML spec's focus fixup rule. Chromium has an intent to stop doing it, so for now this only happens in Chromium. So when Svelte tears down a branch that contains the focused element, a `focusout` listener runs on top of Svelte's stack while the block effect is still active. Then a line in that listener as plain as `held = look()` is a forbidden write. You can recognize it from the stack: it names the listener and the Svelte frames below it (`remove_effect_dom`, `destroy_effect`, `on_destroy`, `pause_effect`, `BranchManager.ensure`).

Typical triggers: closing a non-native dialog that held focus, closing a command palette, and SvelteKit's `reset_focus` on a client navigation. In development an HMR (hot module replacement) remount does it too, which can make the bug look reachable from a route when it isn't.

The listener in my case was reading where focus is and storing it. The fix is to put off the read until the next microtask, not to wrap the write in `untrack`. `untrack` does suppress the guard, but it leaves a second bug in place: while `focusout` is firing, `document.activeElement` is *not* the new target yet. The browser clears the old element, fires `blur` and `focusout`, sets the new one, and then fires `focus` and `focusin`. So a focus reading taken during `focusout` describes a moment that's already over. One microtask later, focus has settled, and a single deferred read covers the whole focus change instead of reading twice.

What works well for me: a view model that takes a `Defer` function (something that schedules a callback for later) and folds every `refresh()` in one turn into a single read. Because the deferral is passed in, a spec can drive the view model from plain Node with a queue it flushes by hand.

## A native `<dialog>` returns focus before its `close` event

The section above says that in Chromium, removing a node that holds focus dispatches `focusout` synchronously, on top of Svelte's teardown stack, and a state write in the listener then fails with `state_unsafe_mutation`. Closing a dialog is one of the usual triggers. A modal `<dialog>` is the case where it never happens, so knowing which dialogs are native tells you whether a page has the bug at all.

When a modal dialog closes, it moves focus back to the element that had it before, as part of the close-the-dialog steps. Only *then* does it queue the `close` event as an element task. So a component whose `onclose` flips the `{#if}` flag runs a task later, when focus is already back on whatever opened the dialog. The removed subtree holds no focus, `removeChild` dispatches nothing, and the listener is never on the stack. So a branch behind a native modal dialog can't hit `state_unsafe_mutation`.

I measured this in Chromium. Dialogs built as `<dialog>` + `showModal()` were all clean against an unfixed listener, whether I closed them with Escape, a Close button, the backdrop or by picking an entry. The one that threw was a plain `<div role="dialog">` behind `{#if shown}` that focused its own input. That's the difference, and it's the only one.

This also tells you where to look. A component with a `focusout` listener is exposed through every `{#if}` branch *on the page* that takes focus, not only the ones it owns. A palette the route renders outside the component's own branch still reaches that component's listener.

More on focus and native dialogs in [focus around modal dialogs](/html/dialog-focus/).

## Component CSS is global once the chunk loads, so `:global` outlives the component

Svelte scopes a component's selectors with a hashed class. It doesn't scope *when* the stylesheet is attached. The CSS gets hoisted into the component's chunk and stays in the document for the life of the page. So a `:global(html)` rule keeps applying long after the component that declared it is destroyed.

Say a full-screen view needs `overflow: hidden` on `html` while it's mounted. You might write `:global(html) { overflow: hidden }` in its `<style>`, and that looks like it's scoped to the view. It isn't. Visit a list screen, open the full-screen view, go back, and the list (which uses document scroll) can't scroll past the first screen anymore. It never breaks on a first visit, only on the second navigation, which is why it took so long to find.

Something that has to be undone when a component goes away is behavior, not style. Set it in an `$effect` and undo it in the effect's teardown. The teardown runs on every unmount, including an SPA navigation and an unexpected one. A scroll-lock helper like that puts back the *previous* inline value it read, never a hard-coded `''` or `'auto'`. It also counts holders, so a second lock can't record `'hidden'` as the value to restore. A scroll lock has a layout cost of its own: see [app shells with an inner scroller](/scrolling/inner-scrollers/).

With a layered global design system I don't write component `<style>` blocks at all (see [Svelte with a global CSS design system](/design-systems/svelte/)). That gets rid of this problem, and the unlayered-CSS one too.

## Svelte drops the spaces at the edges of an element's text

I had a line of metadata with a dot between the parts, written as `<span aria-hidden="true"> · </span>` so the dot has a space on each side. It renders as a bare `·` ("2 documents· captured just now"). The spaces are gone because Svelte trims whitespace at the start and end of an element's children. Space out a separator with a margin utility, not with spaces inside it:

```svelte
<span class="mx-1" aria-hidden="true">·</span>
```

## Running text with markup in it: build the pieces, render them on one line

Say you want to draw "`⌘K` to search everything" from data, with the key as a `kbd` inside the text. Build a list of `key` and `words` pieces in plain TypeScript. The spaces go in the words: `' to search everything'`, `' + '`, `' · '`. Then render them in one unbroken template line of `{#each}`, `{#if}` and `<kbd>`.

The spaces belong in the data because of how Svelte treats whitespace. Svelte collapses the template's own whitespace between tags, so a space you write in the template is easy to lose. A space inside an expression's value is always kept. With the pieces built in TypeScript, a spec can pin the exact markup.

## A `const state` in a component script turns `$state` into a store read

A [data component](/svelte/data-components/) holds a read state in its script, and the obvious name for that local is `state`. In a `.svelte` file, that name gets in the way of the `$state` rune.

Svelte treats `$name` in a component script as the auto-subscription to a store held in a variable called `name`. That's the Svelte 4 store syntax, and it still works in Svelte 5. So a top-level `state` and the `$state` rune share a spelling, and what happens depends on how `state` is declared. I compiled both cases with Svelte 5.57 and ran svelte-check on them:

- With a plain value, `const state = { … }`, the compiler really does turn every `$state(...)` in the script into a read of a store called `state`, and it warns `store_rune_conflict` ("there is a local binding called `state`").
- With `const state = $derived(...)`, the compiler still compiles `$state(...)` as the rune, so the component runs fine. svelte-check still fails, because it type-checks TypeScript it generates from the script, and there `$state(...)` is a store read. It reports "Block-scoped variable '$state' used before its declaration" for each `$state` written above the declaration, followed by a chain of implicit `any` errors for the variables they initialize. A `$state` written below the declaration gets "Cannot use 'state' as a store" instead.

The fix is another name for the local (`held`, say). A property or getter named `state` on an object is fine, because only a top-level variable in the script can be read as a store.
