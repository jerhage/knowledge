---
title: Writing Large Files to OPFS
description: Writing from a worker with a sync access handle, chunked progress, locks that block deletes, and inspecting OPFS.
tags: [storage, opfs, web-workers, safari, files]
sidebar:
  order: 4
---

My reader stores each book someone uploads as a file in OPFS, and a book can be hundreds of megabytes. It also downloads model weights into OPFS in chunks. The handles and the API surface are in [The Origin Private File System](/storage/origin-private-file-system/). These are the parts that bit me when writing large files into it.

## A blob is written to OPFS from a worker, because Safari

An upload arrives as a `Blob`, and the app has to write it to a file in OPFS. A file handle can be written through `FileSystemFileHandle.createWritable()` or through `createSyncAccessHandle()`.

`createWritable()` works on the main thread. It only reached Safari in version 26. So someone uploading a book on an older iPhone gets a failed upload with `createWritable is not a function`.

`createSyncAccessHandle()` has been in Safari since 15.2 and is in every engine, but *only* inside a dedicated worker. No engine has it on the main thread.

So I do the write in a worker. The part of the app that stores blobs (the blob store) posts the `Blob` to an OPFS writer worker and awaits the reply. Posting the blob to the worker costs nothing, because structured clone passes a `Blob` by reference (see [Transferable Objects and Structured Clone](/javascript/transferable-objects/)). A 400 MB archive goes to the worker without anything being read into memory on the main thread.

Only the write has to move. Reading a file, totalling the files and removing one use `getFile()`, `values()` and `removeEntry()`, and those work on the main thread everywhere.

Even where `createWritable()` exists, the sync handle is the better choice for a large blob. A writable buffers what you write to a swap file and commits it at the end, so writing a large blob through one briefly needs roughly double its size in quota. `createSyncAccessHandle` is worker-only, but it writes in place and works on every current engine. So I use it for large writes.

## A chunked OPFS write is what makes the byte fraction exist

While a book uploads, I want to show how far along the write is, as a fraction of the bytes. A single `write(blob)` call can't give me that. It resolves when the whole blob has gone in, and it reports nothing between 0 and 100.

So the worker writes in pieces. It walks the blob in fixed ranges (4 MiB works well). For each range it resolves `blob.slice(from, to)` to bytes, writes them, and posts a progress reply to the main thread. Slicing is free. A `Blob` is a reference with a size, so slicing allocates nothing, and only the chunk in hand ever gets resolved to bytes (more on that in [Large Files](/files/large-files/)).

**The fraction does not run ahead of the file.** A sync access handle writes in place. There's no swap file to commit at `close()`, so when the last progress reply arrives, the bytes are already in the file. The write also doesn't need roughly double the file's size in free quota. A `createWritable()` path does, so on that path, check `estimate()` before a large upload.

The same progress replies can drive a time-left estimate. That estimate divides elapsed time by bytes written, and right after the upload starts there's too little of either for the answer to mean anything. So it needs a floor. Under about 600 ms of elapsed time, or under 2% of the file, give no estimate. Below the floor, show the percentage and not the time.

## An open sync access handle makes `removeEntry` fail, silently if you let it

`createSyncAccessHandle()` takes an exclusive lock on the file for as long as the handle is open. While the lock is held, `removeEntry` on that file throws `NoModificationAllowedError`. Only `close()` or the worker going away releases the handle.

That hit me in the model downloads. The app downloads model weights with a resumable fetch. It appends each downloaded chunk to a part-file in OPFS, and once the download is complete, the bytes go into the Cache API and the part-file is deleted. The fetch opened one handle per chunk and closed it when the read for that chunk came back `done`. It never closed the *final* chunk's handle, because the loop returns the moment the last byte reaches the total, before any `done` read. So the delete of the finished part-file ran with that handle still open and failed. The delete had a `.catch(() => undefined)` on it, meant to tolerate a part-file that was already missing, and it swallowed the error. So a 117 MB weight file stayed in OPFS while the same bytes sat in the Cache API. (The resumable fetch itself is in [Model Downloads](/machine-learning/model-downloads/).)

The rule: **release the handle before you delete the file**, and don't let one `catch` cover both "already gone" and "locked". Put the completion path (close the append, cancel the chunk reader, close the stream) in one place. Reach it from the last byte, not from a pull the consumer may never make.

## Chrome does not expose OPFS on disk; Firefox does

When I want to check what a page actually wrote to OPFS, the first idea is to find the files in the browser's profile folder. That only works in some browsers. Chrome stores OPFS under opaque numbered paths with an internal mapping, so you can't browse it. Firefox-family browsers use `<profile>/storage/default/<origin>/fs/`, with names in `metadata.sqlite` and bytes in id-named files.

Either way, the portable way to look inside is from the page. This downloads every file in one directory:

```js
const root = await navigator.storage.getDirectory();
const dir = await root.getDirectoryHandle('blobs');
for await (const [name, handle] of dir.entries()) {
  const file = await handle.getFile();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
}
```
