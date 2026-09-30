---
title: "Closed Unions: Discriminants, Total Records and Exhaustive Matches"
description: Modeling a closed set as a readonly discriminated union, "no limit" as a variant, unions from schemas, total records, derived subsets, exhaustive matches, and never classifying an id by its text.
tags: [typescript]
sidebar:
  order: 2
---

A closed set is a fixed list of meaningful alternatives: the outcomes of loading a card, the states of a query, whether a deck is legal, the kinds of rule a deck can break. TypeScript can make the compiler know that list and hold every piece of code to it. These are the rules I follow for that. They come from [riftcards](/projects/riftcards/decks/legality/), where every rule on this page has a real case.

## A closed set is a readonly discriminated union

Say a function loads one card. It can succeed, find no card with that id, or fail to read the store. A common way to write the result is a bag of fields:

```ts
interface LoadCardResult {
  card: Card | null;
  error?: string;
  isLoading: boolean;
}
```

That type allows combinations that mean nothing: a card *and* an error, no card and no error while not loading. Every caller has to handle those somehow, and each one handles them a little differently. Nothing in the type shows which fields a caller should check, either.

A discriminated union lists the real alternatives, each with a literal `type` field that names which one it is:

```ts
type CardLoadOutcome =
  | { readonly type: "success"; readonly card: Card }
  | { readonly type: "notFound" }
  | { readonly type: "loadFailed" };
```

Now the nonsense combinations can't be written, `card` only exists on the variant that has one, and checking `type` narrows the value so the compiler allows only the fields that variant has. `readonly` stops anyone from mutating a result after the fact, which could leave it inconsistent with its own `type`.

The rule: model every closed set of alternatives as a readonly discriminated union. Never encode one with nullable values, optional error fields, or booleans a caller has to combine.

## "No limit" is a variant, not a null

A deck builder has copy limits. Most sections allow three copies of a card, one allows any number. The quick encoding is `limit: number | null`, with `null` for "no limit".

That breaks in plain JavaScript ways. Say the builder computes how many more copies someone may add: the limit minus what they already hold. With three allowed and three held, the answer is `0`. Code that then checks `if (!remaining)` to spot the unlimited case reads `0` as "no limit", because `0` and `null` are both falsy, and the builder accepts a fourth copy. `Math.min(3, null)` is `0` at runtime too. Every caller has to special-case one number that isn't a number.

Make "no limit" a variant instead:

```ts
type CopyAllowance =
  | { readonly type: "limited"; readonly copies: number }
  | { readonly type: "unlimited" };
```

Now `{ type: "limited", copies: 0 }` and `{ type: "unlimited" }` can't be confused, and a function that takes the tighter of two allowances has to handle each pair of variants. The same goes for any "no value" that means something: when absence is one of the alternatives, it gets a name.

## A union that crosses a boundary comes from its schema

Some unions describe data that arrives from outside the code: a row from a database, a saved file, a route parameter. That data has to be validated when it arrives (the reason is on [expected and unexpected failure](/architecture/expected-and-unexpected-failure/#validate-where-data-arrives)), so there's a schema for it anyway.

If the TypeScript type is written out separately from that schema, there are two definitions of the same union. Add a variant to one and forget the other, and everything still compiles: the type includes the variant while validation rejects it, or the other way round. So I define the union in the schema and infer the type from it:

```ts
const copyAllowanceSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("limited"), copies: z.number().int().nonnegative() }),
    z.object({ type: z.literal("unlimited") }),
  ])
  .readonly();

type CopyAllowance = z.output<typeof copyAllowanceSchema>;
```

(Zod is the example. Any schema library that infers types works the same way.)

A union that never leaves the UI (the state of a save button, the steps of a wizard) doesn't need a schema. Nothing unvalidated ever reaches it, so a plain readonly union is enough.

## A union that indexes a table gets a total record

Some unions pick out a row of data. A deck has five sections, and each has a rule: a label, how many cards it needs, how many copies of one card it takes. The first way to write that is usually an array:

```ts
const SECTION_RULES: readonly SectionRule[] = [/* one per section */];
const rule = SECTION_RULES.find((rule) => rule.section === section);
```

`find` returns `SectionRule | undefined`, because the compiler has no way to check that the array has a row for every section. So callers write `?? SECTION_RULES[0]` to get a value, and the day someone adds a section and forgets its row, that fallback silently returns the first section's rule for the new section. Nothing fails. The deck just gets checked against the wrong rule.

A `Record` keyed by the union is total: it must have a key for every member.

```ts
const SECTION_RULES_BY_SECTION: Readonly<Record<DeckSection, SectionRule>> = {
  legend: { section: "legend", label: "Legend", requiredCount: 1, /* … */ },
  mainDeck: { /* … */ },
  // leaving a section out fails to compile
};

function sectionRule(section: DeckSection): SectionRule {
  return SECTION_RULES_BY_SECTION[section];
}
```

Leave a section out and the declaration doesn't compile (`Property 'sideboard' is missing`). The accessor returns a row, never `undefined`, so no caller needs a fallback. If something needs the rows in order, derive the array from the record rather than keeping a second list.

## A subset is a derived list, not a subtype

Sometimes a rule applies to only some members of a union. Four of the five deck sections are filled with a count of cards; the legend is a single pick, checked on its own. The tempting move is a subtype: `type CountedSection = Exclude<DeckSection, "legend">`.

That subtype has a problem the name hides. Every function that takes it now refuses the legend, and the legend belongs to no type of its own, so code that handles "the legend" has nowhere to put it. In riftcards the subtype also got a misleading name, which then invited wrong readings of what it selected. It was deleted.

What's actually needed is narrower: one loop skips the legend. So keep one type for the value and derive an ordered list from the total record for the loop:

```ts
const COUNTED_SECTION_RULES: readonly SectionRule[] = [
  SECTION_RULES_BY_SECTION.mainDeck,
  SECTION_RULES_BY_SECTION.runeDeck,
  SECTION_RULES_BY_SECTION.battlefield,
  SECTION_RULES_BY_SECTION.sideboard,
];
```

The exclusion lives where it's needed, in the loop, and every section still has exactly one type and one rule. A schema library usually has a way to build a real subset schema (Zod's `extract`) for the rare case where a value really is restricted. Reach for it only then.

## Match exhaustively; a catch-all is for open input

Code that handles a union has to handle every variant, and it has to keep doing so when the union grows. The point of a closed set is that adding a variant becomes a compile error everywhere it isn't handled yet.

With ts-pattern, that's `.exhaustive()` at the end of a match:

```ts
const label = match(result)
  .with({ type: "success" }, ({ card }) => card.name)
  .with({ type: "notFound" }, () => "No such card")
  .exhaustive(); // error: loadFailed is not handled
```

The compiler reports the missing variant by name. Without a library, a `switch` gets the same guarantee under `noImplicitReturns`, as described in [exhaustiveness without a library](/typescript/type-checking-techniques/#exhaustiveness-without-a-library). (A match's output type is inferred from its handlers, which has [its own gotcha with string literals](/typescript/type-checking-techniques/#ts-pattern-infers-a-matchs-output-from-its-handlers-so-a-string-literal-widens).)

The catch-all (`.otherwise()`, or a `default:` branch) turns that guarantee off. Say the match above ends in `.otherwise(() => "No such card")` instead of `.exhaustive()`. It compiles today, and `loadFailed` already falls into the catch-all, so when the store can't be read, the screen shows that the card doesn't exist. When someone later adds a `forbidden` variant, that one ends up there too. Nobody is told. So a catch-all is only for input that really is open: a string from a feed, a key someone typed. It's never a way to skip a variant I know about.

## Never classify an identifier with a string method

Say some printings in the catalog are previews, and their ids happen to start with `preview-`. Code that needs to treat previews differently can check `id.startsWith("preview-")`. It works until the id scheme changes, and then every check is wrong without a compile error, because the compiler has no way to check what a prefix means.

So I don't decide what something is with `startsWith`, `endsWith`, `includes`, `split` or `slice`. A value that code branches on keeps its meaning in its own field (`isPreview`, or a `kind` in a union) and gets read with an exhaustive match. That applies to anything code branches on: a rule name, an error kind, a section, a category.

The same rule rules out composite string keys like `` `${section} ${printingId}` `` whose parts are later cut back out and cast to their types. Key by a nested record instead, or keep the parts on the value.

Parsing text is fine where the input really is text from outside: a URI, the rules text printed on a card, a name from a data feed. What it must never do is recover a discriminant the code itself wrote.
