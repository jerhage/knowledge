---
title: Expected and Unexpected Failure
description: Sorting every failure into one a caller handles and one that throws, a named result union or a generic Result, validating where data arrives, and which async channel a failure travels on.
tags: [architecture, error-handling, typescript]
sidebar:
  order: 9
---

Code that loads a card, saves a note or parses a stored row can fail, and each failure has to reach code that can handle it. TypeScript doesn't help much here. It doesn't put throws in a signature, so `function getCard(): Card` may really behave as "returns a `Card` or throws anything". The compiler doesn't track the throw, so nothing makes a caller handle it.

For each failure, I decide whether it goes in a return type or throws, and where it ends up. The examples use the [card catalog](/architecture/overview/#the-running-example).

## Classify every failure first

Before writing any handling, I sort each failure into one of two kinds.

**Expected**: a caller can receive it during normal operation and has to handle it. Invalid input, a name that's already taken, a card that doesn't exist, a rejected sign-in, a broken business rule, a conflict, a resource that's unavailable, an operation with several legitimate outcomes. Not found is the plainest case: if "there's no such card" is a normal result, throwing it is wrong.

**Unexpected**: something the code relies on has been violated, and normal application code can't meaningfully recover. An impossible state, a broken internal invariant, a malformed response from a trusted contract, corrupted data, a programmer error, a failed assertion, an infrastructure or library failure nobody planned for.

The test is one question: can the caller do something meaningful with this? If yes, it's expected. If no, it's unexpected. What I want is for a thrown exception to keep its meaning of "something I didn't plan for".

## An expected failure is a named variant of the return type

An expected failure goes in the return type, named for what it means. Adding a card whose name is taken returns a `nameTaken` variant, not an `error` with a message. The caller then matches on the result, and an exhaustive match (see [closed unions](/typescript/closed-unions/#a-closed-set-is-a-readonly-discriminated-union)) fails to compile until every variant is handled. That's the point: a new failure variant can't go unhandled in a caller.

Not every absence needs a variant. A port can return `Promise<Card | null>`, because at a port, absence is a single fact. The use case above it is where that fact becomes a named variant among the operation's other outcomes (more on that in [narrow capabilities](/architecture/capabilities/#absence-at-a-port-is-a-fact-at-a-use-case-it-is-a-variant)).

Once a failure is in the return type, that type can be a generic `Result` or a named union per use case.

### A generic `Result`, or a named union per use case

**A generic `Result<T, E>`** is one type in the kernel, discriminated by an `ok` flag. Every use case returns `Result<Card, CardError>` or similar:

```ts
async function archiveCard(deps: ArchiveCardDeps, id: CardId): Promise<Result<Card, CardError>> {
  const found = await deps.cards.get(id);
  if (!found.ok) return found;

  return deps.cards.update(id, { archivedAt: deps.now() });
}
```

The strength is uniformity. Every operation has the same return type, and passing a callee's failure up is one line, `if (!found.ok) return found;`. The cost is two levels: a caller checks `ok`, then matches on the error's kind, and the success is always called `value`, whatever it holds.

**A named union per use case** gives each operation its own result type, with success and each failure as peers:

```ts
type AddCardResult =
  | { readonly kind: "success"; readonly card: Card }
  | { readonly kind: "nameMissing" }
  | { readonly kind: "nameTaken" };
```

The strength is that the type reads as the operation's full set of outcomes: one match lists every outcome once, and the success variant names what it holds. The cost is a type per use case, since two use cases' unions aren't the same type.

Passing a callee's outcome up is still one line. Say archiving a card first loads it through the card repository's `get`, and `get` has a variant for a store that's unavailable, for example because the browser blocks storage in a private window. A missing card isn't a variant of its own: `get` returns `null` inside its success. `archiveCard` names that absence `notFound`, and returns the unavailable variant unchanged. The repository's `update` answers with the updated card or the same unavailable variant, and since both fit `ArchiveCardResult`, its answer goes out as it is:

My reader uses a generic `Result` (see [a use case in the reader](/projects/reader/architecture/wiring/#a-use-case)). Riftcards uses a named union per use case and bans the generic one (see [use cases, results and failure in riftcards](/projects/riftcards/architecture/use-cases-and-failure/)).

## An unexpected failure throws to a boundary

An unexpected failure throws, and throwing is right. An assertion that guards an impossible state stays an assertion: turning it into a result variant makes every caller include handling for something that can't happen.

Say the card store guarantees that every card has an image row, and one day a card comes back without one. No caller of `getCard` can fix that. So the adapter throws, and the error travels up to an error boundary: an outer place that logs it and reports an unexpected failure.

An app has a few of these. Startup is one: the code that opens the store and builds the composition root catches a failure once, logs it, and draws a failure screen. A [read data component](/architecture/data-components/) is another, for one query: its `failed` state is the boundary for that read.

In an app whose reads and writes go through a query cache like TanStack Query, every kind of failure has a place it ends up:

| Failure | Where it ends up |
| --- | --- |
| An expected outcome of a read | the read resolves, and the data component's flattened union names the outcome |
| An unexpected failure of a read | the query rejects, and the data component's `failed` branch shows it and logs it |
| An expected outcome of a write | the write resolves, and whatever owns the write shows the outcome |
| An unexpected failure of a write | the mutation rejects, and its `onError` shows a notice |
| A throw while rendering | an error boundary around the root layout's content logs it and shows a failure screen with a "Try again" button |
| A stray throw or rejection, from a promise nothing awaits | window listeners for `error` and `unhandledrejection` log it and show one notice |
| A failed navigation | the framework's client-side error hook logs it |
| One item in a list that can fail on its own, like one download among several | the item's own failed state, with a retry |

The last row is still a boundary, not a catch-all: the failure belongs to that one item, and the rest of the list keeps working.

One function, `logUnexpected(site, error)`, does all the logging, so every boundary records the stack and a name for where it caught the failure. A boundary is the only place that catches without translating. One overlap is left: if the code that turns a read's failure into text logs the error and another boundary sees the same failure, it's logged twice. I either accept that or log in one place only. The Svelte and SvelteKit pieces for each row are in [error boundaries in SvelteKit](/architecture/sveltekit/#error-boundaries-in-sveltekit).

## A throwing library is part of its boundary

Libraries throw: a database driver on a constraint violation, a schema library on invalid data, an HTTP client on a network error. The reflex is to wrap every such call in `try/catch`. Don't. Decide first whether the failure is an expected outcome or a violated contract.

If it's expected, convert it into the app's own variant at the boundary where the library is called. A unique-name constraint that fires on insert becomes `nameTaken`. If it's unexpected, let it travel.

Either way, domain and use-case code never has to import or handle a schema library's error type, a driver exception or an HTTP error. Those stay in the adapter that called the library.

## Classifying an HTTP response without listing every code

Say the card catalog starts reading its cards from a server. Every response comes back with an HTTP status code, and HTTP defines dozens of them. Running [the classification above](#classify-every-failure-first) on each code, for every operation, isn't practical, and a server can always send a code nobody listed.

So I use one default for every code, plus a short list of expected codes for each operation.

**The default.** Any response that isn't OK (a status outside 200 to 299), and any network error, is unexpected. The adapter throws, the promise rejects, the read data component's `failed` state shows the failure, and the logs record it. A code I never thought about, or one the server starts sending next year, fails safely and visibly instead of being mistaken for an answer.

**The list.** Each operation lists only the codes it treats as expected, and those are exactly the codes that map to variants in its result union. That's usually zero, one or two. Loading a card by an id from the route lists 404: the adapter turns it into `null` at the port, and the use case turns `null` into `notFound`.

A code moves into an operation's list only when the UI has to do something specific with it. When that happens, the union gets a new variant, and the exhaustive match fails to compile until every caller handles it. A code with no specific handling stays on the default, where the `failed` state already shows it.

Which list a code belongs in depends on what it means for that endpoint, not on the number alone. A 404 for an id that came from the route is an answer: someone followed an old link, and no card has that id. A 404 for a card the code created a moment ago, or for an endpoint that doesn't exist, means the app and the server disagree about the contract, so it's unexpected.

In code, this starts with one shared helper in `platform/` that throws one error type for any non-OK response. `fetch` doesn't do that on its own: its promise [doesn't reject for an error status such as 404](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch), and it rejects with a `TypeError` on a network failure.

```ts
class HttpError extends Error {
  constructor(readonly status: number, readonly method: string, readonly url: string) {
    super(`${method} ${url} failed with ${status}`);
  }
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init); // a network failure rejects with a TypeError
  if (!response.ok) throw new HttpError(response.status, init.method ?? "GET", url);
  return response;
}
```

Then each adapter catches only its expected codes and rethrows the rest. That catch exists only to translate, the first reason in [catch only to add something](#catch-only-to-add-something):

```ts
async function getCard(id: CardId, options: ReadOptions): Promise<Card | null> {
  try {
    const response = await request(`${baseUrl}/cards/${id}`, { signal: options.signal });
    return parseCard(await response.json());
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}
```

And the whole app has one retry rule, by class of error rather than by a list of codes. A network error, a 5xx (the server failed), a 408 (the request timed out) and a 429 (too many requests) can succeed on a later try, so they're retried. Any other 4xx is never retried, because the same request gets the same answer.

```ts
function isTransient(error: unknown): boolean {
  if (!(error instanceof HttpError)) return error instanceof TypeError;
  return error.status >= 500 || error.status === 408 || error.status === 429;
}
```

`fetch` also rejects with a `TypeError` for an invalid URL or an invalid `RequestInit` value, so this rule retries those programmer errors too. I accept that: it costs a few wasted retries before the read reaches its `failed` state, and the error shows up on the first request in development anyway.

TanStack Query's [`retry` option](https://tanstack.com/query/latest/docs/framework/react/guides/query-retries) accepts a function of the failure count and the error, so the rule plugs in as `retry: (failureCount, error) => failureCount < 3 && isTransient(error)`. TanStack Query calls it only for a rejected query, which is one more reason an expected outcome resolves (see [an expected outcome resolves](/react/render-props-and-tanstack-query/#an-expected-outcome-resolves-because-tanstack-querys-retry-and-cache-act-on-rejections)).

Here are some common codes as examples. It isn't a full list, and the endpoint still determines what a code means:

| Response | Kind | Handling |
| --- | --- | --- |
| 404 for an id from the route or other input | expected | `notFound` |
| 404 for a resource the code just created, or for an endpoint that doesn't exist | unexpected | throws, shown by `failed` |
| 409, 422 | expected | a variant such as `nameTaken` or `invalid` |
| 401, 403 | expected | a variant such as `signInRequired` or `forbidden` |
| 500, or a network error | unexpected | throws, retried |
| 503 or 429 with `Retry-After` | unexpected by default | expected only if the UI has a specific state for it, such as "offline, showing cached data" (the "resource that's unavailable" case from the expected list above) |

So the rule is one helper, one retry rule, and a one- or two-code list per adapter. No code outside the adapters ever reads a status code.

## Validate where data arrives

A third rule sits beside the two kinds, and it isn't a choice between them: unvalidated external data never reaches trusted state or the store. External means anything the app didn't construct itself: a typed value, a pasted list, a route parameter, a file, a feed, an HTTP response.

Validate it at the boundary where it arrives, not where it's eventually used. Then trusted state only ever holds one kind of value, and no code downstream has to check it again.

A schema library usually offers a safe parse and a throwing parse, and the choice follows the classification above. (Zod calls them `parse` and `safeParse`; the idea isn't Zod's.)

- **The safe parse** returns success or failure as a value. Use it where invalid data is an expected outcome this layer handles. A form, or any other input a person types, is the archetype: an empty card name becomes `nameMissing`.
- **The throwing parse** throws on invalid data. Use it where invalid data means a contract or invariant is broken: a mapper that reads a stored row, or a function that asserts what the domain already guarantees. A row that fails is corrupt data, not a caller's outcome. There's no rule that a throwing parse must sit inside a `try/catch`.

The failure mode to watch for is a value that passes the type check without being validated. A branded `CardId` reached by a cast (`id as CardId`) type-checks, and it lets a bare string from a route parameter straight into trusted state. Reach a brand by parsing. For a route parameter, the parse lives in the kernel and returns `null` for a string that can't be an id:

```ts
function parsedCardId(raw: string): CardId | null {
  const flat = raw.length > 0 && !raw.includes("/") && !raw.includes("\\") && !raw.includes("..");
  return flat ? (raw as CardId) : null;
}
```

The cast inside is the one place a `CardId` gets minted. A route that gets `null` goes straight to the same path as a card that doesn't exist, so a malformed id never reaches the store. Any check the store adapter still makes on the id's format is then an assertion: a malformed id there is a programmer error, and it throws.

A stored value has the same problem in another form: a typed read names a type without checking it. A field that holds one of a fixed set of names, like a card's rarity, can come back holding a name the code no longer handles. I check each such field when the row loads and decide per field: fall back to a default where one is safe, or throw a named corrupt-row error where none is (see [a stored enum value is unknown until a load checks it](/storage/indexeddb/#a-stored-enum-value-is-unknown-until-a-load-checks-it)).

## Catch only to add something

A `catch` is worth writing when this layer can do something with the failure:

- translate it into an expected variant,
- add real context,
- clean up,
- recover on purpose,
- or report it, at a boundary.

Opening the card store is an example of adding context. It runs migrations and then seeds reference data. If either throws, the bare driver error doesn't say which step failed. So the code that opens the store catches each step's failure only to name the step, and rethrows with the original as its `cause`:

```ts
try {
  await migrate(database);
} catch (error) {
  throw new Error("Migrating the card store failed", { cause: error });
}
```

The `cause` has to be the error itself, not its message. `{ cause: String(error) }` keeps the text and loses the stack, and so does a rethrow with no `cause` at all. The same goes for a failure class of my own. Say a query's failure holds the text the screen shows, in a `QueryFailure` class. It's a plain `Error` subclass, so `new QueryFailure(message, { cause })` keeps the original on `.cause` while the message stays the text for the screen. Whatever logs the failure can still reach the original and its stack through `.cause`, and the screen reads only the message.

What never justifies a `catch` is catching and rethrowing with nothing added. It makes the code look careful and changes nothing.

## Resolve with an answer, reject only when there is none

A promise has two channels: it resolves or it rejects. A read data component gets both from every request it makes, and I have to decide which failures travel on which channel. The question to ask is **did the read produce an answer**, which is different from whether it succeeded.

"There's no card with this id" is an answer. So `notFound` resolves, beside `success`. The rejection channel means "no answer was produced", so only an unexpected failure rejects.

Putting `notFound` on the rejection channel breaks four things, because tools attach behavior to that channel:

- **Retries.** A retry policy attaches to rejections. `notFound` and `nameTaken` must never be retried, and a rejected `notFound` forces a predicate that recovers a classification the union already held.
- **Error boundaries.** A rule that routes rejections to an error screen would route a missing card there.
- **Caching.** A query cache keeps what resolved. A rejected read leaves nothing cached, so a stable fact (this id names no card) is fetched again every time the screen appears, and it's never fresh.
- **Transforms.** A projection, a placeholder or a seeded value applies to resolved data, and skips the rejection channel entirely.

How each of these plays out in TanStack Query is on [an expected outcome resolves](/react/render-props-and-tanstack-query/#an-expected-outcome-resolves-because-tanstack-querys-retry-and-cache-act-on-rejections).

This never licenses matching a failure inside a success branch. Flatten instead: the data component's union has `loading`, a variant for a read that couldn't complete, and the use case's own variants as peers, so `notFound` sits beside `loading` rather than nested under `success`. What that union looks like is in [who owns what](/architecture/data-components/#use-case-data-component-presentation-who-owns-what).

The same question settles what a port returns. Say the catalog shows each card's cover, and the read of a cover is cached until the next write (`staleTime: Infinity` in TanStack Query), because a cover rarely changes. A card with no cover is an answer. A store that broke while reading is not. If the port returns the same error for both and the read turns that error into "no cover", one transient failure is cached as "no cover" and the cover stays hidden until the next write. So the port returns `Blob | null`: `null` for a card that has no cover, and a throw when the store fails. The read resolves `null` and caches it, and a failure rejects, so nothing is cached and the next time the screen appears it reads again.

A write follows the same rule. A save that fails for an expected reason, like an unavailable store, resolves with a variant the editor can show, and a save that throws reaches the write's error handler. Either way the editor gets the storage outcome, which is what [keeping an editor open until the storage outcome is known](/ui-patterns/saving-and-undo/#keep-an-editor-open-until-the-storage-outcome-is-known) depends on. I decide this once for every write in the app: the function a write runs resolves the use case's union, and rejects only when something throws. Say one write instead rejects on every failure, its expected `notFound` included. Someone edits a card that another tab removed a moment ago. The write rejects, the screen shows an error, and the code that refreshes the list after a successful write never runs, so the removed card stays in the list. Two conventions in one app also mean every new write has to pick one, so I settle it before the first write.

An expected condition that can't change while the page is open is still an answer. Say the browser exposes no cache storage at all. That's expected, since the screen can explain it, and permanent. Shown as a failure with a "Try again" button, it offers a retry of something that can't change. It belongs in the union as a variant the screen explains.

## Prevent at one boundary, detect at the other

A rule about what data is allowed needs two enforcement points, not three.

In riftcards, a deck's chosen champion has to be a champion unit. The rule is enforced in two places:

- **Prevent**, where the choice is offered. The champion picker queries only champion units, so the screen can't offer anything else.
- **Detect**, in the domain, where data arrives from anywhere. The deck's legality check runs on a deck that was saved before the rule existed, or one imported from a file nobody filtered.

When the rule was added, a third check went in between the two: the function that set the champion returned "chosen" or "not a champion unit", and its only caller handled that outcome by returning the draft unchanged. No press could reach that branch, because the picker never offered a non-champion. It was a silent no-op on an impossible state, and it was deleted on 2026-09-13.

These tests catch that pattern:

1. **Is the failure expected?** An expected failure is one a person can cause and the screen must show. If no interaction can produce it, making it a union variant is a category error, and every caller then has code for something that can't happen.
2. **Does the check have a reachable branch?** If the honest answer needs a comment saying "this can't happen", delete the branch instead of explaining it.

What this doesn't relax: the domain rule stays even when the screen can't break it. A query filters what one screen offers. It says nothing about data the app didn't create. The riftcards version, with the rules themselves, is on [deck legality](/projects/riftcards/decks/legality/).
