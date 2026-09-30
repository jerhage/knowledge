---
title: Where a Server, Sync and Sign-in Would Plug In
description: For a local-first app with none of them yet, where a remote source, a local-first composite, sync state, sign-in, an offline write queue and a growing read contract would each plug in.
tags: [architecture, storage]
sidebar:
  order: 11
---

A local-first app keeps its data on the device and works without a network. The [card catalog](/architecture/overview/#the-running-example) stores its cards in the browser, and [riftcards](/projects/riftcards/architecture/capabilities-and-composition/#no-server-yet) keeps everything in SQLite on the phone. Neither has a server, sync, sign-in or an offline queue. They might get some of those later.

Each one has a place where it would plug in, so that when it arrives it goes into the layer that should absorb it. None of it is a design to build against today.

## Keep the boundaries and leave out the implementations

One way to get this wrong is to design for every future case now: a sync layer, conflict types and a session object in an app that has none of them. That slows every change today and is a guess at requirements nobody has written. The other is to wait until the feature arrives and then find that transport details, loading flags and tokens have to be threaded through every screen, because nothing had a place for them.

The middle is to keep the boundaries and leave out their implementations. A domain already accesses storage through [capabilities](/architecture/capabilities/), and a screen already gets its data from one owner of the loading and the failure: a [data component](/architecture/data-components/), or a view model in the other layout. Those two boundaries are enough for everything below. I keep the smallest boundary that supports what the app does now, and change it when there's concrete evidence it isn't enough.

Before relying on a boundary, I look for code that produces it. A declaration alone isn't enough. A type can be declared, handled by every formatter and passed around everywhere, and still never be constructed. Code like that reads as working behavior and isn't.

## A remote source is another adapter

Say the card catalog starts fetching cards from a server. The cards domain already declares `CardLister`, and the local adapter implements it. A remote adapter implements the same `CardLister`.

Everything about the network lives in that adapter: the response schemas, the transport errors, retries, pagination cursors, pulling image references out of a response. The composition root is where I pick which adapter to build. The domain, its use cases and its screens have no reference to the network.

The check is simple: if a screen has to import anything about the server (a response type, an HTTP status), the transport details have leaked out of the adapter. Keeping status codes inside it takes one shared request helper, one retry rule and a short list of expected codes per operation, which is on [classifying an HTTP response without listing every code](/architecture/expected-and-unexpected-failure/#classifying-an-http-response-without-listing-every-code).

## A local-first composite repository

Local-first with a server usually means both: a local store to read from, and a remote one to sync with. That coordination is one more adapter. A composite repository implements the same capability by combining the local store, the remote source, a sync process and a queue of writes made offline.

It's the only place that has more than one source. The use case above it keeps its signature, and the domain's capability doesn't change just because what implements it grew.

## Freshness and conflicts are outcomes

Sync brings mechanics: cursors, revisions, a merge strategy, a choice between last write wins and a real merge. Those belong to the composite repository.

What a person has to see about them is different. "This list may be out of date" and "your edit conflicts with one made elsewhere" change what the screen shows or prompts for, so they're outcomes, and they enter the app as named variants:

- A freshness fact goes on the resolved value that the owner of the read passes to what it draws.
- A conflict someone has to settle goes in the use case's result, as [a named variant](/architecture/expected-and-unexpected-failure/#an-expected-failure-is-a-named-variant-of-the-return-type) (with a generic `Result`, a kind in its error union), and in the read owner's states.

Each is added on purpose and matched exhaustively. What I avoid is a `syncing` boolean or a revision number spreading through presentational components, each with its own code for what it means.

## Sign-in is a capability

Signing in, signing out and watching the session are one capability, and the signed-in person is a value that capability returns. If more than one domain needs it, it goes where ports no single domain owns live, next to the clock and the id generator. If only one domain needs it, it belongs to that domain.

Its adapter owns tokens, refresh and credentials. The composition root provides the session. A permission failure, when someone isn't allowed to do something, is an expected outcome, a variant in the use case's union beside the others. Domain rules and presentational components never read a token or reference where one is stored.

## Optimistic writes and an offline queue

An offline queue holds writes until the server can accept them. The queue, its durability and its retry policy sit behind the write capability, in the adapter.

The use case still returns one result, extended with the outcomes a deferred write really has. The pending look of a write the server hasn't acknowledged yet is execution state, like a write in progress, so it belongs to whatever owns the write: a write data component, or a write view model. That owner also reconciles or rolls back when the outcome arrives. Domain rules never branch on whether a write has been acknowledged.

## Paging and caching as the read contract grows

Cursors, page size and total counts are part of the criteria and the capability. The domain owns them and the adapter applies them, and a page is never narrowed in application code afterwards ([filter in the store](/architecture/capabilities/#filter-sort-page-and-count-in-the-store)). How long a cached result lives and when it's evicted is the adapter's business.

What reaches presentation is only what the read's owner passes it: resolved data, a paging state on the success branch, and named callbacks for loading more, refreshing and retrying. When that contract has to grow, I change one type on purpose and review it as such ([growing the contract](/architecture/data-components/#growing-the-contract)). I don't thread a new prop through the screens.
