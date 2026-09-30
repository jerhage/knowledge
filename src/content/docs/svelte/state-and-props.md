---
title: "Svelte 5 State: Seeding from Props and Owning State"
description: "`$state.raw`, `$props.id()`, seeding with `untrack`, reseeding with `{#key}`, moving state into a view model, and exhaustive `{#if}` chains."
tags: [svelte, svelte-5, sveltekit]
sidebar:
  order: 1
---

## `$state.raw` for values you replace rather than mutate

When you give `$state` an object or an array, Svelte doesn't store it as is. It wraps every plain object and array inside the value in a proxy, an object that intercepts reads and writes so Svelte can track them. That deep proxying has a cost. Class instances and other non-plain objects are left alone, so it doesn't reach into a class's internals.

Much of my state never gets mutated in place. A collection or a value object gets replaced whole with a new one, and proxying its insides buys nothing. So I use `$state.raw` for collections and value objects that I swap out whole, and plain `$state` for primitives.

## `$props.id()` for ids that must be unique per instance

Some markup ties two elements together by id: `aria-labelledby` points at a label's id, and a `for`/`id` pair links a label to its input. A hard-coded id breaks when the component renders more than once on a page, because the two instances end up with the same id. `$props.id()` gives each instance its own, and that's what I use it for.

## `untrack` when seeding state from a prop once

A form component often starts from a prop: the item being edited comes in, and the form keeps its own editable copy. Reading the prop inside the `$state` call would normally make it a dependency, so the copy could get re-read from the prop while someone is typing.

`let form = $state(untrack(() => formOf(item)))` seeds the state without creating a dependency. So a re-read of the prop can't overwrite the form while someone edits it.

## An `untrack`ed prop is a one-way door until something re-reads it

The catch with seeding under `untrack` is that the component stops tracking the prop.

I had a continuous viewer, a scrolling strip whose parent passes its starting position in a `start` prop. The viewer read `start` inside `untrack` to set up its scroll anchor, and after that only followed its own `onscroll`. Later, something outside set a new position. The viewer ignored it: every number on screen changed, and not a single pixel moved.

The fix is an effect that re-reads the prop, and that effect has to track the prop *alone*. If the layout is in its dependencies too, it also fires mid-zoom. During a zoom the anchor is ahead of the reported position on purpose, so the effect detects a mismatch and drags the view back. (More on what an effect tracks in [effects](/svelte/effects/).)

## A child seeded once from a prop needs a `{#key}` to be reseeded

`untrack` seeds from the prop and then ignores it for the rest of the instance's life. That's right while the instance means one thing, and wrong as soon as it means another.

In SvelteKit, an instance can come to mean another thing without being recreated. SvelteKit *reuses* the route component when only a param changes. Going from `/item/a` to `/item/b` re-runs the effects that read what changed and leaves the tree standing. So a child holding a value seeded from item A keeps it under item B. (See [SvelteKit navigation](/svelte/sveltekit-navigation/) for the rest of what route reuse does.)

Wrapping the child in `{#key item.id}` forces a fresh instance for each item. A plain save replaces the item object but not its id, so it leaves the child alone. `bind:this` survives this: the binding is set to null on destroy and to the new instance on create.

## A prop read into `$state` warns: move the state out of the component

I had an editor component that took the text to edit as an `initial` prop and seeded its own draft from it:

```svelte
let draft = $state(initial);
```

svelte-check flags that with `state_referenced_locally`. The line captures the value at mount and never reads the prop again. The component might even be correct: if an `{#if}` remounts it for every edit, mount *is* the moment the draft opens. But the compiler can't check that.

Silencing it takes a `svelte-ignore` comment. The better fix makes the warning go away and also improves the design. Some view model already owns which item is being edited and which button gets focus back afterwards, and the draft belongs there too. The component binds to it, `bind:value={editing.draft}`, and owns no state except the textarea element.

In general: when a component seeds state from a prop, that state usually belongs to whatever owns the prop's lifetime. Passing in an object that holds `$state` as the prop resolves the warning.

## A child binds into a view model's `$state` fields

Sometimes a parent needs numbers or elements that only a child can measure, like the width of a body area or the element of a top bar. The parent can build a view model object for this and pass it down, and the child writes its measurements straight into it, with `bind:clientWidth={frame.bodyWidth}` and `bind:ref={frame.topBar}`.

This works because a `$state` class field compiles to an accessor (a getter and setter pair). So a binding to a member expression assigns through it, and everything that reads the field updates. You don't need a bindable prop, or an `$effect` to copy a value out. The parent reads the derived values as getters on the same object. [Bindings](/svelte/bindings/) has more on where a bound write goes.

## A derived that keeps its last value holds it in a plain `let`

I have a hint card that shows lines computed from `pending`. When the hints go away, I wanted the card to keep its lines while it fades out, instead of going blank mid-fade. So each new value depends on the previous one.

A `$derived` can't read its own value. In dev mode that throws `derived_references_self`. So I keep the previous value in a plain component `let` and reassign it inside `$derived.by`. The choice itself is a pure function:

```ts
let heldLines: readonly Hint[] = [];
const hintLines = $derived.by(() => {
  heldLines = heldHints(heldLines, pending);
  return heldLines;
});
```

This relies on the derived being read. The template reads `hintLines` on every render, so every value of `pending` goes through it. A derived that nothing reads would skip values.

## A snippet prop is the Svelte 5 slot

Some components host content they don't define, like a frame that wraps whatever the caller puts in it. In earlier Svelte that was the `<slot>` element, which is now deprecated. Passing a `Snippet` as a prop is how you do it now. It's also how two feature modules come together at a route without depending on each other: the route passes one module's content into the other as a snippet. The prop conventions I use for components are in [Svelte with a global CSS design system](/design-systems/svelte/). React's counterpart is [the render prop](/react/render-props-and-tanstack-query/#a-render-prop-is-the-react-slot).

## A `match()` goes in a `$derived`, not in markup

ts-pattern's `match()` builds a value by matching cases, as a chain of calls. I wondered whether a chain like that can sit directly in a template expression. It does compile there. I checked with `svelte/compiler` 5.57, explicit generics included.

I still put it in a `$derived` and have the template read the result. That keeps the markup short and gives the result a name.

## An `{#if}` chain closed by `unreachable` is exhaustive

A [data component](/svelte/data-components/) in my app holds a read state, a union on `kind` (`loading`, `failed`, `ready`), and its markup draws one branch per variant with an `{#if}` chain. When I add a variant to the union, I want every chain that draws it to stop compiling until it handles the new one, the way an exhaustive `match()` does in TypeScript.

svelte-check gives me that. It type-checks the code it generates from the template with ordinary TypeScript control-flow narrowing, and a `const` declared with `$derived` (or a destructured prop) narrows through `{#if state.kind === 'loading'}{:else if …}` just like a variable in a `.ts` file. So by the last branch, `state` has been narrowed to whatever variants the chain hasn't handled. If the chain ends with `{:else}{unreachable(state)}`, where `unreachable(value: never): never` is a one-line helper that throws, that call only compiles while nothing is left. Add a `refreshing` variant to the union, and svelte-check reports it at that line: "Argument of type '{ kind: "refreshing"; … }' is not assignable to parameter of type 'never'". I checked this with svelte-check against Svelte 5.57.

Whether the chain or a `match()` in a `$derived` draws the state is a choice ([above](#a-match-goes-in-a-derived-not-in-markup)); either way, a new variant can't slip through. React gets the same check from its own exhaustive match: see [render props and TanStack Query](/react/render-props-and-tanstack-query/#match-one-flat-union-not-tanstack-querys-result-object).
