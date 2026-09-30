---
title: Content Security Policy for Blob Documents and Workers
description: Which contexts inherit a page's CSP, why zip.js needs `worker-src blob:`, and how SvelteKit delivers its policy.
tags: [security, csp, web-workers, iframes, sveltekit, zip]
sidebar:
  order: 2
---

Dokseo, my manga and book reader, shows each EPUB chapter as a `blob:` HTML document in an iframe, and it does its heavy work, like text recognition, in workers. A Content Security Policy (CSP) is a set of rules the browser enforces about what a page may load and run. How much a Content Security Policy is worth there depends on which of those contexts the policy actually reaches. The sanitizer layer underneath is in [DOMPurify](/security/dompurify/), and the framing side is in [iframes](/html/iframes/).

## A `blob:` document inherits the page's CSP; a worker loaded over `https:` does not

The page has a policy, and the question is whether that policy also applies inside the framed chapters and inside the workers. I measured both halves in Chromium.

**A blob document inherits.** Under a meta policy of `default-src 'none'; script-src 'self'; frame-src blob:`, I framed a `blob:` HTML document from that page. Its inline `<script>`, its `onerror=` handler and its inline `<style>` were all blocked. It behaves the same with and without `sandbox="allow-same-origin allow-scripts"`. So the top-level policy governs every framed blob document. That makes it a second layer of protection under the sanitizer that cleans each chapter's markup.

That has two consequences:

- A `securitypolicyviolation` listener installed inside a frame like that is itself an inline script, so the policy blocks it. The console is the only place you'll see a framed document's violations.
- A policy delivered as a header is inherited too, `frame-ancestors` included. `frame-ancestors 'none'` on the top document doesn't stop the app from framing its own blobs (measured). But that's the kind of thing to check before adding a header directive, not after.

**A worker does not inherit.** A dedicated module worker loaded from an ordinary same-origin `https:` URL runs with no policy at all. That's because a worker's policy comes from its own response, not from the page that started it, and nothing sets a CSP header on static worker files unless I do. From inside one, under `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`:

```text
fetch('https://cdn.jsdelivr.net/…')   ALLOWED
new Function('return 1')              ALLOWED
await import(blobUrl)                 ALLOWED
```

The same `import(blobUrl)` in the top document was blocked. Only a worker created from a local scheme inherits. Per the HTML spec, a `blob:` worker gets the policy of the environment that created the blob URL, and a `data:` worker gets its owner's.

So `connect-src`, `script-src` and `'wasm-unsafe-eval'` govern the document and have no effect on work done in a worker like that. In Dokseo, the text recognition runs in such a worker: model and runtime fetches, `WebAssembly` compilation and ONNX pthread workers all happen on the worker side. So if I drop a directive and recognition still works, that doesn't prove the directive was unnecessary. No check against it ran in the worker. And I shouldn't assume the same holds in Safari or Firefox. Of everything I measured here, that's the most likely to differ, which is a reason for the policy to still name the hosts.

## zip.js starts a worker from a blob, on the main thread

Dokseo opens zip archives, such as comic archives, with zip.js. That library starts a worker of its own, and the way it starts it determines what the policy has to allow. The default `@zip.js/zip.js` entry doesn't load a worker file (the package has one in `dist/`, used by other entry points). Instead, its `workerURI` builds the worker's source as a string, makes a `text/javascript` blob from it and calls `new Worker(URL.createObjectURL(blob))` on the main thread whenever an archive is read. That alone means `worker-src` needs `blob:`. (More on reading archives in [zip archives](/files/zip-archives/).)

It fails without an error. Say the policy leaves `blob:` out of `worker-src`. Someone opens a book and it still opens, because zip.js falls back to decompressing on the main thread. The only symptoms are a slower import and one console line. Anything that checks `worker-src` should look for that line, not for a broken screen.

Its default configuration also includes `wasmURI: './core/streams/zlib-wasm/zlib-streams.wasm'` and an AES module, used when `DecompressionStream` isn't available or an entry is encrypted. That's main-thread WebAssembly, and a reason to keep `'wasm-unsafe-eval'` in `script-src` even if normal use never gets there. How Vite bundles my own workers is in [Vite workers](/tooling/vite-workers/).

## SvelteKit's `csp` is a meta tag only when a page is prerendered

Dokseo is a SvelteKit app, and SvelteKit writes the policy for you from its `csp` config. It can deliver the policy in two ways: as a meta tag in the page's HTML, or as a response header. Which one you get depends on whether the page was prerendered. Prerendering means rendering the page to HTML at build time. `render.js` branches on `state.prerendering`. When prerendering, it adds `csp.csp_provider.get_meta()` to the head. Otherwise it sets a `content-security-policy` response header instead. `adapter-static` prerenders, so the deployed build has a meta tag. `vite preview` renders each page live, so it delivers the identical directives as a header, and there's no meta tag in view-source.

The directives are nearly the same, but the delivery isn't. A header policy applies `frame-ancestors` and `sandbox`, which CSP ignores in a meta tag. So SvelteKit's `get_meta()` leaves them (and `report-uri`) out of the meta tag completely. On a prerendered deploy, they only take effect if the host sends them as a header. And a check written as "look for the meta tag" passes on a deploy and fails on a preview, for no real reason.

To try the production setup locally, serve the build output with a static server that applies the host's `_headers` file by hand. That gets you the meta tag and the header directives together, which is what the browser will actually receive.

## References

- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
- [MDN: `worker-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src)
- [SvelteKit configuration: `csp`](https://svelte.dev/docs/kit/configuration#csp)
