---
title: Transferable Objects and Structured Clone
description: How postMessage and structuredClone copy or move values, what the transfer list does to the sender, which types can be transferred, and why a Blob needs no transfer.
tags: [javascript, web-workers, images, files]
sidebar:
  order: 3
---

Everything that crosses into a worker, an iframe or `structuredClone()` goes through the structured clone algorithm. By default it copies. A **transfer list** makes it move some objects instead. The receiver gets the underlying resource, and the sender's object is left detached (emptied out). Every worker hand-off in my notes depends on which of the two happens: [transferring bitmaps](/images/transferring-bitmaps/), [OPFS writes](/storage/opfs/), the [OCR pipeline](/machine-learning/browser-ocr-pipeline/) and the [worker lifecycle](/machine-learning/worker-lifecycle/).

## Clone versus transfer

Say the main thread has 8 MB of bytes to send to a worker. Posting them copies all 8 MB, and the main thread keeps its own. Posting them with the buffer in the transfer list moves the memory instead, and the main thread's array is left empty:

```js
const bytes = new Uint8Array(8 * 1024 * 1024);

worker.postMessage(bytes);                 // copies 8 MB
worker.postMessage(bytes, [bytes.buffer]); // moves it: nothing is copied
bytes.byteLength;                          // 0
```

The transfer list only controls *how* things are sent. The objects still have to be inside the message to arrive, because the receiver only gets what's in the message. An `ArrayBuffer` that's in the transfer list but not in the message gets detached and lost.

The same thing works without a worker:

```js
const moved = structuredClone(bytes, { transfer: [bytes.buffer] });
```

The call looks different depending on the target:

- `worker.postMessage(message, transfer)` or `worker.postMessage(message, { transfer })`
- `window.postMessage(message, targetOrigin, transfer)` or `window.postMessage(message, { targetOrigin, transfer })`
- `structuredClone(value, { transfer })`

## What detaching looks like

After a transfer, the sender's object is still there, just empty. MDN says any attempt to use it will throw, but that isn't true for everything. What I checked:

- **`ArrayBuffer`**: `byteLength` is 0 and `detached` is `true`. A typed array over it has `length` 0, and reading an index silently gives `undefined`. Making a new view or calling `slice()` throws a `TypeError`. (Checked in Node 24.)
- **`ImageBitmap`**: the HTML spec makes `width` and `height` return 0. Per the spec, passing it to `drawImage()` throws `InvalidStateError`. The `postMessage` itself throws nothing, so the mistake only shows up later, as an empty image. [Transferring bitmaps](/images/transferring-bitmaps/) covers copying a bitmap before sending it, for when the caller still needs it.
- **`OffscreenCanvas`**: its context mode becomes detached.

A transfer moves ownership, and that changes who cleans up. Whatever would have cleaned the object up on the sender's side (`bitmap.close()`, a `using` block) now has nothing to clean, and the receiver has to do the cleanup. So a disposable wrapper needs a way to disarm: see [explicit resource management](/javascript/explicit-resource-management/).

## What can be transferred

MDN's list (MDN says it may not be complete):

- `ArrayBuffer`
- `MessagePort`
- `ImageBitmap`, `OffscreenCanvas`
- `ReadableStream`, `WritableStream`, `TransformStream`
- `VideoFrame`, `AudioData`
- `MediaStreamTrack`, `MediaSourceHandle`, `MIDIAccess`, `RTCDataChannel`
- `WebTransportReceiveStream`, `WebTransportSendStream`

Typed arrays and `DataView` are *not* transferable. Their `.buffer` is. `structuredClone(u8, { transfer: [u8] })` throws `DataCloneError`.

Browser support for transferring is listed per type. The ones to check: MDN lists transferable `ReadableStream` in Chrome 87, Firefox 103 and Safari 27, and transferable `WritableStream` and `TransformStream` in Chrome 87 and Firefox 103, with no Safari support.

## When a transfer throws

The HTML spec's `StructuredSerializeWithTransfer` throws `DataCloneError` when:

- something in the list is neither an `ArrayBuffer` nor a transferable platform object
- it is a `SharedArrayBuffer` (those are shared, not moved)
- the same object is listed twice
- it is already detached

It serializes the message before it transfers anything. So if a message fails to clone (say it has a function in it), it throws and nothing gets detached.

Type-specific rules from the HTML spec:

- An `ImageBitmap` that isn't origin-clean (drawn from a cross-origin image without CORS) can't be transferred.
- An `OffscreenCanvas` can only be transferred while it has no context. Call `getContext()` on the receiving side.

## `Blob` and `File` are cloned, and cloning is cheap

`Blob`, `File` and `FileSystemFileHandle` are serializable, not transferable, so they can't go in the transfer list. They don't need to. The File API's serialization steps give the clone the same underlying byte sequence and snapshot state. Nothing gets read. A `Blob` is immutable, so both sides can share its data. I measured this: posting a 400 MB `Blob` to an OPFS writer worker reads nothing into memory on the main thread ([OPFS](/storage/opfs/)).

Compare that with `FileSystemFileHandle.getFile()`, where the spec says the `File` gets "a copy of" the entry's data: see [the origin private file system](/storage/origin-private-file-system/).

## What structured clone drops

From MDN:

- Functions and DOM nodes throw `DataCloneError`.
- Class instances arrive as plain objects. The prototype chain isn't copied, and private fields are lost.
- Getters, setters and property descriptors aren't copied. An own getter's current value arrives as a plain data property, and a getter defined on a class is lost along with the prototype.
- `RegExp.lastIndex` is reset.
- Errors keep `name` and `message`. Browsers are expected to keep `stack` and `cause`.

Anything richer than plain data comes out changed or not at all, so treat a message as plain data. I send `{ kind, id, payload }` objects to workers and rebuild anything richer on the other side, and that avoids surprises.

## Browser support

MDN lists `structuredClone()` in Chrome 98, Firefox 94 and Safari 15.4. `ArrayBuffer.prototype.transfer()` and `detached` (moving a buffer within one realm) are in Chrome 114, Firefox 122 and Safari 17.4.

## References

- [MDN: Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [MDN: The structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [MDN: `structuredClone()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone)
- [HTML Standard: safe passing of structured data](https://html.spec.whatwg.org/multipage/structured-data.html#safe-passing-of-structured-data)
- [HTML Standard: `ImageBitmap`](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagebitmap)
- [HTML Standard: `OffscreenCanvas`](https://html.spec.whatwg.org/multipage/canvas.html#the-offscreencanvas-interface)
- [File API: `Blob` serialization](https://w3c.github.io/FileAPI/#blob-section)
