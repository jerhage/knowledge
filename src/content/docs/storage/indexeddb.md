---
title: "IndexedDB: Transactions, Upgrades and Stored Values"
description: Resolving on commit, one shared upgrade module, deleting by index, blocked upgrades across tabs, and unchecked stored values.
tags: [storage, indexeddb, typescript]
sidebar:
  order: 2
---

I use IndexedDB for small, structured records that I query. Large blobs go to OPFS. Quota and eviction are in [Storage Persistence, Quota and What It Counts](/storage/persistence-and-quota/). How I stall an IndexedDB read to hold a loading state in a test is in [Browser Probes](/testing/browser-probes/).

## Resolve an IndexedDB helper on `transaction.oncomplete`, not `request.onsuccess`

IndexedDB reports results through events, so I wrap reads and writes in helpers that return a promise. A helper like that has to resolve on one of two events. The request calls `request.onsuccess` when it succeeds, and the transaction it runs in calls `transaction.oncomplete` when it commits.

Those aren't the same moment. A request can succeed and the transaction still not commit. A helper that resolves on the request signals to its caller that the write is done, the caller moves on, and the write may never commit.

Resolving on completion costs one event-loop turn, and in return a write that resolved has really committed.

## Deleting by index means collecting keys and deleting inside the same transaction

Say you want to delete every record whose indexed field has a given value. There's no delete-by-index. `index.getAllKeys(key)` gives you the primary keys of the matching records, and you delete by those. Send the deletes from that request's `onsuccess`, while the transaction is still open:

```ts
const matching = objectStore.index(index).getAllKeys(key);
matching.onsuccess = () => {
  for (const primary of matching.result) objectStore.delete(primary);
};
```

Then resolving on `transaction.oncomplete` means every delete committed, so the clear is all-or-nothing. If you await the keys first and delete in a second transaction, that's two transactions with a gap between them.

## Adding a store to a live database is a version bump, and every adapter on that database has to move together

An adapter here is the concrete code behind a port that stores things, in this case the code that calls IndexedDB. Two or more adapters can open the same database.

A new store can only be created during an upgrade. `onupgradeneeded` fires once, for the whole database, with the new version. It's the only place you're allowed to call `createObjectStore` and `createIndex`, and it passes you the database. So adding a store means raising the database's version, and the upgrade function has to create *every* store the current version defines, each one guarded by `objectStoreNames.contains`:

```ts
function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
    db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
  }
  if (!db.objectStoreNames.contains(NOTES_STORE)) {
    const notes = db.createObjectStore(NOTES_STORE, { keyPath: 'id' });
    notes.createIndex('ownerId', 'ownerId', { unique: false });
  }
}
```

Going from v1 to v2, this creates only the missing store, so the rows already in the other store stay as they are. Drop the guard, or recreate a store to "reset" it, and you delete real user data.

**The second adapter is where it breaks.** Say two adapters on one database each keep their own version number, and one of them moves up to add its store. Whichever one opens at the lower version gets a `VersionError`. Don't try to keep two constants in sync. Have one. Put the name, the version, the store names and the upgrade in a single module that every adapter on that database calls. Share the connection promise too, so your own second connection can't block a later upgrade. If an architecture rule forbids importing adapters, it needs an exemption that lets an adapter reach a sibling adapter in its own domain, or the rule rejects that shared module (see [dependency-cruiser](/tooling/dependency-cruiser/) for how I write that exemption).

SQLite handles the same change differently: [a new table is one more migration, not a version bump](/storage/sqlite/#a-new-table-is-one-more-migration-not-a-version-bump).

## An upgrade waits on every other tab's open connection

Say the app is open in two tabs, and one of them requests a higher version with `indexedDB.open(name, higher)`. It can't run `upgradeneeded` while any other connection to that database is open, in any tab, including the other one.

The browser first fires `versionchange` on each of those other connections. If a connection doesn't call `close()` in response, the upgrade keeps waiting. The opening request gets `blocked` (once) and then just stays pending. `blocked` isn't a failure: `success` still arrives as soon as the last holder closes.

So the fix goes on the side *holding* the connection: close on `versionchange`. The opening side only needs a limit on how long it waits, in case a holder never closes. Once the old tab has closed, its own next open at its old version fails with a `VersionError` `DOMException`. That's the signal to reload.

A connection can also be closed by the browser (storage cleared, a failure). A connection's `close` event fires only in that case. It never fires after a script calls `close()`. A connection helper should handle all three cases. A transaction helper can also swap a retired connection for the live one, so a caller that cached an `IDBDatabase` still works.

## A stored enum value is unknown until a load checks it

Say a stored record has a field whose type is a union of names, like a tag's color. A typed IndexedDB read (`listRecords<StoredTag>`) names a type. It doesn't check one. IndexedDB returns whatever was written.

That includes a value a later rename took out of the union. Say a color was renamed from `ember` to `copper`. Tags stored before the rename still come back as `ember`. Nothing throws. The value just misses every lookup keyed on the union, so the tag draws no color.

So I type that field `unknown` in the stored type, which is the truth about what the read returns, and narrow it in a pure `tagFromStored` function. The guard is built on the list of values:

```ts
const TAG_COLORS = ['copper', 'moss', 'slate'] as const;
type TagColor = (typeof TAG_COLORS)[number];

function isTagColor(value: unknown): value is TagColor {
  return TAG_COLORS.some((known) => known === value);
}

function tagFromStored(stored: StoredTag): Tag {
  return { ...stored, color: isTagColor(stored.color) ? stored.color : DEFAULT_TAG_COLOR };
}
```

`TAG_COLORS.includes(value)` looks like the obvious way to write it, but it doesn't compile. On a readonly array of names (a tuple, or a `readonly TagColor[]`), `includes` takes only one of those names, so an `unknown` argument is a type error (checked with `tsc --strict` on TypeScript 6.0). `some` with `===` compares an `unknown` to each name with no cast.

Where a default is safe, like a tag's color, the field falls back to it, as above. Now renaming a stored union member needs no migration, only the fallback.

Each field gets its own decision, though, and some have no safe default. In Dokseo, my manga and book reader, a stored book's layout kind says whether the book is shown as images (page by page, or as one continuous strip) or as flowing text, and no default is right for every book. An unknown value there means the row is corrupt, and the load should say so where it happens instead of failing later in some exhaustive match far from the row. A small helper does that:

```ts
class CorruptRow extends Error {
  override readonly name = 'CorruptRow';

  constructor(row: string, field: string, value: unknown) {
    super(`A stored ${row} holds an unknown ${field}: ${String(value)}`);
  }
}

function knownStoredValue<T>(
  row: string,
  field: string,
  value: unknown,
  known: (value: unknown) => value is T,
): T {
  if (known(value)) return value;
  throw new CorruptRow(row, field, value);
}

// in bookFromStored
const layoutKind = knownStoredValue('book', 'layout kind', stored.layoutKind, isLayoutKind);
```

The error names the row, the field and the value it found, and it travels to an error boundary like any other unexpected failure (see [expected and unexpected failure](/architecture/expected-and-unexpected-failure/#validate-where-data-arrives)).

A discriminant inside a nested object that's already typed has one more wrinkle. Say a note's `anchor` is typed as `{ kind: 'page'; … } | { kind: 'text'; … }`, and after checking both kinds I want to throw a `CorruptRow` with whatever value the row actually held. After both checks, TypeScript has narrowed `anchor` itself to `never`, so `anchor.kind` no longer compiles. Destructuring the discriminant first fixes that: `const { kind } = anchor;`. TypeScript still narrows `anchor` through checks on `kind`, and after both checks `kind` is typed `never` but holds the real runtime value, so `throw new CorruptRow('note', 'anchor kind', kind)` reports it.

(A new optional field on a stored record has its own typing wrinkle under `exactOptionalPropertyTypes`: see [TypeScript: Brands, Strict Flags and Typed Arrays](/typescript/type-checking-techniques/).)
