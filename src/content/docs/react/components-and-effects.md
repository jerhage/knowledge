---
title: "React Components: JSX in Place, Callbacks over Effects, Refs That Don't Mirror State"
description: "Why JSX is never held in a variable, why an effect never keeps two pieces of state in step, what a ref is for, and naming a hook for what it provides."
tags: [react, components, naming-conventions]
sidebar:
  order: 1
---

These are rules I kept coming back to while building a React Native app, [riftcards](/projects/riftcards/presentation/react-conventions/). Nothing in them depends on React Native, so they hold on the web too. The Svelte version of the effect problem is on [Svelte effects](/svelte/effects/).

## A piece of the tree is a component or an inline element, never a variable

Say a tablet screen shows a grid beside a detail pane. The obvious way to write it holds each part in a variable first:

```tsx
const catalog = <CatalogGrid … />;
const pane = selected ? <CardDetailPane … /> : <CardDetailIdle />;
return <SplitLayout primary={catalog} secondary={pane} />;
```

I don't write it that way. A piece of the tree takes one of two forms:

- **A component**: a named function that takes props, local to the file or in a file of its own.
- **An element written inline where it's used.**

I choose between them by size and by reach, never by convenience.

A variable holding JSX is neither. It holds an element, not a component, so it can't call hooks of its own and it can't be wrapped in `memo`. React renders it exactly as if the element were written inline, so the variable buys nothing. And someone reading the `return` has to trace each variable back up to learn what the element depends on.

Passing an element as a prop is fine: `primary={<CatalogGrid … />}` writes the element where it's used. The intermediate variable is what to avoid. The riftcards case is [no JSX in a variable](/projects/riftcards/presentation/react-conventions/#no-jsx-in-a-variable).

## An effect never keeps two pieces of state in step

Take a picker with filters and a search, showing the cards for whichever section of a deck is being filled. When someone moves to a different section, the filters and search should reset, because each section picks from a different set of cards.

One way is an effect that watches the section and resets the filters when it changes. I don't allow an effect that watches one piece of state to write another. When something has to change, the code that caused the change calls a named function: `resetFor(legend)`, called at each place where the section changes.

Someone reading the code can find every call to `resetFor`, but an effect keyed on the section is invisible from the place that changed the section. The effect also runs one render late: React first renders with the old filters, commits, then runs the effect, whose state update causes a second render. React's own guide, [you might not need an effect](https://react.dev/learn/you-might-not-need-an-effect), describes the same double render for adjusting state when a prop changes.

Effects are for events from outside React: a subscription, a timer or an animation, a debounce, work that starts when the app mounts. The riftcards version, with the app's four effects, is [state changes through callbacks, not effects](/projects/riftcards/presentation/react-conventions/#state-changes-through-callbacks-not-effects). Svelte's `$effect` has the same trap in a different form; see [Svelte effects](/svelte/effects/).

## A ref that mirrors state has the same problem; use the updater form

Some updates need the current value of a piece of state, say a draft being edited. A callback that closes over `draft` reads the value from the render it was created in. The tempting fix is a ref that mirrors the draft, so the callback can read `draftRef.current` without being recreated.

That ref has to be kept in step with the state, which is the problem from the previous section in another form. And changing a ref doesn't trigger a render, so anything that reads it can show a stale value. When an update needs the current value, pass an [updater function](https://react.dev/reference/react/useState#updating-state-based-on-the-previous-state) instead. React calls it with the pending state:

```tsx
setDraft((current) => …);
```

A ref is for something React doesn't model: a native handle, a mutable value that has to survive a render without causing one, or a token that deduplicates work already in flight.

## A hook is named for what it provides

A custom hook's name says what it provides, not the mechanism inside it. For a hook that wires a gesture, that means the handler it wires (a long press, `onLongPress`), the action it performs, and that a physical side effect such as a haptic tap fires. A variant with a different action or a different feel is a second named hook, not a parameter on the first, because a parameter lets a caller pass something that contradicts the name. And the native library behind the side effect is imported in that one file. The general rule, with its example and its test, is [name a thing for what it provides](/practices/one-word-per-concept/#name-a-thing-for-what-it-provides).
