---
title: Entities, Value Objects and Identities
description: Why an id is a value even when the thing it names is an entity, branding ids and reaching the brand by parsing, which identifiers to store, and which DDD patterns I actually use.
tags: [architecture, domain-driven-design, typescript, storage]
sidebar:
  order: 10
---

Domain-driven design has a long list of patterns. I use two of them on purpose: the split between entities and value objects, and a branded type for every identifier the code can confuse with another. For the identifiers themselves, the question is which ones to store, which ones to derive, and which ones never to keep. The examples use the card catalog from the [overview](/architecture/overview/#the-running-example). [Rifty](/projects/rifty/cards/identities/), my Riftbound card app, is where each rule came from, with the real ids.

## An identity is a value; the thing it names is not

The catalog keeps cards. A card is an **entity**: it has a lifecycle (someone adds it, edits its text, deletes it), and two cards are the same card when they have the same id, even if every other field changed in between. So cards compare by id.

Each card is named by a `CardId`. The `CardId` is a **value object**: it's a string that names a card, not the card. Two `CardId`s holding the same text are interchangeable. You can't tell them apart and would never want to. The id never changes, has no lifecycle and holds no state to mutate.

| | Has identity? | Equality |
| --- | --- | --- |
| `Card`, the entity | yes, that's what makes it an entity | by id |
| `CardId`, the value | no | by value |

This looks like a contradiction the first time: an ids folder full of value objects, when every id names an entity. It isn't one. "A value object has no identity" means the object itself has none. It doesn't mean it can't point at something that does. An entity's identity is *expressed by* a value object.

The distinction matters because the next question is always "where does this type go?", and it gives the answer without an argument. The id is a value, so it goes with the values. The entity goes with its domain's model.

## One test keeps a value-object folder correct

Once a domain has a folder of value objects, other things belong there for the same reason ids do. A closed enumeration like a card's type or rarity is compared by value and must not be confused with a bare `string`. A type has no lifecycle. It names one of a few possibilities.

The folder drifts when something in it turns into an entity over time. So I check each file with one question: has it grown a lifecycle, or does anything compare it by id instead of by value? If yes, it's an entity and it's in the wrong folder. Move it next to its domain's model.

## Brand an identifier, and reach the brand by parsing

Suppose a card can have several printings, and a deck row stores two ids: the card's and the printing's. Both are strings at runtime. As plain `string`s in the types, a call that swaps them compiles. Then it either fails at runtime or, worse, looks up the wrong row, and nothing reports it.

A brand fixes that at the type level. It's a tag that exists only in the types, so two strings that look the same at runtime become two types the compiler keeps apart. With a schema library it's one line per id. Zod is the example here:

```ts
const printingIdSchema = z.string().trim().min(1).brand<"PrintingId">();
type PrintingId = z.output<typeof printingIdSchema>;
```

With `CardId` branded the same way, passing a `PrintingId` where a `CardId` belongs is a type error, and so is passing a bare string. A branded id is still a string, so writing it to a text column or a URL needs no conversion.

The one way to defeat it is a cast. `id as PrintingId` compiles for any string at all, so it produces a value with the brand's type and none of the checking. The rule that makes brands worth having: **reach a branded type by parsing, never by casting.** Parse where the string arrives: in the adapter that reads a row, and where a route passes its parameter, which is always a bare string. After that, trusted code only ever holds parsed ids.

A minting function without a check is a cast with a name. Dokseo, my manga and book reader, opens a book from a route like `/read/[fileId]`, and the route used to build its id from the `fileId` parameter with `bookId(fileId ?? '')`. `bookId` only applied the brand, so any string became a `BookId`, the empty string included. The only check on the id's format sat deep in the storage adapter, and it reported a storage failure. In practice a malformed id still ended on the right screen, because the lookup found no book and the route went back to the library, but by accident. Now a parse in the kernel, `parsedBookId(raw): BookId | null`, rejects an empty id and any id with a slash, a backslash or `..`, a `null` takes the same path as a book that doesn't exist, and the adapter's check became an assertion that throws, since only a programmer error can reach it.

A brand has to be built so the compiler can't widen it away. That's a subtle point with hand-rolled phantom brands, covered in [a phantom brand must be invariant](/typescript/type-checking-techniques/#a-phantom-brand-must-be-invariant-or-it-has-a-hole).

Not every id needs a brand. The case for one is strongest for an identifier with a strict grammar that other code reads meaning out of, like a printed rule number such as `103.2.a`. The case is weaker for a lookup key from an open set that arrives from a feed (tags, rarities), where new values appear without any change to the app. In Rifty I first left those plain for that reason and later branded them too. Either way, the test is the same as for the deck row: if two ids can meet in one signature, brand both.

Where a shared id type lives depends on the graph. Under the [leaf rule](/architecture/domains-and-the-graph/#leaves-and-non-leaves), two leaf domains can't import each other, so an id both need moves down into the kernel, which [imports no domain](/architecture/domains-and-the-graph/#the-kernel-imports-no-domain). That keeps the leaves independent, at the cost of a kernel that holds ids whose grammar belongs to one domain. If the graph allows any acyclic edge, the id can stay with the domain that owns it, next to its grammar and anything derived from it, and the domain that needs it imports it. That costs one more edge between domains. [Dokseo](/projects/dokseo/architecture/domains/) does the first; [Rifty](/projects/rifty/cards/identities/) does the second.

## Never persist another system's surrogate key

A surrogate key is an identifier whose only meaning is "the primary key of a row in someone else's database": an ObjectId, a UUID from a feed. Say the catalog is seeded from a card feed, and each feed record comes with such a key. Using it as the card's id is the obvious move, and it goes wrong in three ways:

- It describes nothing about the card, so nothing can check it.
- It changes whenever that other system is rebuilt, or reissues a record under a fresh key. Every stored reference to the old key then points at nothing.
- A feed that changed schemes over time mixes several kinds of key in one column. Rifty's feed had three at once: 1098 ObjectIds, 241 `preview-` strings and 123 UUIDs.

So I build an identity from facts about the object instead, facts anyone holding the physical card could read off it: a set code, a collector number, a finish. Two copies of the pipeline that process the same card compute the same id.

Matching a feed record against a stored row is still a real problem, but it's an ingestion problem. The import pipeline can keep the source key in its own working data while it reconciles records. It just never writes it into the schema or the model.

## Derive what the identifier encodes; store what it cannot

Some identifiers contain information. A rule number like `103.2.a` encodes its depth (three segments), its ancestors (`103` and `103.2`) and whether it's a chapter heading, just by how it's written.

Storing any of that next to the number means two places that can hold different values. So derive it: a function takes the number and returns the depth. There's a tempting counterargument when the app filters in the database: surely the depth needs a column so a query can use it? Check the actual query first. If the only question is "give me the top level", SQL can answer it from the number itself (`number NOT LIKE '%.%'`), and indentation while rendering is presentation, computed where it's drawn.

Three kinds of neighboring fact do get a column, each for a different reason:

- **A foreign key** to the parent rule. It's there for enforcement: it proves no rule is orphaned, and only the database can do that.
- **A fact the identifier can't reconstruct.** Top-level rule numbers are sparse and segments alternate between numbers and letters, so document order can't be recovered from the number. Position gets stored.
- **A judgment made once.** Whether an entry is a heading or a rule might be computed by a heuristic over its text. That's derived, but not from the identifier, and it should run once, visibly and under test, rather than again on every device. Store the result.

The test is whether the identifier encodes it. If it can, derive it. If it can't, store it.

## Store a reference, compose the URL at the adapter

Say each card has an image, served from some host. The stored row could hold the full URL, ready to use. But the host is a deployment detail: it changes between a development machine and production, or when images move to another provider. A row that stored `http://192.168.1.20:8787/cards/abandon.webp` breaks the day the host moves, and so does every other row.

So persistence keeps the provider-independent reference, the image's file name, and the adapter that reads the row composes the URL. It receives the base URL as a parameter from the [composition root](/architecture/dependency-injection/#the-composition-root-builds-everything-once), so no stored value contains the host. The same goes for a derived view flag: it's computed where it's shown, not stored.

## Take only the patterns whose absence caused a bug

Entities, value objects and brands are a small slice of domain-driven design. The rest (aggregates as classes, domain events) I don't use, and the reason is the test I apply to any pattern: can I name a defect its absence caused?

The two I use pass it. Brands deleted a class of bug, the swapped-ids one above. The entity/value split settles where a type goes without argument. The ids started life as `type PrintingId = string`, and that held up until one table had two id columns.

The others don't pass, at least not yet. In Rifty there's one aggregate in spirit, the deck with its entries, and it's enforced by a schema refinement rather than by a class. Nothing needs events and nothing is distributed. The full pattern set would add vocabulary without deleting a bug.
