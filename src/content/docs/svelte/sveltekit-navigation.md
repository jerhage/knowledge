---
title: "SvelteKit Navigation: Reused Routes, Shallow Routing and afterNavigate"
description: Route reuse on param changes, why shallow `replaceState` moves nothing, same-route `goto`, and one-time query parameters.
tags: [sveltekit, svelte, svelte-5]
sidebar:
  order: 7
---

SvelteKit reuses a route component when only its params or query change, and a shallow `replaceState` changes the address bar without being a navigation. Most navigation gotchas come from one of those running into an effect (see [effects](/svelte/effects/) for what an effect tracks).

## `afterNavigate` follows a same-route param change

When only the params or query change, SvelteKit keeps the same route component instance. So `/read/a` to `/read/b`, or `?image=3` to `?image=7`, doesn't remount anything. Work that should follow the param or the query can't sit in `onMount`, because nothing mounts again. `afterNavigate` is the callback for both. It's registered in `onMount`. It fires once for the navigation that mounted the component (`from` is null on a first load), and then after every navigation while the component is alive, including `goto(..., { replaceState: true })`. It gets removed on destroy, before the callbacks run for the navigation that destroyed it.

A popstate between two entries of the same navigation updates `page.url` without firing `afterNavigate`. That can only happen after a shallow `pushState` or a hash link.

When this callback replaces an effect keyed on a param, it has to store the last request it handled and do nothing for an unchanged one, because the effect's derived value only re-ran it on a real change.

## A shallow `replaceState` leaves `page.url` where the navigation put it

Shallow routing is how a page changes its URL without navigating, for example to keep the address bar in step with where someone is on the page. It isn't a navigation. In SvelteKit 2 (checked on 2.70.3), `replaceState(url, state)` and `pushState` from `$app/navigation` write the history entry and `page.state`, and rewrite the address bar. But `page.url` from `$app/state` keeps the url of the last real navigation, because `client.js` in `@sveltejs/kit` clones the page with its old `url`.

So:

- If you mirror a place into the address bar with `replaceState`, nothing that reads `page.url` gets recomputed. A `$derived` over `page.url` doesn't move, and neither does an effect that follows it.
- Reloading the mirrored address is a navigation, so that one does.
- `location.href` has the mirrored URL. `page.url` has the last one you navigated to. Read the one you mean.

So a callback that rewrites the address based on what it says *now* has to start from `new URL(location.href)`. If it started from `page.url`, each rewrite would begin again from the url you arrived at, and bring back a parameter an earlier rewrite had dropped.

## A same-route `goto` starts no load, so follow it with a callback

Say a route starts its loads in an `$effect` keyed on an id, and some code navigates with `goto` and relies on something happening once the new page has loaded. A `goto` that only changes the query of the page that's already open doesn't re-run that effect. So no load starts, and anything hooked onto the end of a load never runs.

The follow-up belongs to whoever navigated: `goto(href).then(…)` calls a callback the route provides. By the time the promise resolves, `page.url` has moved. So a `$derived` read from it inside the callback has the new value, and a prop read there has the route's current value. Compare it with the value you noted before the `goto` to tell a same-page navigation from a new one.

## Clearing a one-time query parameter after arrival

I wanted to show a one-time notice on arrival (`/?missing=book`). The parameter is there to trigger the notice once, and it shouldn't stay in the address. Show it from `afterNavigate`, which also runs for the first load. Then call `replaceState` with the URL minus that parameter, so a reload or Back doesn't show it again. `replaceState` is shallow routing, so it doesn't run `afterNavigate` again.

Restoring scroll position when the route's content lives in an inner scroller is a separate problem: see [app shells with an inner scroller](/scrolling/inner-scrollers/).
