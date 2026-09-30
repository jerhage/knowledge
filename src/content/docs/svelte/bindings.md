---
title: Svelte 5 Bindings and Bound Elements
description: What a `$bindable` write reaches, the `null` Svelte writes on teardown, svelte-check's blind spot, and wrapping union-prop components.
tags: [svelte, svelte-5, typescript]
sidebar:
  order: 4
---

## What a write to a `$bindable` prop does depends on how the caller passed it

A component marks a prop `$bindable` when it writes the prop back, like a control that sets its own value prop when someone changes it. Inside the component the write looks the same every time (`value = chosen`). Where it goes depends on how the caller passed the prop:

- With `bind:value={x}`, it writes the caller's state.
- With a function binding, `bind:value={() => x, set}`, it calls `set` on every write, even when the value is the same, and reads back through the getter. The caller stays the source of truth.
- With a plain `value={x}`, it overrides the prop locally. The component shows the written value until the caller's `x` changes next, even if the caller never stores it.

The third case matters for a component that also reports changes through a callback (`onvaluechange`) and is meant to be controlled, meaning the caller sets the value. A caller passes `value={x}` and handles the callback. Someone changes the value, the component writes the prop, and it shows the new value whether or not the caller stored it. So the component is only as controlled as its callers make it: each caller has to set its value in the handler, before any `await`. The three branches live in Svelte's `prop()` in `internal/client/reactivity/props.js`.

Binding straight into a view model's fields is often simpler than a bindable prop: see [state and props](/svelte/state-and-props/#a-child-binds-into-a-view-models-state-fields).

## Svelte writes `null` to a bound element when it goes

`bind:this` puts an element (or a component instance) into a variable, and a component's `bind:ref` forwarded to it does the same. When the element is destroyed, Svelte sets the bound variable to `null`. It does that no matter what type the variable was declared with.

Since Svelte 5.53.9 this happens synchronously, in the teardown of the outermost block being destroyed (or of the component). Before that, it was queued in a microtask. So a `ref` typed `HTMLElement | undefined` can hold `null` after a teardown, and anything that reads it later (a microtask, a timer) can get that `null`. A check written as `!== undefined` then passes on a `null`, and the code goes on to use an element that isn't there.

Test a ref with `?.` (`bar?.inert === false`), which is true for neither `null` nor `undefined`. Don't rely on `!== undefined` or `!== null` alone. The code is `bind_this` in `internal/client/dom/elements/bindings/this.js`.

## svelte-check does not compare a bound variable with the prop's type

Given the teardown `null` above, you'd want svelte-check to catch a caller whose variable can't hold `null`. It doesn't.

`bind:ref={field}` with `field = $state<HTMLInputElement>()` passes svelte-check against a `ref?: HTMLInputElement | null | undefined` prop. So does a function binding that assigns the prop's value to a narrower `$state`. The check reads the variable into the prop, but never the prop back into the variable. That means widening a prop to include `null` never fails a caller.

So the type check won't catch it. Put the `null` in the prop's type and read the variable with `?.`. The `ref` typing rule I use for components is in [Svelte with a global CSS design system](/design-systems/svelte/).

## Wrapping a button component whose props are a union

I have a button component whose props are `ButtonProps | LinkProps`, split on `href`: with an `href` it renders a link, without one a button. It types `ref` for each member's own element.

I wanted a wrapper around it that fixes some props and passes the rest through. The obvious wrapper spreads one `...rest` into the button and binds one `ref`. It fails svelte-check twice. First with "a union type that is too complex to represent", and then because a `ref` of `HTMLButtonElement | HTMLAnchorElement` fits neither member.

The wrapper that works does three things, with no cast:

- It omits keys from each member, not from the union (a plain `Omit` of a union collapses it to the keys all members share):

  ```ts
  type ButtonProps<Given = ComponentProps<typeof Button>> = Given extends unknown
    ? Omit<Given, Named>
    : never;
  ```

- It renders `<Button>` in two branches on `rest.href === undefined`. That narrows `rest` to one member in each branch.
- Each branch binds with a function binding over its own typed `$state` (`bind:ref={() => asButton, (element) => (ref = asButton = element)}`). The public `ref` is the union.

A getter that tests `instanceof HTMLButtonElement` would narrow too. But it runs in `svelte/server` renders, where that global doesn't exist.
