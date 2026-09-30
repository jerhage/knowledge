---
title: "Replacing $effect: Attachments and <svelte:window> Listeners"
description: "How attachments re-run, one-shot attachments, passing an attachment through a snippet, how window/document handlers are wired, and how a window `onerror` handler is typed."
tags: [svelte, svelte-5]
sidebar:
  order: 3
---

When an `$effect` touches the DOM, I usually replace it with one of two things. If the work belongs to one element, it becomes an attachment. If it belongs to a global event, it becomes a `<svelte:window>` or `<svelte:document>` handler. The re-run rules they replace are in [effects](/svelte/effects/).

## An attachment re-runs like an effect, on what its function reads

An attachment is a function you put on an element with `{@attach}`, and Svelte calls it with that element. Inside Svelte, `attach(node, get_fn)` wraps the function in an ordinary `effect`, so an attachment is just an effect tied to one element. It runs after the element is in the document. It runs again when any `$state` it reads synchronously changes, and it calls its returned cleanup before each re-run. When the element leaves, it cleans up.

Because it's an effect underneath, when I move an `$effect` into an attachment, the re-run rule stays exactly the same, as long as the attachment reads the same values the effect read and wraps in `untrack` whatever the effect wrapped.

- A `bind:this` that only existed to feed the effect can go. The node is the attachment's argument. If the effect needed children, get them with `node.querySelector` plus an `instanceof` check. That works because the attachment runs after the whole template is built.
- Keep `bind:this` if handlers still need the element.
- Two attachments on one element run in markup order in the same flush (the same batch of updates), so the second one can read what the first one wrote.
- The order against the component's own `$effect`s changes. Those get created when the component's script finishes, which is after its template, so they run after every attachment in that template. Check that anything the attachment's work reads later is only read after its awaits.
- Replacing `bind:clientWidth` / `bind:offsetWidth` with one observer: Svelte's binding observes the border box and reads `element.clientWidth` or `offsetWidth`, not `contentRect`. It also sets the value once on mount. Do the same thing: `observe(el, { box: 'border-box' })` plus one untracked call at attach time. Skip the work when nothing changed, because writing an equal value to `$state` never re-ran the old effect either.

## An attachment that reads a prop runs again when the prop changes

I had a list item inside a panel that can be opened and closed. The item needed to be revealed, but the reveal had to wait until the panel was open. I did it with an attachment that reads a `visible` prop.

The body of an `{@attach}` runs inside an effect. So every reactive value it reads re-runs it, and that includes props. Because the attachment reads `visible`, opening the panel re-runs it. No `$effect` and no callback needed.

The timing works out too. It runs in a plain `effect`. That's not flagged as a user effect, but it's scheduled in the same phase as `$effect`, after the render effects of the same flush. So by the time it measures or scrolls, an attribute like the panel's `hidden` is already updated.

## A one-shot attachment keeps its mark in the view model

When someone creates a new item in a list, I want that item scrolled into view once, when it first appears. An attachment on the item looks like the place for that.

But put an attachment on an item of a keyed `{#each}` over a `$derived` list, and it runs again every time the list is rebuilt (see [the keyed pane note](/svelte/keyed-carousel/)). So "do this once when the element appears" can't count on the attachment running once.

So the attachment calls a view model to check whether to act. It steps through a small state (`none`, `pending` with an id, `done` with an id) kept in a plain, non-reactive field. A new item sets it to `pending`. While the list is visible, it returns true only for that id, and then records `done`. Svelte may run the attachment any number of times. Only the first visible run for the new item does anything: it scrolls the item into view. An item created while the list is hidden stays `pending` until the list shows.

The check runs inside the attachment's effect, and it writes the state as it goes. That's why the state is a plain field, not `$state`: the check doesn't write anything reactive from inside an effect.

## A snippet can pass its caller an attachment to spread

Say a base component, like a menu, needs its trigger's element, but lets the caller render the trigger. The base component passes an object to the trigger snippet, with a Svelte attachment under a symbol key from `createAttachmentKey()`. The caller spreads that object onto a button component. The button's `...rest` spread passes symbol keys through to the element, so the attachment runs there and records the element.

The prop type `[key: symbol]: Attachment<HTMLElement>` is assignable to the symbol index on the element's attributes, so I don't need a cast. This replaces a `bind:ref` the caller would otherwise have to pass back up. [Dropdown menus](/html/dropdown-menus/) use the same idea for a menu's trigger and its destroy hook.

## `<svelte:window>` and `<svelte:document>` handlers are plain listeners added at init

`<svelte:window>` and `<svelte:document>` let a component attach event handlers to the window or the document from its markup. The compiler turns `<svelte:window onfocusin={r} ontogglecapture={r} />` into `$.event('focusin', $.window, r)` and `$.event('toggle', $.window, r, true)`. That's a direct `addEventListener` on the target, never delegation (one shared listener at the app's root that passes events to handlers). The `capture` suffix maps to `{ capture: true }`, and Svelte removes the listener on destroy. I checked this by compiling a snippet with `svelte/compiler`.

How it differs from calling `addEventListener` in an effect:

- It's added while the component initializes, before its effects run. So it can receive an event that a mount-time effect would have missed. A handler that needs a bound element has to check that it's there.
- It lives as long as the component. If the effect used to add the listener only while some state held, the handler now returns early instead. That early return is the old effect's condition, moved into the handler.
- A non-capture handler first runs Svelte's delegated propagation. Any handler, capture or not, gets skipped once `event.cancelBubble` is set. `pointer*`, `touch*` and `wheel` are added a microtask later, after the Chrome clone bug.

I use this most for focus handling around dialogs: see [focus around modal dialogs](/html/dialog-focus/).

## A `<svelte:window onerror>` handler receives a plain `Event`

My root layout catches what no other part of the app catches: an error thrown outside any component's rendering, and a promise rejection nobody handled. It does that with two window handlers, `<svelte:window onerror={…} onunhandledrejection={…} />`, which log what they receive.

The types of those two handlers differ. In Svelte's `elements.d.ts`, the window's attributes inherit `onerror` from the attributes every element has, where it's an `EventHandler` over a plain `Event`, because an image or a media element fires `error` too, without an `ErrorEvent`. So `event.error` doesn't type-check in the handler: svelte-check reports "Property 'error' does not exist on type 'Event & …'". `onunhandledrejection`, declared on the window's own attributes, is typed as a `PromiseRejectionEvent`, so `event.reason` works directly. I checked both in `svelte/elements.d.ts` from Svelte 5.57.

To read the thrown value, I write `'error' in event ? event.error : event` rather than `event instanceof ErrorEvent ? … : …`. The `in` check narrows without a cast, and it also runs in bare Node, where a unit spec of the handler has no `ErrorEvent` (Node 24 doesn't define one).
