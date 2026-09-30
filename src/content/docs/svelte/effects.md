---
title: "Svelte 5 Effects: What Is Tracked and What Re-runs"
description: Effects that track through calls and method heads, writes that re-run anyway, `$effect.pre`, `onMount`, keyed-each churn, and deriveds that build new objects.
tags: [svelte, svelte-5]
sidebar:
  order: 2
---

Most of these are cases where an effect ran more often than I expected. Quick vocabulary: while an effect runs, it "tracks" every piece of reactive state it reads. Those reads become its dependencies, and when one of them changes, the effect runs again. Several of these problems go away if I swap the effect for an attachment or a handler: see [attachments and listeners](/svelte/attachments-and-listeners/). The React counterpart is [an effect that keeps two pieces of state in step](/react/components-and-effects/#an-effect-never-keeps-two-pieces-of-state-in-step).

## An effect tracks a prop it merely calls

Say a component gets a `load` function as a prop, and an effect calls it with a value: `await load(wanted)`. You'd expect the effect to depend only on the value it passes.

It doesn't, because of how async functions run. When an effect calls an async function, the function's synchronous head (everything up to its first `await`) runs inside the effect. So `await load(wanted)` reads the `load` prop while the effect is tracking, along with everything that prop's getter touches. All of that becomes a dependency, and a change to any of it runs the effect again.

The fix: read the real dependencies at the top, then `await untrack(() => load(wanted))`.

Whether the `load` prop ever changes in practice depends on how the parent writes it. `load={(index) => view.decodePage(index)}` compiles to a plain property on the props object. It's created once, so it stays the same function no matter how often the parent re-renders. An inline arrow is not automatically a new function on every render. Only an expression the compiler wraps in a getter gets re-evaluated on each read.

So with a parent written like that, the extra dependency never fires. I untrack the call anyway. It costs nothing, and a later caller can't break it by passing a getter that reads state.

## A method whose synchronous head reads and writes state reruns the effect that calls it

The same thing happens with a method on a view model. Say a component opens an item from an effect, `$effect(() => { void view.open(id); })`. That runs `open()`'s code inside the effect, up to its first `await`. My method read `this.language` and then wrote it. The read made `this.language` a dependency of the effect, and the write changed it, so the effect ran again. Every mount did its reads and probes twice, and a change threw away the open in progress and redid it. Nothing looked wrong on screen. I only caught it by counting the calls.

What I do now: when an effect calls a view model's method, such as an open, I first read the values the effect should depend on, then make the call inside `untrack` (`const id = bookId;` then `untrack(() => void view.open(id))`). Or I call it from `onMount` (see [below](#onmount-and-ondestroy-are-effects-that-cannot-track)).

## An untracked write still re-runs the effect that read the source

Some effects read a pending value, act on it, and clear it. You might wrap the clearing write in `untrack` to keep it from re-running the effect. That doesn't work.

`untrack` stops a read from turning into a dependency. It does nothing about a write. If an effect sets a source (a piece of reactive state) that it has also read, Svelte 5 schedules the effect to run again, whether or not the write is inside `untrack`. I checked this on 5.57. Inside Svelte, `internal_set` records the write while the effect is active, and `update_reaction` then calls `schedule_possible_effect_self_invalidation` for it.

To measure it, I compiled a module with `svelte/compiler` and ran it under `--conditions=browser`. An effect that reads a value and sets it to `null` ran twice on mount, then twice more for each new value. Same result with the write tracked or untracked.

So the effect that reads a pending value and clears it always runs one extra time. On that run it reads the cleared value and does nothing. If the extra run matters, remove the read, not the write.

## An effect keyed on an id, not on the object that holds it

I had a viewer that gets the book record as a `book` prop and opens the book from an effect. The open effect read `book`.

A `$effect` runs again when any `$state` it reads changes. A prop holding a record counts as changed whenever the parent passes in a new object, even one with the same id. So someone edits the book's details, the edit replaces the record with its saved copy, and the viewer closes the book and opens it again.

The fix: read `book.id` as a tracked expression, and grab the object with `untrack(() => book)`. Now the effect only runs again for a different record. Markup and `$derived` values that read `book.language` or `book.title` stay reactive and pick up the edit.

## A user `$effect` that sets state runs the next user effect before the DOM catches up

A viewer read the frame's size in one `$effect` and set the opening `scrollTop` in a later one. The first effect changed state, and that marked the second one dirty (due to run) in the same flush, meaning the same batch of updates. So the second effect ran before the template redrew. The content was still drawn at width 0, so the browser clamped the scroll write far short of where I wanted it.

Moving the size read to `$effect.pre` gets the size into the DOM before any user effect runs, and then the write reaches its target.

The rule I follow now: if a later effect measures or scrolls, any state it needs in the DOM first belongs in `$effect.pre`. You can see the problem with a probe that logs the scroller's `scrollHeight` on each `scrollTop` write (a setter wrapped on `Element.prototype`).

## `onMount` and `onDestroy` are effects that cannot track

In Svelte 5 runes mode, `onMount(fn)` is `user_effect(() => untrack(fn))` and `onDestroy(fn)` is `onMount(() => () => untrack(fn))` (see `svelte/src/index-client.js`). So switching from `$effect` changes the name, not the timing. The body runs when an effect would, and a function you return runs on unmount.

What does change is tracking, because the body runs inside `untrack`. Nothing the body reads becomes a dependency, so a route's setup written as

```ts
onMount(() => {
  void view.startSession();
  return () => view.dispose();
});
```

can't run again just because `startSession()` touched some `$state` along the way (the double run [above](#a-method-whose-synchronous-head-reads-and-writes-state-reruns-the-effect-that-calls-it)). A manual `untrack` in there isn't needed anymore.

The flip side: a mount callback never runs again. That's only right when the work belongs to the component instance, not to a value that can change while the instance stays mounted. SvelteKit reuses a route component when only a param or the query changes. So work that should follow `?tag=` or `[id]` needs `afterNavigate` or a getter the view model reads, not `onMount`. The same instance-or-value question comes up when seeding state: see [state and props](/svelte/state-and-props/).

## A keyed each item is one signal holding the whole object

A signal is a single reactive value that Svelte tracks. `{#each layout.items as item (item.index)}` makes `item` a reactive source like that, and its value is the whole item object. A child that reads one field of it (`index={item.index}`) depends on the object, not on the number. Say the layout function builds fresh objects every time it recomputes, and the list recomputes on every scroll event. Then the source gets a new object every frame, and everything that depends on it runs again, even though the index is the same.

In a [virtualized image strip](/scrolling/virtualized-image-strips/), that put "Loading…" over an image the reader was already looking at. The child's load effect reads `index`, so every scroll ran it again. It reset its phase to loading and decoded the bitmap again, once per mounted item, per scroll event. I measured it with a temporary probe: two mounted canvases and five scroll events made ten extra decodes before the fix, and zero after. The cost grows with the number of mounted items.

The fix is to narrow the dependency with a `$derived` on the field:

```ts
const asked = $derived(index);
```

A derived only bumps its write version when its value actually changes. So the effect that reads `asked` gets skipped when only the object is new, and still runs again when the value really changes.

When the key is the item itself (`{#each pages as index (index)}`), Svelte leaves out the item signal entirely. That's why a list keyed on primitives (plain numbers or strings) never shows this.

## A `$derived` that returns a new object wakes its readers every time

When a `$derived` recomputes, Svelte compares the new value with the old one by identity (`===`). When a string or a number comes out the same, the update stops there, and an `$effect` that reads the derived doesn't run again. That's the narrowing in the section above.

A derived whose function builds a fresh object or array never comes out the same. Every recompute returns a new value, even when every field matches the last one, so every reader runs again. An effect that reads it runs on every change to anything the derived read, not only on a real change to the result.

So when an effect should run only on a real change, I have it read a primitive derived, such as a key string built from the fields that matter. And a list that's mapped from state goes in a class `$derived` field, not in a getter that maps on each read: the getter builds a new array on every read, and the field builds one only when its inputs change.
