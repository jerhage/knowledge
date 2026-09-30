---
title: Result Types, unwrap() and Typed Outcomes
description: "When a `Result<T, E>` fits, why unwrapping it into an exception loses its type safety, when a named union fits better, and where TanStack Query's states sit relative to an operation's outcome."
tags: [architecture, error-handling, typescript]
sidebar:
  order: 9.5
---

Say an app loads a user profile from a server with a function `findUser(id)`. The function sits at a boundary: on one side is HTTP, with status codes, response bodies and network failures; on the other side is application code that needs a user, or a clear signal that no user has that id. The boundary's job is to translate the protocol's behavior into outcomes the application can use.

Some of those outcomes are known in advance. A user with that id exists, or no user has it. Other failures aren't part of the plan: the network is down, the server crashes, the body isn't what the contract promised. The first group are values, and the second group are exceptions. How I sort failures into those two kinds is on [expected and unexpected failure](/architecture/expected-and-unexpected-failure/#classify-every-failure-first). The known outcomes need types to hold them, and one pattern, `unwrap()`, undoes those types.

## Known outcomes are values, unexpected failures throw

Every operation at a boundary ends in one of three places:

```text
Boundary operation
├── Known outcome       → return a value
├── Known failure       → return an error value
└── Unexpected failure  → throw
```

A known failure is still a return value. "No user has this id" is something the calling code has to handle during normal use, so it belongs in the return type, where the compiler checks that it's handled. Only the third branch leaves the return type.

## A `Result` puts both branches in the contract

A generic `Result<T, E>` is the usual way to write an operation with one success and one known failure:

```ts
type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

The `ok` flag is the discriminant, so checking it narrows the value to one branch. Written out for `findUser`:

```ts
type UserNotFound = { readonly kind: "notFound" };
type FindUserResult = Result<User, UserNotFound>;
```

Both branches are part of the function's contract. A caller gets either a `User` or a `UserNotFound`, and both are typed values it can match on. The `Err` branch (the one with `ok: false`) is a typed value that represents an expected failure, and the compiler treats it like any other return value: a caller that reads `value` without first checking `ok` doesn't compile.

## Don't unwrap a `Result` into an exception

A common helper converts a `Result` back into a plain value by throwing the error:

```ts
function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}
```

Called on `findUser`'s result, it takes the explicit contract `Result<User, UserNotFound>` and turns it into a plain `User` whose type no longer includes `UserNotFound`, although the call can still throw it:

```ts
async function userHeadingUnwrapped(id: string): Promise<string> {
  const user: User = unwrap(await findUser(id)); // compiles, and may throw { kind: "notFound" }
  return user.name;
}
```

That's less type-safe. The known failure leaves the return type and moves to the exception channel, which TypeScript doesn't track at all (a signature has no way to list what a function throws). Nothing makes the next caller handle `notFound`. It travels up until some `catch` happens to receive it, or until it reaches an error boundary and shows up as an unexpected failure.

`unwrap` also throws whatever `E` is. When `E` is a plain object such as `{ kind: "notFound" }`, `throw result.error` throws that object as it is. A stack trace is stored in the `stack` property of an [`Error` instance](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/stack), and most engines set it when the `Error` is created, so the thrown object reaches the logs with no stack trace. MDN's page on [`throw`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/throw) says the thrown value should always be an `Error` or a subclass for a related reason: code that catches it may rely on properties such as `message`. And inside a TanStack Query query function, a known failure that throws becomes a rejected query, which TanStack Query retries and doesn't cache (see [an expected outcome resolves](/react/render-props-and-tanstack-query/#an-expected-outcome-resolves-because-tanstack-querys-retry-and-cache-act-on-rejections)).

Dokseo had this exact helper in its query layer: an `unwrap` that threw a query failure for every error, and the writes that edit a book called it. So an edit of a book that another tab had just removed rejected with an expected "not found". The screen showed an error, and the refresh that runs after a successful write never ran, so the removed book stayed in the list. Once the writes resolved their outcome and the use cases moved to named unions, nothing called `unwrap` anymore, and I deleted it.

If a failure is worth modeling as the `Err` branch, the calling code should handle it as a value:

```ts
async function userHeading(id: string): Promise<string> {
  const result = await findUser(id);
  if (!result.ok) return "No such user";
  return result.value.name;
}
```

## Throw when the operation can't produce a known outcome

The third branch of the diagram is for failures where none of the outcomes in the return type applies:

- a network or infrastructure failure,
- an unexpected server failure,
- a malformed response,
- a violated invariant,
- any other failure that normal application code can't meaningfully handle as part of its control flow.

`findUser` with all three branches:

```ts
class HttpError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`GET ${url} failed with ${status}`);
  }
}

async function findUser(id: string): Promise<Result<User, UserNotFound>> {
  const url = `/users/${id}`;
  const response = await fetch(url); // a network failure rejects with a TypeError

  if (response.status === 404) {
    return { ok: false, error: { kind: "notFound" } };
  }

  if (!response.ok) {
    throw new HttpError(response.status, url);
  }

  return { ok: true, value: UserSchema.parse(await response.json()) };
}
```

The 404 check comes first because 404 is the one code this operation lists as expected. After it, every other status outside 200 to 299 throws. A first version of this function threw only for `status >= 500`, and that let a 401, a 403 or a 400 fall through to `UserSchema.parse` on an error body. A non-OK code that the operation doesn't list is unexpected by default, which is the rule from [classifying an HTTP response without listing every code](/architecture/expected-and-unexpected-failure/#classifying-an-http-response-without-listing-every-code). A malformed body throws too, because `UserSchema.parse` is a throwing parse.

The mapping from HTTP to outcomes looks like this:

```text
200                → Ok(User)        a listed outcome
404                → Err(NotFound)   a listed outcome
any other non-OK   → throw           no listed outcome applies
network failure    → throw           no listed outcome applies
```

HTTP classifies 404 as a client error, and here it's an ordinary return value. HTTP's definition of "error" doesn't have to be the application's definition.

## `Result` for two outcomes, a named union for several

`Result` fits best when an operation really is binary, one success and one kind of failure:

```ts
declare function validateEmail(input: string): Result<ValidatedEmail, InvalidEmail>;
declare function parseDocument(text: string): Result<ParsedDocument, ParseError>;
```

Some operations have several meaningful outcomes, and calling one of them "success" and the rest "errors" misdescribes them. For those I write a discriminated union named for the operation:

```ts
type FindUserOutcome =
  | { readonly kind: "found"; readonly user: User }
  | { readonly kind: "notFound" };

type CreateUserOutcome =
  | { readonly kind: "created"; readonly user: User }
  | { readonly kind: "emailTaken" }
  | { readonly kind: "invitationExpired" };
```

Each variant is one possible outcome of the operation. An email that's already taken is a normal result of creating a user, on the same level as `created`. What each option costs (uniform types and one-line propagation for `Result`, a full list of outcomes in one match for a named union) is on [a generic `Result`, or a named union per use case](/architecture/expected-and-unexpected-failure/#a-generic-result-or-a-named-union-per-use-case), and the rules for writing a union are on [closed unions](/typescript/closed-unions/#a-closed-set-is-a-readonly-discriminated-union).

Use cases are where I've settled on named unions. A use case like "archive a card" or "rename a tag" usually has more than one expected outcome, and both of my apps return a named union from each one. Dokseo, my manga and book reader, started with a generic `Result<T, E>` and one error union `E` per domain. Every storage adapter caught any throw and returned a "storage failed" variant with the message, so that variant ended up in every domain's `E`, and every use case passed it on as if it were an answer. A named union per use case lists only the outcomes that operation can have, so a catch-all like that has nowhere to spread.

## TanStack Query's states sit one level above the outcome

When `findUser` runs as a TanStack Query query function, TanStack Query's states sit one level above the outcome's:

```text
useQuery
├── pending
├── error
│   └── unexpected failure / thrown exception
│
└── success
    └── application outcome
        ├── Ok(value)
        └── Err(knownError)
```

TanStack Query's [queries guide](https://tanstack.com/query/latest/docs/framework/react/guides/queries) describes `isSuccess`, or `status === 'success'`, as "The query was successful and data is available". That's a statement about the query function: its promise resolved, and the query holds the value it resolved with. The success state doesn't describe whether that value is a positive outcome. A 404 resolves as `{ ok: false, error: { kind: "notFound" } }`, and the query is in its success state, because `findUser` returned one of the outcomes its type lists.

The `error` state holds what the query function threw: an `HttpError`, a network `TypeError`, a schema failure. Those are the unexpected failures.

A data component doesn't match on that nested structure directly. It flattens TanStack Query's states and the outcome's variants into one union, as in [match one flat union](/react/render-props-and-tanstack-query/#match-one-flat-union-not-tanstack-querys-result-object).

## The rule

Return a value for every outcome the operation's type lists. Throw when the operation can't produce any of them.

- Use `Result<T, E>` when `T` and `E` are both known, expected outcomes.
- Use a union such as `A | B | C` when an operation has several meaningful outcomes that don't fit success and failure.
- Use `throw` for unexpected failures outside the operation's typed contract.

Don't model a known failure with `Result` only to `unwrap()` it into an exception right away. That throws away the type safety `Result` exists to provide.
