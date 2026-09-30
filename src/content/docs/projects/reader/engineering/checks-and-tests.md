---
title: How the Reader Is Checked
description: "The Deno tasks and what `verify` runs, the two Vitest projects, hand-written container fakes, the specs that guard the design system and the pdf.js builds, and the probes used for what no test can reach."
tags: [reader, testing, vitest, playwright, typescript, dependency-cruiser]
sidebar:
  order: 73
---

The reader is checked by a chain of Deno tasks: type check, lint, format, [dependency rules](/projects/reader/architecture/dependency-rules/), two [Vitest projects](/testing/vitest-projects/), and the build. What unit and browser tests can't reach, I check with [browser probes](/testing/browser-probes/) and [CSS refactor checks](/testing/css-refactor-checks/). This page is the reader's side of those: the real tasks, specs, numbers and failures.

## The tasks

```text
deno task lint:deps       dependency-cruiser alone: depcruise src --config .dependency-cruiser.cjs
deno task verify:static   type check, lint, format check, lint:deps
deno task verify:tests    verify:static plus the tests
deno task verify          verify:tests plus the build
deno task verify:ci       verify:static, the unit project only, and the build
```

That's the chain from [running the checks](/architecture/dependency-cruiser-rules/#running-the-checks), with one more step between: `verify:tests`, for when I don't need a build. `verify:ci` leaves out the browser project.

The build is in `verify` on purpose. Moving `manga-ocr.adapter.ts` once broke both recognizers while 1050 tests, 1203 checked files and a clean `lint:deps` all stayed green. Only `vite build` resolves a worker URL, and it failed with `[UNRESOLVED_ENTRY] Cannot resolve entry module src/lib/workers/ocr.worker.ts`. The whole story is on [bundles and workers](/projects/reader/engineering/bundles-and-workers/).

`lint:deps` needs `tsconfig.depcruise.json` to resolve `$lib` and `$workers`. An alias added through `kit.alias` has to go there too, or `no-unresolvable` fails and prints the file name.

Some rules sit outside any tool, so a review has to catch them:

- No cast to silence the type checker. `as ArrayBuffer` and `as BlobPart` are the usual temptations, and both are forbidden in `src/lib`, `src/routes` and `src/workers`. The fix is an annotation, like `Uint8Array<ArrayBuffer>` (see [TypeScript 5.9's `Uint8Array` change](/typescript/type-checking-techniques/#uint8array-does-not-fit-buffersource-since-typescript-59)).
- No `svelte-ignore` comments. A compiler warning gets fixed, not silenced.

## Two Vitest projects

The two projects in `vite.config.ts` are split by filename, as in [a rune-holding view model is tested from a plain `.spec.ts`](/testing/vitest-projects/#a-rune-holding-view-model-is-tested-from-a-plain-spects-never-a-sveltespects). `unit` runs `src/**/*.spec.ts` in Node, and `browser` runs `src/**/*.svelte.spec.ts` under Playwright and Chromium.

Every rune-holding view model in the reader is tested from the unit project: `capture-view.svelte.ts` from `capture-view.spec.ts`, `engine-settings.svelte.ts` from `engine-settings.spec.ts`, and the same for `library-view`, `reader-view` and `storage-view`. The `.svelte.spec.ts` files mount components. When the old upload tile was deleted, its browser spec went with it, and the bug it guarded is now covered by the `chosen-files` and `drop-reading` unit tests.

## Hand-written container fakes

`Container` is the type of the composition root, the object that holds every use case, and `container.ts` both declares it and builds it. Four specs build a whole `Container` by hand: `viewing/ui/reader-view.spec.ts`, `recognition/ui/capture/capture-panel.spec.ts`, `recognition/ui/capture/capture-view.spec.ts` and `recognition/ui/capture/capture-view-parts.spec.ts`. Each spells out every member. The ones it doesn't use are stubbed as `() => Promise.reject(new Error('not used'))` or a shared `unused()`. Other specs only need a few members and cast a partial object instead (`{} as Container`, or `as unknown as Container`). Dokseo forbids `as` casts in application code, but a test fixture may assert its own type.

So adding one member to `Container.recognition` is a five-file change: `container.ts` and the four whole fakes. The partial casts don't notice. That's [the fake problem](/testing/fakes-and-async/#widening-a-composition-root-type-breaks-every-hand-written-fake-and-only-the-type-check-reports-it) as it hit me: a tag use case added to the container looked green under a targeted `vitest --run`, and `npm run test` passes too, because nothing at runtime reads a missing key. `deno task verify` failed at its first step, the type check, with "is missing the following properties from type". I keep the whole fakes anyway and pay the five files. With a partial cast, a spec that calls a member nobody wired gets `undefined` at runtime instead of a type error.

## Testing around svelte-query

Dokseo reads and writes its data through svelte-query (`@tanstack/svelte-query` 6). Two small adapters wrap it. `readQuery` (`shared/read-query.svelte.ts`) starts a query and turns its result into a `ReadState`, and data components call it. `writeQuery` (`shared/write-query.svelte.ts`) wraps a mutation in a `WriteQuery` with a `state`, `submit`, `run` and `reset`, and write view models call it. How the pieces fit is on [data components and view models](/projects/dokseo/architecture/data-components-and-view-models/).

Neither adapter runs in the unit project. That project runs in Node, so it compiles every `.svelte.ts` for the server, and the server build drops effects (`$effect.root(fn)` compiles to a function that does nothing). svelte-query subscribes a mutation inside an effect, so a server-compiled `writeQuery` stays `idle` after `submit`. The mechanics are on [testing svelte-query code with Vitest](/testing/svelte-query-specs/). So I test one layer down:

- **The state mapping.** `read-state.spec.ts` and `write-state.spec.ts` build svelte-query's plain observer classes, `QueryObserver` and `MutationObserver`, on a test client and check what `readStateOf` and `writeStateOf` make of each result. The test client is `createTestQueryClient()` in `shared/testing/query-client.ts`, with `retry: false` and `gcTime: 0`.
- **The query factories.** Each domain's `queries/` module has a spec that runs the factories on a test client with a plain object for the use cases. A read goes through `observedRead(client, options)` (`shared/testing/observed-read.ts`), which subscribes a `QueryObserver`, the class `createQuery` wraps, and resolves with `readStateOf` of the first settled result. So the spec checks the state a data component would draw: an expected outcome, such as `not-found`, is `ready` with that answer as its value, and a throw is `failed` with its message (`library-queries.spec.ts`). A write goes through a `MutationObserver`, and its spec checks that a refusal resolves as data and that a throw rejects.
- **The flatteners.** The pure functions that turn a `ReadState` into a component's own union, like `bookReadOf`, get ordinary unit specs.
- **A screen's markup.** A unit spec renders a screen with `svelte/server` after mocking `readQuery`, because svelte-query keeps its client under a private key that a server render can't supply. `storage-screen.spec.ts` mocks it to answer `loading`. `engine-settings-screen.spec.ts`, whose screen holds several reads, answers by query key from a map it fills before each render.
- **A route in the browser.** A browser spec that mounts a route that reads queries renders it inside `shared/testing/WithQueryClient.svelte`, which wraps it in a `QueryClientProvider` with a test client.

A write view model calls `writeQuery` in its constructor. Outside a component, that call throws `lifecycle_outside_component`, because svelte-query looks up its client in Svelte's context. So a spec that builds one replaces the module with `vi.mock('$lib/shared/write-query.svelte', ...)` and one of three stand-ins from `shared/testing/`:

- `idle-write-query` reports `idle`, ignores `submit`, and returns a `run` promise that never settles. It suits a spec that never needs a write to settle (`read-session.spec.ts`, `manage-tags.spec.ts`).
- `unrun-write-query` rejects every `run` and records its variables in `askedWrites`. A method that awaits its write would hang on the idle stand-in. With this one, the method's own `.catch` absorbs the rejection, the method returns, and the spec checks which write it would have made (`capture-view.spec.ts`).
- `running-write-query` builds a real `MutationObserver` on a test client, so `run` calls the factory's mutation function and the owner's `onMutate`, `onSuccess`, `onError` and `onSettled`. It suits a spec whose subject is the logic that computes what to write, seen through the fake use case: which reading place `ReaderView` saves, or that `FlowView` saves a place still waiting when you leave the book (`reader-view.spec.ts`, `flow-view.spec.ts`). TanStack awaits `onMutate` before it calls the mutation function, so the use case runs a few microtasks after `run`, and these specs let the microtasks run (`await vi.advanceTimersByTimeAsync(0)` under fake timers) before they assert.

Invalidations are counted with a spy, not read back from the cache. Invalidating a key that nothing observes only marks the query as invalidated and fetches nothing, and a query that's already marked isn't marked again, so the cache can't show a second refresh. `capture-cache.spec.ts` spies `client.invalidateQueries` and compares the query keys of its calls.

The first browser run after a route started importing svelte-query failed with Svelte's `effect_orphan`. That was the run in which Vite's dependency optimizer discovered the new package, and `QueryClientProvider` ran on a different copy of the Svelte runtime from the components. The second run, with the same files, passed. So I run a browser spec a second time before chasing that error.

Some of it stays untested: the few lines of rune glue in each adapter, a data component's `{#if}` chain, and each write owner's `onSuccess`, `onError` and `onSettled`. A wrong key in an `onSettled` would pass `deno task verify:tests`. I accept that rather than write the production code around the tests.

## Specs that show a technique

| Spec | What it does | General page |
| --- | --- | --- |
| `src/lib/components/button.spec.ts` | renders `Button` with `svelte/server`'s `render` in the unit project and asserts on the HTML | [rendering a component in a unit test](/testing/vitest-projects/#rendering-a-component-in-a-unit-test) |
| `engine-settings-screen.spec.ts` | matches each `<input>` first, then tests its attributes one by one, since a raw input and the same input through `Radio` print attributes in a different order | [attribute order](/testing/vitest-projects/#a-server-render-spec-that-matches-attribute-order-breaks-on-a-refactor) |
| `learned-gestures.spec.ts` | imports its `.svelte.ts` module once in a `beforeAll`: the first test used to take 219 ms and the rest 3 to 8 ms, and under a loaded run the first passed the 5 s timeout | [compile inside a test's timeout](/testing/vitest-projects/#a-specs-first-dynamic-import-of-a-sveltets-compiles-inside-a-tests-timeout) |
| `src/routes/settings/settings-page.svelte.spec.ts` | mounts a route by mocking `$lib/context`, inside `WithQueryClient` because the route reads queries; the toaster goes in through `context: new Map([[TOASTER, createToaster()]])` | [mocking the context module](/testing/vitest-projects/#a-browser-spec-mounts-a-route-by-mocking-the-context-module) |
| `page-placements.spec.ts` | stubs `HTMLImageElement` with `vi.stubGlobal` so an `instanceof` check runs in Node; the adapter specs do the same for `OffscreenCanvas` | [stubbing the constructor](/testing/fakes-and-async/#a-unit-spec-reaches-an-instanceof-dom-check-by-stubbing-the-constructor) |
| the flowing reader's browser specs | 18 of them failed until they imported `$lib/styles/index.css`, because a component built only from library classes has no layout without it | [the design-system stylesheet](/testing/vitest-projects/#browser-specs-need-the-design-system-stylesheet) |

## Guard specs

Some specs don't test behavior. They guard a rule:

- **Design system:** `design-system.spec.ts`, `markup-classes.spec.ts`, `source-styling.spec.ts`, the unused-icon spec and the spec that fails on a new grid without a column declaration. They're on [structure and guards](/projects/reader/design-system/structure-and-guards/).
- **pdf.js builds:** `pdf-build.spec.ts`, `pdf-build-entries.spec.ts` and `pdf-page-source.spec.ts`, on [browser support](/projects/reader/engineering/browser-support/).
- **Architecture:** `lint:deps`, on [the dependency-cruiser rules](/projects/reader/architecture/dependency-rules/).

## A full run under load

With the dev server and other browser work running, a parallel `deno task test` of both projects timed out specs in files I hadn't touched (`pdf-build-entries.spec.ts`, `learned-gestures.spec.ts`, `flow-surface.svelte.spec.ts`), and didn't finish in 300 s. At the same time `deno task test:ci` passed (292 files), and the browser project with `--no-file-parallelism` passed all 9 of its files in 41 s. Later, with the machine quiet, the same full run passed 301 files in 25 s.

Wrapping the run in `timeout` didn't clean up. GNU `timeout` signals the whole process group, but a process can survive `TERM`, and Playwright's browser is launched detached, outside that group ([details](/testing/vitest-projects/#a-full-test-run-can-time-out-under-load-while-every-file-passes-alone)). I use `timeout -k 5` and check `ps` for `vitest` and `chrome-headless-shell` afterwards.

## Probes

Some things only show up in a real browser on a real screen. For those I write a throwaway Playwright probe. The techniques are on the general pages; this is what I used them for in the reader.

- **A phone's slow decode, on a desktop.** A desktop Chromium loads a strip slice in about 10 ms, so an unthrottled probe of the [continuous strip](/projects/reader/image-reader/continuous-strip/) shows no problem at all. `Input.synthesizeScrollGesture` with `gestureSourceType: 'touch'` and `preventFling: false` gives a real compositor fling, and `Emulation.setCPUThrottlingRate` at 6× and 10× slows the archive read and image decode without slowing the fling. Chromium only slows a fling on a `scrollTop` write, where WebKit stops it, so I count the writes rather than judge the distance (see [scroll writes](/scrolling/scroll-writes/#assigning-scrolltop-during-a-fling-kills-the-fling)).
- **Touch swipes in WebKit.** The paged viewer's page slide is driven with synthetic pointer events, the way [driving a touch swipe in Playwright WebKit](/testing/browser-probes/#driving-a-touch-swipe-in-playwright-webkit) describes. The library only stored an upload under `webkit.launchPersistentContext`.
- **The "Opening the book…" curtain.** A book opens from OPFS in a few milliseconds, so the probe [stalls `getFile`](/testing/browser-probes/#holding-a-loading-state-on-screen-by-stalling-a-read) on a `window` flag. That works because both readers read the book on the main thread. For a failed book, the probe overwrites the stored `.src` blob in `blobs/`. Deleting it instead makes the image reader redirect to the library as a missing book.
- **"Reading your library…".** That line lasts one IndexedDB open. The probe wraps `IDBFactory.prototype.open` and catches the handler because `openDatabase` in `platform/idb/connection.ts` sets `request.onsuccess`.
- **Class renames.** I proved each [rename rendered identically](/testing/css-refactor-checks/#proving-a-class-rename-renders-identically) with computed-style snapshots. The playground's section headers print class names, so I overwrote those labels (and mapped new names back to old in captions and tile labels) before measuring. The states I drove: an open menu, the window dropzone through a `dragenter` holding a file, a marquee held mid-drag, and a `hasTouch` and `isMobile` context for the `(pointer: coarse)` rules.
- **Restyled parts.** When `.segmented-item` replaced `.segmented-track > button.tag`, I [put the old rules back beside the new ones](/testing/css-refactor-checks/#comparing-a-restyled-part-with-the-rules-it-replaces-on-one-page) and compared each pair in every state and both schemes.
- **Token noise.** New tokens and new `--_*` inputs are left out of a comparison by name ([why](/testing/css-refactor-checks/#a-new-token-shows-on-every-element-of-a-computed-style-comparison)). Registering `--border-width` changed nothing in the dump, since its value was already a plain length. Hover and press states are forced with `CSS.forcePseudoState`, with the component's `transition` turned off first.
- **Unresolved tokens.** The probe reads every name declared in `src/lib/styles/tokens/*.css` after setting `data-theme` and `data-color-scheme`, and an empty string marks a broken token ([how](/testing/css-refactor-checks/#catching-an-unresolved-token-in-a-browser-probe)). One run covered nine screens, six themes, both schemes and two widths.
