---
title: React Rules I Hold in Rifty
description: No JSX in a variable, state changed by callbacks instead of effects, no ref shadowing state, and hooks named for what they provide.
tags: [rifty, react, components, naming-conventions]
sidebar:
  order: 81
---

Rifty's screens are React Native components, and a few React habits come up again and again. These are the rules I hold, as Rifty applies them; the general versions, with the full reasoning, are on [React components](/react/components-and-effects/). They sit below the [data components](/projects/rifty/presentation/data-components/): a data component owns a side effect, and a hook is for UI mechanics (see [hooks for mechanics, data components for side effects](/architecture/data-components/#hooks-for-mechanics-data-components-for-side-effects)). Everything here is about the components and hooks on either side of that line.

## No JSX in a variable

On a tablet, the cards tab shows the catalog grid beside a pane with the selected card's details. The obvious way to write that holds each part in a variable first:

```tsx
const catalog = <CatalogGrid … />;
const pane = selected ? <CardDetailPane … /> : <CardDetailIdle />;
return <SplitLayout primary={catalog} secondary={pane} />;
```

I don't allow that. In Rifty a piece of the tree is a component declared with `function` or an element written inline where it's used, for the reasons in [a piece of the tree is a component or an inline element, never a variable](/react/components-and-effects/#a-piece-of-the-tree-is-a-component-or-an-inline-element-never-a-variable). Passing an element as a prop is still fine: `primary={<CatalogGrid … />}` writes the element where it's used.

## State changes through callbacks, not effects

In the deck builder, the pool is the list of cards someone can add to the section they're filling, narrowed by filters and a search. When they move to a different section, the pool's filters and search should reset, because each section draws from a different pool.

One way to do that is an effect that watches the section and resets the filters when it changes. I don't allow an effect that watches one piece of state to write another. When something has to change, the code that caused it calls a named function. The builder calls `resetFor(legend)` at the two moments the pool's subject changes: entering the sections step, and picking another section. Someone reading the builder can find both calls. Why an effect is the wrong tool here is on [an effect never keeps two pieces of state in step](/react/components-and-effects/#an-effect-never-keeps-two-pieces-of-state-in-step).

Effects are for events from outside React. All of `src/` has four `useEffect` calls, and each is one of those: opening the database at startup, the loading skeleton's pulse animation, a debounced value, and a subscription to the system's reduce-motion setting.

## A ref is not a second copy of state

The builder's draft is state, and some updates need its current value. The tempting fix is a ref that mirrors the draft, so a callback can read `draftRef.current` without being recreated.

Rifty uses the updater form instead, for the reasons in [a ref that mirrors state has the same problem](/react/components-and-effects/#a-ref-that-mirrors-state-has-the-same-problem-use-the-updater-form):

```tsx
setDraft((current) => …);
```

## Hooks are named for what they provide

Long-pressing a card opens it, with a haptic tap. The hook that wires this was first called `useHapticLongPress`. That name describes the mechanism, and it invited the wrong question: can it take an intensity?

The hook is `useOpenCardHapticLongPress` now. The name encodes where it wires (`onLongPress`), what it does (opens a card) and that a physical side effect fires. The intensity is part of the action, so it isn't a parameter. If a second long-press action needs a different weight, say removing a card, it gets its own hook, `useRemoveCardHapticLongPress`, not a second argument. That keeps `expo-haptics` in one file, keeps the set of actions reviewable in one place, and leaves room for the next difference: a destructive action may also need a longer delay or a confirmation, and only a named hook has somewhere to put that.

The test I use: could a caller pass something that contradicts the name? If yes, the parameter holds information the name should encode. The general rule is [name a thing for what it provides](/practices/one-word-per-concept/#name-a-thing-for-what-it-provides), and the React form of it is [a hook is named for what it provides](/react/components-and-effects/#a-hook-is-named-for-what-it-provides).

The same goes for components. A data component is `<Thing>Data` and passes its children resolved data. And the surrounding UI (the tab bar, the rail, the headers) is the **shell**, never "chrome", because "chrome" names nothing a reader can point at. The shell's parts are on [phone and tablet layout](/projects/rifty/presentation/phone-and-tablet/).
