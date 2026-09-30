---
title: Reader
description: A SvelteKit SPA that reads comics, PDFs and EPUBs from local storage and runs OCR in the browser; how its pages map onto the general notes.
tags: [reader, architecture, sveltekit]
sidebar:
  order: 0
---

The reader is my own app, and most of the general notes on this site came out of building it. These pages are the app itself: its real modules, names and numbers, and the bugs as they happened. Each one links to the general page that explains the idea. (Back to [all projects](/projects/).)

## What it is

A static SvelteKit SPA, built with `adapter-static` and run through Deno tasks. It reads three kinds of book:

- image books: CBZ/ZIP archives, or a folder of images dropped on the page
- PDFs, which pdf.js reads by byte range, so a big file isn't read in full up front
- EPUBs, through foliate-js

Everything stays in the browser. Book files go to OPFS, records to IndexedDB, and model weights to the Cache API. A book is identified by [KOReader's partial MD5](/files/koreader-partial-md5/), so the same book matches on a KOReader device, and a setting switches matching to the file name instead.

Selecting a region of a page runs OCR in a worker: manga-ocr for Japanese, PaddleOCR PP-OCRv5 for Korean. The default Japanese model is my own export of manga-ocr, a 123 MB one-time download. The result is a capture, which I can edit, tag and search. The general version of that path is the [browser OCR pipeline](/machine-learning/browser-ocr-pipeline/).

Screens get their data from a [TanStack Query](/svelte/svelte-query/) cache. Each read is owned by a data component, which starts it and passes the result to the components inside it, and each write is a mutation owned by a small view model ([data components and view models](/projects/dokseo/architecture/data-components-and-view-models/)). Each use case returns its own named union of the outcomes I expect, and anything unplanned throws to an error boundary ([use cases, results and failure](/projects/dokseo/architecture/use-cases-and-failure/)).

The look comes from its own design system, built the way [design system architecture](/design-systems/architecture/) describes, with eight themes.

## Screens

| Route | What it shows |
| --- | --- |
| `/` | the library: every stored book, adding books by drop or picker, title search |
| `/read/[fileId]` | one book, in the image reader or the ebook reader, with the captures panel beside it |
| `/settings` | settings, including the OCR engine page and the library settings |
| `/tags` | the tags and the captures that have them |
| `/playground` | the design system's components and tokens on one page |

## The five domains

The code is split into domains the way [the architecture notes](/architecture/overview/) describe. The details are on [the reader's domains and graph](/projects/reader/architecture/domains/).

- `library`: files, books, page sources, reading place
- `viewing`: the image reader (viewport, selection geometry, pairing, the strip)
- `flowing`: the ebook reader (EPUB through foliate-js) and its settings
- `recognition`: the recognizer, model weights, captures and tags
- `storage`: what the origin holds, part by part, and removing a book with its captures

## The pages

### Architecture

| Page | What's on it |
| --- | --- |
| [Domains and graph](/projects/reader/architecture/domains/) | the five domains, why `storage` is the one non-leaf, and the kernel contracts |
| [Container, ports and adapters](/projects/reader/architecture/wiring/) | what `container.ts` builds, the ports and adapters, per-language recognizers, workers |
| [Composing domains at the routes](/projects/reader/architecture/composing-screens/) | how the capture panel gets into both readers without an import |
| [dependency-cruiser rules](/projects/reader/architecture/dependency-rules/) | every rule with real allowed and refused imports, and the gaps |

### Design system

| Page | What's on it |
| --- | --- |
| [Themes](/projects/reader/design-system/themes/) | the eight themes, YoRHa's treatments, the theme fonts |
| [Tokens](/projects/reader/design-system/tokens/) | the reader's token values and which component reads each |
| [Components](/projects/reader/design-system/components/) | what the base library adds, component by component |
| [Reading components](/projects/reader/design-system/reading-components/) | Carousel, Dock, gestures and the marquee |
| [Utilities and layouts](/projects/reader/design-system/utilities-and-layouts/) | the reader's utilities and layout patterns |
| [Structure and guards](/projects/reader/design-system/structure-and-guards/) | the `src/lib/styles` tree and the specs that keep it honest |

### Library

| Page | What's on it |
| --- | --- |
| [Importing a book](/projects/reader/library/importing-books/) | from a dropped file to a stored book, with the hash and the cover |
| [Page sources](/projects/reader/library/page-sources/) | the `PageSource` port and its archive, PDF and EPUB adapters |
| [Reading place](/projects/reader/library/reading-place/) | what's saved as a place, "finished", links and arrivals |
| [Storage](/projects/reader/library/storage/) | OPFS, the IndexedDB databases, the Cache API, removing a book |

### Image reader

| Page | What's on it |
| --- | --- |
| [Paged viewer](/projects/reader/image-reader/paged-viewer/) | pages and spreads, zoom, touch, right-to-left |
| [Continuous strip](/projects/reader/image-reader/continuous-strip/) | the virtualized webtoon strip |
| [Reader chrome](/projects/reader/image-reader/reader-chrome/) | bars, dock, focus and the scroll lock |

### Ebook reader

| Page | What's on it |
| --- | --- |
| [Chapters](/projects/reader/ebook-reader/chapters/) | loading foliate chapters, styles, writing mode, keys |
| [Passages and highlights](/projects/reader/ebook-reader/passages-and-highlights/) | from a text selection to a passage and its highlight |

### Recognition

| Page | What's on it |
| --- | --- |
| [Pipeline](/projects/reader/recognition/pipeline/) | each OCR stage in the reader's own files |
| [Engines](/projects/reader/recognition/engines/) | manga-ocr and PaddleOCR, the model catalog, devices |
| [Model lifecycle](/projects/reader/recognition/model-lifecycle/) | consent, downloads, caching and closing a recognizer |
| [Captures](/projects/reader/recognition/captures/) | captures, tags, Undo and search |

### Engineering

| Page | What's on it |
| --- | --- |
| [Security policy](/projects/reader/engineering/security-policy/) | the CSP directives and why each is there |
| [Bundles and workers](/projects/reader/engineering/bundles-and-workers/) | what each screen downloads, and the worker entries |
| [Browser support](/projects/reader/engineering/browser-support/) | what the reader needs, and the Safari, iOS and Firefox workarounds |
| [Checks and tests](/projects/reader/engineering/checks-and-tests/) | the Deno tasks, the Vitest projects, and the probes |

## How to read these pages

Each page shows the reader's actual code and says what happened. The mechanism behind it is on the general page it links to, so I don't explain it twice.
