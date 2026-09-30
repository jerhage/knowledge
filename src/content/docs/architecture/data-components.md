---
title: "Data Components: One Owner per Read and per Write"
description: Why a screen's boundary state and its UI state belong in different places, what a data component passes its children, who owns a write, and what a view model still holds.
tags: [architecture, components, ui-patterns, error-handling]
sidebar:
  order: 8
---

A screen that shows stored data has to get that data first, and getting it takes time and can fail. So something has to own the waiting, the failure, the retry, the cancellation and the paging. The same screen also has state that has nothing to do with storage: the sort order, the search text, which sheet is open. Where each kind of state lives determines how much every screen has to repeat.

My answer splits them. A **data component** is a component whose whole job is one read or one write. It runs the request, draws the waiting and failure states itself, and passes its children only the resolved data. The children arrive as a function the data component calls, which is [a render prop in React](/react/render-props-and-tanstack-query/#a-render-prop-is-the-react-slot), a [snippet in Svelte](/svelte/data-components/) and a slot elsewhere. A data component that owns a read is a **read data component**, and one that owns a write is a **write data component**. A **view model** holds the rest: UI state, and sometimes a write with several steps, but never a read.

The examples use the [card catalog](/architecture/overview/#the-running-example) and plain TypeScript. `View` stands for whatever the UI framework draws.

## One view model holding two kinds of state

A common way to start is one view model per screen: a class the route builds, loads when the screen mounts, and passes whole to the screen. For the card list it might look like this:

```ts
class CardListView {
  cards: readonly Card[] | null = null;
  failure: string | null = null;
  sort: SortOrder = "newest";
  #generation = 0;

  async load(): Promise<void> {
    const generation = ++this.#generation;
    const listed = await this.#useCases.listCards();
    if (generation !== this.#generation) return;
    // set cards or failure from listed
  }

  async remove(id: CardId): Promise<void> {
    // call the use case, then this.load() again
  }
}
```

The class holds two kinds of state. **Boundary state** is everything about talking to storage: each read and its lifecycle (loading, failed, ready, a stale answer to ignore, a reload) and each write with its busy and failed states. **UI state** is everything else: the sort order, the search text, which sheet is open, a cursor.

Putting both in one class has costs. The class has too many jobs. The two kinds of state need different handling: boundary state is asynchronous, can go stale and benefits from a cache, while UI state is synchronous and local. And the screen receives the whole object, so it branches on `failure !== null` and `cards === null` itself, and every screen writes those branches slightly differently. The generation counter, there so that a slow earlier `load` can't overwrite a later one, is written again in every view model that reads.

So the boundary state moves out, into data components, and the view model keeps what's left.

## A data component owns one read

Say the card list screen needs the list of cards. A read data component, `cardListData`, owns that one query. Every query in the app has exactly one owner like it.

The query's lifecycle is a readonly discriminated union, and the data component draws the exhaustive match over it:

```ts
type CardListState =
  | { readonly type: "loading" }
  | { readonly type: "failed"; readonly error: unknown }
  | { readonly type: "success"; readonly cards: readonly Card[] };

interface CardListContent {
  readonly cards: readonly Card[];
  reload(): void;
}

function cardListData(
  state: CardListState,
  reload: () => void,
  children: (content: CardListContent) => View,
): View {
  switch (state.type) {
    case "loading":
      return loadingView();
    case "failed":
      return errorView({ onRetry: reload });
    case "success":
      return children({ cards: state.cards, reload });
  }
}
```

Only the success branch calls `children`, and it passes resolved data and named callbacks. In both of my apps the state comes from a query cache (TanStack Query), so the loading, the stale-answer guard and the reload are the library's job, and the data component only maps its result and draws.

## The children run only for the resolved branch

The card list below `cardListData` receives `cards: readonly Card[]` and nothing else about the query. It never receives the lifecycle union, a loading flag, an error value or a retry function.

That's deliberate. A child that receives any of those has to branch on them, so it becomes an async orchestrator: it has to contain the code for what to draw while loading, what to draw on failure, and when to retry. If every screen does that, every screen reimplements the same four states slightly differently. With the branching in the data component, the card list can be written and tested as if the data always exists, because for that component it always does.

## Nested lifecycles stay nested

Now say the card list pages: it loads the first page, and scrolling to the end loads more. Loading more is a second lifecycle inside the first one.

That second lifecycle belongs inside the success variant:

```ts
type PagingState =
  | { readonly type: "idle" }
  | { readonly type: "loadingMore" }
  | { readonly type: "failed"; readonly message: string };

type PagedCardListState =
  | { readonly type: "loading" }
  | { readonly type: "failed"; readonly error: unknown }
  | {
      readonly type: "success";
      readonly cards: readonly Card[];
      readonly hasMore: boolean;
      readonly paging: PagingState;
    };
```

"Loading more" can't coexist with "nothing loaded yet", and this type makes the combination impossible to write. A `loadingMore` flag beside the top-level union would allow it. A write in progress follows the same pattern, on whichever part owns the write.

## It holds the boundary's state and nothing else

A data component's state is what is loading, what failed, what resolved and how much has been paged. Everything else on the screen is UI state: which card is selected, whether a filter sheet is open, what someone typed into the search field, which step of a workflow is showing.

UI state belongs to the component that draws it, or to a view model when several components need it or it has real logic (a hook in React, a class in Svelte). The data component may take that state as input to build its query. The search text, for example, goes into the card query's criteria. But it never owns that state. If it did, the text field would have to reach up into the component that runs the query to read what it contains.

## A data component that only draws is a half-step

Moving from one view model per screen to data components, there's an in-between version that looks like the pattern. The route still builds the view model and calls `load()`, and the view model still holds the read. A new component takes the view model's read state as a prop and draws the match over it, so the screen below gets only the value.

It's an improvement over branching in the screen: the read now has one union instead of nullable fields, and the screen no longer checks them. But the read still lives in a view model. The loading, the generation counter and the reload are still written by hand in each view model, the route still has to drive them, and each of those has specs of its own. The data component draws a lifecycle someone else runs.

The step that pays is moving the read itself into the data component, through the query cache. Then the view model's read, its generation counter, its `load`, `dispose` and `reload`, and their specs all go away, because the cache does that work once for every read.

## Every request gets a cancellation signal

Say someone types "fire" into the card search. Each keystroke changes the criteria, so the data component starts a new read for "f", "fi", "fir" and "fire". If the read for "fir" is slower than the read for "fire", it resolves last and its results replace the right ones. The list then shows results for a query nobody is looking at.

So every async request a read data component starts gets an `AbortSignal`. The data component creates an `AbortController` for each request, aborts it during cleanup and before it starts a request that supersedes it, and ignores an aborted outcome instead of drawing it as a failure.

For the signal to reach the store, read ports take a shared read-options type that holds it:

```ts
interface ReadOptions {
  readonly signal?: AbortSignal;
}

interface CardLister {
  getPage(criteria?: CardListCriteria, options?: ReadOptions): Promise<Page<Card>>;
}
```

An adapter over a local database can check the signal between steps today. An adapter over a network can pass it to real transport cancellation later, and nothing above the port changes.

With TanStack Query the library supplies the signal; see [TanStack Query calls the query function with an AbortSignal](/react/render-props-and-tanstack-query/#tanstack-query-calls-the-query-function-with-an-abortsignal-pass-it-to-the-port).

## A write boundary passes down a described action

A write has an owner too, the same way a read does. The owner holds the submission, the in-flight state, the outcomes the use case returns, the announcement to a screen reader, and the cached reads it has to invalidate. With a query cache, the write is a mutation. The options factory in the domain's queries module holds only the `mutationFn`, which calls the use case. The owner adds the callbacks that depend on where the write is used: `onMutate` for an optimistic cache edit, `onSuccess` and `onError` for notices, `onSettled` for invalidation.

Which part owns it depends on the framework. In React it's a write data component that reaches its caller through children it calls. In Svelte it's a write view model, a class whose getters reach markup directly, so a separate write component would add a layer and nothing else.

Either way, what reaches the control is a **described action**: the control's label, whether it's busy, whether it can be pressed, the message to show beside it, and the function to call on press.

```ts
interface SaveCardAction {
  readonly label: string;
  readonly availability: "busy" | "ready";
  readonly message: string | null;
  save(): void;
}
```

Availability is one value rather than a `busy` boolean and an `enabled` boolean. Two booleans allow four combinations, and one of them, busy and enabled at once, means nothing: a control that shows a save in flight and still accepts a press. With one value, that combination can't be written, and the control derives both its busy indicator and its disabled state from it. Riftcards made the same change; see [data components in riftcards](/projects/riftcards/presentation/data-components/#why-the-save-boundary-draws-nothing).

The described action isn't the write's lifecycle union, and the same prohibition applies as for a read: a presentational child never receives a write state, only values derived from it. When the owner and the presentation both need the same derivation (the label for each state, say), it lives in a format module both may import. Then neither side imports the other.

## A boundary draws in place of its children only when it has nothing to pass them

The read data component above draws a spinner instead of its children. A write data component, as I'll show, draws its children and nothing else. That looks like two rules, one for reads and one for writes. It's one rule, and the difference follows from it: **a data component draws in place of its children only when it can't produce what they need.**

A read holds no data while it's pending or failed. It can't call `children(data)`, so it draws the other arms of its match.

A write can always call `children(controls)`. Its states (idle, saving, failed, refused) decorate a control the caller already draws, and they never stop the screen from existing. So a write data component returns its children and nothing else.

Stating it as "reads draw their states, writes draw their children" gives the same answer for the common cases and the wrong one in two others:

- **A read the screen can do without should draw its children too.** Say the card list shows a note count on each card. The list is drawable without the counts. If the counts' data component draws a spinner while they load, someone opens the card list and sees a spinner in place of every card, only because a badge isn't ready. The data component should pass down a described value (no counts yet) and let the list draw.
- **A write that gates the screen should match and draw.** A migration on first run owns the screen: until it finishes there is nothing for the children to be about, so it draws its own states like a read does.

A data component that only forwards to another one isn't an exception either. If it returns its children directly because the one it delegates to owns the match, the rule still holds.

In riftcards the save's data component is the case that made this visible; its history is in [why the save boundary draws nothing](/projects/riftcards/presentation/data-components/#why-the-save-boundary-draws-nothing).

## Unsaved items are an overlay; an optimistic write puts back only what it took

Some items exist on screen before the store has them. Say someone adds a note to a card. The note should appear in the list right away, marked as saving, and stay there marked as failed if the save fails, so they can retry. None of that is in the query's data, because the query holds what the store returned.

So unsaved items live in a small view model of their own, as an overlay. A pure function lays the overlay after the query's rows and hides any overlay item whose row has since landed in the query. When a save succeeds, the owner puts the saved row into the cache with `setQueryData` and removes it from the overlay in the same tick. With TanStack Query that works because a cache write reaches the read state synchronously (see [a query notifies its observers synchronously](/svelte/svelte-query/#a-query-notifies-its-observers-synchronously-so-a-cache-write-shows-in-the-same-tick)), so there's no frame where the note is in neither list and the row isn't rebuilt.

A removal is the other direction: an optimistic write takes the row out of the cache before the store has finished. The owner cancels the read in flight (otherwise its older answer would put the row back), then drops or edits the rows in `onMutate`. If the use case returns a refusal, the owner puts them back in `onSuccess`, because a refusal is a resolved answer; if it throws, in `onError`. `onSettled` invalidates the list in every case.

What it puts back matters. TanStack's own example takes a snapshot of the whole list in `onMutate` and restores it on failure. That's wrong as soon as two writes overlap: if someone removes one card and renames another while the removal runs, and the removal then fails, the snapshot brings back the card and undoes the rename too. So the put-back restores only what the failed write took out, and the invalidation in `onSettled` brings the cache back to what the store holds, whatever order the writes finished in. The same rule from the undo side is on [a put-back restores only the row the write took](/ui-patterns/saving-and-undo/#a-put-back-restores-only-the-row-the-write-took).

## Use case, data component, presentation: who owns what

Several pieces of code are involved in showing and changing data, and each owns one thing:

```text
data component  ──reads──►  queries module  ──calls──►  use case  ──orchestrates──►  domain + ports
      │
      ▼ resolved data and named callbacks
presentation
```

- **The domain** defines what's valid: a copy limit, a naming rule, an invariant. A use case doesn't restate a rule the domain owns.
- **A use case** runs one application operation (see [one operation per file](/architecture/dependency-injection/#use-cases-has-one-operation-per-file)). It loads what it needs, calls the domain, persists, and returns a meaningful result. It never owns UI execution state: no `idle`, no `loading`, no `refreshing`. A use case runs and then has a result. Loading is something the UI shows.
- **The queries module** of each domain holds the key factory and the option factories. A query factory names the key, calls the use case and sets the stale time; a mutation factory holds only the `mutationFn`. Its parameter is the use cases or ports it needs, so it stays a plain function.
- **Two shared adapters**, one for reads and one for writes, turn the query library's result into the app's own unions, so no library type reaches a screen. They live in the kernel because every domain uses them.
- **A data component** owns the execution lifecycle: loading, paging, the abort signal, the retry, through the query cache. It calls a use case through a query factory, never a port.
- **Presentation** reads its props and reports what someone did through callbacks. It has no dependency on which store holds the card, which use case loaded it, or how caching works.

Where the dependencies come from differs between my two apps. In Rifty, a route takes ports from context and passes them to the data component as props, and the query factory builds the object the use case takes. In Dokseo, the composition root binds every use case to its ports, and a route passes a domain's group of use cases instead, so no UI code can reach a port. The two are compared in a table on [the container exposes use cases](/architecture/dependency-injection/#the-container-exposes-use-cases-never-a-port).

Business failure and execution state are different things, and this split keeps them apart. `notFound` or `nameTaken` describes the operation's meaning, so it comes from the use case. `loading` and `refreshing` describe the UI, so they belong to the data component. The data component's own union may combine both, as peers: `loading`, `failed`, and the use case's variants side by side. How a use case's result reaches the data component without a failure inside a success is in [resolve with an answer, reject only when there is none](/architecture/expected-and-unexpected-failure/#resolve-with-an-answer-reject-only-when-there-is-none).

## A view model holds UI state, a write with steps, or a live resource, never a read

With reads in data components, a view model keeps three kinds of job:

- **UI state with real logic**: a sort order, a search, a cursor, a picker. A single toggle with no logic stays local state in the component.
- **A write with several steps**, where one step waits for the answer of another, or a write whose busy and failed states several controls show.
- **A live resource the cache must not hold**: an open file handle, a worker session, an operation still running.

It never holds a read, a generation counter for a read, or a `reload()`, and it never reads the query cache itself. Sometimes one of its commands needs a cached value at the moment it runs: the current card list, to work out the next card to open, or the stored display settings, to open a document. That value comes from a data component above the view model, in one of two ways:

My reader uses view models; see [the container and its view models](/projects/reader/architecture/wiring/#containerts-and-contextts). Riftcards uses data components; see [data components in riftcards](/projects/riftcards/presentation/data-components/).

## Hooks for mechanics, data components for side effects

In frameworks with hooks (or composables, or reusable state classes), the tempting move is to turn a data component into a hook that returns `{ data, isLoading, error }`. That moves the code without keeping what the data component was for. A hook at this boundary passes its lifecycle to its caller, and the caller becomes the async orchestrator the data component existed to prevent.

Here's how that goes wrong, from riftcards. A save was written as a hook that returned its state. The component that called the hook passed the state down to its child, and so on, until the state had traveled five components down into a leaf that matched `idle | saving | failed` to draw a button. Every component in between carried a lifecycle it had no use for.

Hooks are still right for local UI mechanics and shared behavior: the state of a filter sheet, a debounced value, the steps of a workflow. The deciding question is which part owns the side effect.

The React form is on [a hook at the query boundary passes its lifecycle to every caller](/react/render-props-and-tanstack-query/#a-hook-at-the-query-boundary-passes-its-lifecycle-to-every-caller).

## Testing each side

Each part gets the tests that fit what it owns:

- **Data components:** loading, success, failure, retry and paging.
- **The read and write mappings and the flatteners:** pure functions over plain objects.
- **Query factories:** read through a test query client the way a data component reads them, with fake use cases, so the spec checks the same `loading`, `failed` or `ready` state the screen draws.
- **View models:** their UI state and their commands, with fake effects.
- **Presentation:** its props and the callbacks it fires.
- **Use cases:** a fixed clock and a predictable id generator, so results are deterministic.
- **Adapters and mappers:** a real in-memory store with scenario data.

None of these needs the others. A presentation test never sets up a failing request, because presentation never receives one.

In React, a data component renders in a test inside a wrapper with a fresh query client, so the whole chain runs. Svelte is different: a Vitest project in a Node environment compiles Svelte for the server, where effects never run, so the read and write adapters and the data components don't run in a unit test at all. There I test one layer down (the mappings, the factories, the flatteners and the view models) rather than change the architecture to make the rest testable. The details are on [testing svelte-query code with Vitest](/testing/svelte-query-specs/).

## Growing the contract

What a read data component passes down is its contract: resolved data, a paging state nested on the success variant, and named callbacks for load-more, refresh and retry.

That contract will grow. A remote source brings freshness, optimistic writes bring a pending state, sync brings conflicts, an offline queue brings deferred writes. Each of those changes one type, the data component's contract, and the change is reviewed as such. The alternative is a new prop threaded through every screen that needs it, and then a `syncing` boolean ends up in components that should never have depended on sync. Where each of those additions would plug in is on [where a server, sync and sign-in would plug in](/architecture/extension-points/).
