---
title: The Reader's Content Security Policy
description: "Which directives the reader sets and why each is there: blob chapters, zip.js's blob worker, WASM, self-hosted fonts, header vs meta delivery, and the COOP/COEP pair."
tags: [reader, security, csp, iframes, web-workers, sveltekit]
sidebar:
  order: 70
---

The reader's policy comes from SvelteKit's `csp` config plus a `static/_headers` file for the deploy. Which contexts a policy reaches at all (blob documents yes, `https:` workers no) is on [CSP for blob documents and workers](/security/csp-blobs-and-workers/). This page is what that means for the reader's own directives.

## What each directive is there for

| Directive | Why the reader needs it |
| --- | --- |
| `blob:` frames | Every EPUB chapter is a `blob:` document that foliate-js puts in an iframe, so the policy has to let the page frame blobs. |
| `worker-src blob:` | zip.js starts its worker from a blob on the main thread whenever an archive is read. That's the only reason. I'd assumed it was ONNX, and it isn't: the OCR workers are ordinary files. |
| `script-src 'wasm-unsafe-eval'` | zip.js's fallback path compiles WebAssembly on the main thread (its zlib streams and AES module, used when `DecompressionStream` is missing or an entry is encrypted). Nothing I've done in the app has reached it yet, but I keep it. |
| `script-src` hash | The pre-paint theme script in `app.html`. It lists the theme names, so adding a theme changes the script and its hash (see [themes](/projects/reader/design-system/themes/)). |
| `font-src 'self' blob: data:` | Every theme face is self-hosted under `/fonts/`. Nothing loads from a font CDN. |
| `connect-src` naming the hosts | Model and runtime fetches happen inside workers, which the document's policy doesn't govern (below). The policy names the hosts anyway. |
| `frame-ancestors` | Set as a header in `static/_headers`, because a meta tag can't set it. |

## Chapters: the second layer under DOMPurify

Chapters go through DOMPurify first (how, in [ebook chapters](/projects/reader/ebook-reader/chapters/) and [DOMPurify](/security/dompurify/)). The CSP is the second layer, because a chapter blob inherits the page's policy. I measured that with a strict test policy, `default-src 'none'; script-src 'self'; frame-src blob:`: a framed `blob:` document had its inline `<script>`, its `onerror=` handler and its inline `<style>` all refused, with and without foliate's `sandbox="allow-same-origin allow-scripts"`. Under the reader's own policy, an inline script or handler that got past the sanitizer is still refused, since `script-src` allows no inline code. An inline style isn't, because the reader's `style-src` includes `'unsafe-inline'`.

Two things follow for the reader. A `securitypolicyviolation` listener inside a chapter is an inline script too, so it gets blocked, and the console is the only place a chapter's violations show up. And `frame-ancestors 'none'` in the header doesn't stop the app from framing its own chapter blobs. I measured that in Chromium, but it's the kind of thing I'd check again before adding any other header directive.

## The OCR workers run with no policy

The OCR worker is a dedicated module worker at `/_app/immutable/workers/ocr.worker-*.js`, a plain same-origin `https:` URL. Nothing sets a CSP header on that file, so it runs with no policy at all. Inside it, a fetch to a CDN, `new Function` and `import(blobUrl)` all went through, while the same `import(blobUrl)` in the top document was blocked.

So in the reader, `connect-src`, `script-src` and `'wasm-unsafe-eval'` govern the document and say nothing about the OCR pipeline. Every model and runtime fetch, every `WebAssembly` compilation and every ONNX pthread worker is on the worker side. "OCR still works" doesn't prove a directive is unnecessary. I measured this in Chromium only, and it's the result most likely to differ in Safari or Firefox, which is why the policy still names the hosts.

zip.js's worker is the exception. It comes from a `blob:` URL the page created, so it gets the page's policy. The zip.js package does ship a worker file (`dist/zip-web-worker.js`), but the default entry I use builds its worker from a string instead.

If `worker-src` ever blocks that blob, books still open. zip.js falls back to decompressing on the main thread, so the only signs are a slower import and one console line. A check on `worker-src` should look for that line, not a broken screen.

## Meta tag on the deploy, header on the preview

`adapter-static` prerenders, so the deployed build has the policy as a meta tag. `npm run preview` renders each page live, so SvelteKit sends the same directives as a response header and no meta tag shows up in view-source. SvelteKit leaves `frame-ancestors`, `sandbox` and `report-uri` out of the meta tag, because a meta policy ignores them. That's why `frame-ancestors` lives in `static/_headers`. The details are in [SvelteKit's CSP is a meta tag only when a page is prerendered](/security/csp-blobs-and-workers/#sveltekits-csp-is-a-meta-tag-only-when-a-page-is-prerendered).

So a check that looks for the meta tag passes on a deploy and fails on a preview. To see what the browser will really get, I serve `build/` with a static server that applies `static/_headers` by hand. That gives the meta tag and the `frame-ancestors` header together.

## COOP and COEP

`static/_headers` also sets COOP and COEP, so the page is cross-origin isolated and `SharedArrayBuffer` exists for WASM threads. That's a fact about the headers, and nothing more. The `Uint8Array` versus `BufferSource` type error I hit is a TypeScript 5.9 lib change and shows up whether the app is isolated or not (see [`Uint8Array` does not fit `BufferSource`](/typescript/type-checking-techniques/#uint8array-does-not-fit-buffersource-since-typescript-59)).

## No SVG reaches the DOM

EPUB covers can be SVG. The import rasterizes every cover to a WebP before storing it (see [importing a book](/projects/reader/library/importing-books/)), so no SVG ever reaches the DOM or the store, and covers need no CSP reasoning. Even an SVG in an `<img>` runs in secure animated mode, with no scripts and no external fetches ([image formats](/images/image-formats/#createimagebitmap-will-not-decode-an-svg-blob-and-an-img-that-will-loads-nothing-external)).
