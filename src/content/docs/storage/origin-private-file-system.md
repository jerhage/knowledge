---
title: The Origin Private File System (OPFS)
description: The OPFS handles, the private-window refusal, reading with getFile(), the two ways to write (createWritable and the worker-only sync access handle), locks, removal, and browser support.
tags: [storage, opfs, files, web-workers]
sidebar:
  order: 3
---

The origin private file system is a file system per origin, with directories and files. It doesn't show up in the operating system's file browser, and no permission prompt guards it. It counts against the same quota as IndexedDB and the Cache API, and clearing site data deletes it. Each browser stores it in its own layout, so the files on disk don't match it one to one. It's part of the WHATWG File System standard. The file pickers (`showOpenFilePicker()` and friends) are a separate WICG spec, and you don't need them for any of this.

The techniques I use with it are in [OPFS in practice](/storage/opfs/). Quota and eviction are in [persistence and quota](/storage/persistence-and-quota/). It also holds resumable [model downloads](/machine-learning/model-downloads/), and a test can hold a loading screen by stalling `getFile()` ([browser probes](/testing/browser-probes/)).

## Handles

You reach OPFS through handles. `navigator.storage.getDirectory()` gives you a handle on the origin's root directory, and from a directory handle you get handles on the directories and files inside it:

```js
const root = await navigator.storage.getDirectory();   // FileSystemDirectoryHandle
const books = await root.getDirectoryHandle("books", { create: true });
const file = await books.getFileHandle("a.zip", { create: true }); // FileSystemFileHandle
```

- Without `{ create: true }`, a missing entry rejects with `NotFoundError`.
- A directory handle is an async iterable: `for await (const [name, handle] of dir)`, or `.keys()`, `.values()`, `.entries()`. `handle.kind` is `"file"` or `"directory"`.
- `dir.resolve(handle)` gives the path from `dir` to a descendant as an array of names, or `null`. `a.isSameEntry(b)` compares two handles.
- Handles are serializable, so they can be posted to a worker or stored in IndexedDB.
- Secure contexts only.

## `getDirectory()` can throw in a private window

In a Firefox private window there's no OPFS: `navigator.storage.getDirectory()` rejects with a `SecurityError` `DOMException`. Firefox's source makes that depend on a preference, `dom.fs.privateBrowsing.enabled`, which is off by default. MDN says some browsers reject with an `UnknownError` in private browsing instead. WebKit's source looks like one of them: its storage process fails with a generic unknown error when the session has no storage directory on disk, which is how I read a Safari private window, though I haven't run it there. MDN also lists `SecurityError` for a browser that can't map the directory at all, for example because of storage or memory limits.

For an app, a refusal like this is expected: the screen can tell the person to open a normal window, and they can act on it. So I recognize it once, in the platform code that reaches the root directory, and give it one message:

```ts
const PRIVATE_WINDOW =
  'This browser will not save files in a private window. Open the app in a normal window to save files.';

async function storageRoot(): Promise<FileSystemDirectoryHandle> {
  try {
    return await navigator.storage.getDirectory();
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'SecurityError') {
      throw new Error(PRIVATE_WINDOW, { cause });
    }
    throw cause;
  }
}

function isPrivateWindowRefusal(cause: unknown): boolean {
  return cause instanceof Error && cause.message === PRIVATE_WINDOW;
}
```

The check goes by the message rather than by a class because the same refusal can happen inside a worker that writes to OPFS, and an error that crosses from a worker arrives as a reply the worker posts, not as the original object. So a worker that touches OPFS reports this same text, and the main-thread code that talks to it rebuilds the same error from that text.

An adapter whose port has an "unavailable" variant then checks for the refusal inside its `try` and lets everything else throw:

```ts
async function readCover(name: string): Promise<FileLookup> {
  try {
    const file = await readStoredFile(name);
    return { kind: 'success', file };
  } catch (cause) {
    if (isPrivateWindowRefusal(cause)) return STORAGE_UNAVAILABLE;
    throw cause;
  }
}
```

That's the catch-to-translate case from [expected and unexpected failure](/architecture/expected-and-unexpected-failure/#catch-only-to-add-something). Dokseo, my manga and book reader, works this way. Its check matches only `SecurityError`, so in a browser that rejects with `UnknownError`, the refusal reaches an error boundary as an unexpected failure instead.

## Reading: `getFile()`

To read a file, you get a `File` from its file handle:

```js
const f = await file.getFile(); // a File
const head = await f.slice(0, 64).arrayBuffer();
```

`getFile()` returns a normal `File`, so anything that takes a `Blob` takes it: `slice()`, `stream()`, `URL.createObjectURL()`, `new Response(f)`. Reading a slice reads only those bytes. That's why an OPFS copy of a large archive is usable without loading the whole thing: see [large files](/files/large-files/).

The spec sets the `File`'s data to a copy of the entry's data at that moment, a snapshot. So I don't expect a `File` I got earlier to follow later writes. I call `getFile()` again.

OPFS stores bytes and a name, but no media type. The spec leaves the `File`'s `type` up to the browser (it can go by the name's extension, for example). So a file saved with a non-standard extension (say `.cover`) comes back with `type` `''` (measured in Chromium). That matters for object URLs: see [image formats](/images/image-formats/).

## Writing, the async way: `createWritable()`

`createWritable()` gives you a stream you write into:

```js
const w = await file.createWritable();   // FileSystemWritableFileStream
await w.write(blob);                     // or a BufferSource, a string, or { type: "write", position, data }
await w.close();                         // the file changes here
```

- Nothing shows up in the file until `close()`. MDN says browsers typically write to a temporary (swap) file and replace the original on close. So a write needs room for a second copy: roughly double the file's size in free quota while it runs.
- `{ keepExistingData: true }` starts the swap file as a copy of the current file; otherwise it starts empty.
- `abort()` instead of `close()` throws the changes away.
- It is a `WritableStream`, so `readable.pipeTo(w)` works.
- It works on the main thread and in workers.

## Writing, the fast way: `createSyncAccessHandle()`

`createSyncAccessHandle()` gives you a handle with synchronous methods that read and write at a byte offset:

```js
// in a dedicated worker only
const h = await file.createSyncAccessHandle();
h.truncate(0);
const written = h.write(bytes, { at: 0 }); // returns the number of bytes written
h.flush();
const size = h.getSize();
h.read(buffer, { at: 0 });
h.close();
```

- **Dedicated workers only.** In the spec's IDL, `createSyncAccessHandle()` and `FileSystemSyncAccessHandle` are `[Exposed=DedicatedWorker]`: not on the main thread, not in shared or service workers.
- **Getting the handle is async**, but its methods are synchronous.
- **It writes in place.** There's no swap file and no commit at `close()`. So a write doesn't need double the quota, and the bytes are in the file as soon as `write()` returns (`flush()` makes sure they reach disk).
- **It takes an exclusive lock.** While it's open, another `createSyncAccessHandle()` or `createWritable()` on that file rejects with `NoModificationAllowedError`. `createWritable()` takes a shared lock, so several writables can be open at once, but any one of them blocks a sync handle. Always `close()` it, in a `finally` or with a disposable wrapper.

MDN notes that older versions of the spec made `close()`, `flush()`, `getSize()` and `truncate()` async, and older browsers shipped them that way. Current browsers are synchronous.

MDN also documents a non-standard `mode` option (`"read-only"`, `"readwrite"`, `"readwrite-unsafe"`) for sharing a sync handle between tabs, listed only in Chrome (121).

## Removing

You remove an entry through the directory that holds it, by name:

```js
await dir.removeEntry("a.zip");
await dir.removeEntry("books", { recursive: true });
```

Removing a non-empty directory without `recursive: true` rejects with `InvalidModificationError`. The spec notes that a recursive removal can fail partway through, with some entries already removed.

MDN also shows `handle.remove()`, including `(await navigator.storage.getDirectory()).remove({ recursive: true })` to clear everything. That isn't in the standard, and MDN lists it only in Chrome (110). `removeEntry()` works everywhere.

## Sending files to a worker

When you post a `Blob` or `File` to a worker, it's cloned without reading its bytes. So the main thread can pass a large file to an OPFS writer worker cheaply: see [transferable objects](/javascript/transferable-objects/). A write in a worker is also the only way to write OPFS on older Safari, where `createWritable()` doesn't exist.

## Browser support

From MDN:

| Feature | Chrome | Firefox | Safari |
| --- | --- | --- | --- |
| `navigator.storage.getDirectory()`, handles, `getFile()`, `removeEntry()` | 86 | 111 | 15.2 |
| `createSyncAccessHandle()` | 102 | 111 | 15.2 |
| `createWritable()` | 86 | 111 | 26 |
| `remove()` (non-standard) | 110 | no | no |

The row that matters is Safari's, because `createWritable()` arrived there so much later. Before 26, the only way to write a file into OPFS there is a sync access handle in a dedicated worker. Otherwise an upload fails with `createWritable is not a function`. Everything else, including reading and removing, works on the main thread in all three.

## References

- [WHATWG File System Standard](https://fs.spec.whatwg.org/)
- [MDN: Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [MDN: `StorageManager.getDirectory()`](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory)
- [MDN: `FileSystemSyncAccessHandle`](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle)
- [MDN: `FileSystemFileHandle.createSyncAccessHandle()`](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle)
- [MDN: `FileSystemFileHandle.createWritable()`](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable)
- [MDN: `FileSystemDirectoryHandle.removeEntry()`](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/removeEntry)
