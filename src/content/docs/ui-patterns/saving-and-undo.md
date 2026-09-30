---
title: "Saving, Failing and Undoing"
description: "Closing editors only on success, removal snapshots for Undo, restoring snapshots rather than inverse actions, put-backs that restore only the taken row, and quiet failure toasts."
tags: [ui-patterns, storage, accessibility, error-handling]
sidebar:
  order: 1
---

A write to browser storage can fail, so the UI has to show what actually got saved, not what was attempted. The storage side is on [IndexedDB](/storage/indexeddb/).

## Keep an editor open until the storage outcome is known

In my reader, a capture has a text and a note, and each has an editor. Saving an edit writes it to storage. I had an editor that closed before its write finished. When the write was refused, the draft was lost. When the write was skipped, it showed the new text anyway. In both cases, the screen and storage disagreed, and the editor was already gone. The fix: have the save return `'saved' | 'failed'`, apply the text only after the write succeeds, and close the editor only on `'saved'`.

The rule: an editor holding unsaved input closes on success, never before. Same for a settings or confirm modal. If its action fails, keep it open and show the failure inside it.

## A removal snapshot is the hook for Undo

My reader shows a list of captures, and each one is a record in storage. Removing a capture takes it off the list and deletes the record, and Undo has to bring back both. When you remove an item from a list, take a snapshot `{ item, stored, at }` (the item, whether storage held it, and its index). Then a put-back function can restore it at that index.

- If the removal fails in storage, the snapshot alone is enough, because storage still has the record.
- Undo after a removal that did reach storage also writes the record back first, with the store's `put`. So the id, notes, tags and creation time come back unchanged.
- Undo writes before it shows the item. If that write fails, the item stays out and the UI shows an error.
- Only put the item back into the list if the list is still on the same generation the removal ran in (the same book, the same view). Someone removes a capture, opens a different book, then presses Undo. The list on screen now belongs to the other book, so the capture mustn't appear in it. That late Undo still restores storage, and the item shows up the next time that list loads.

## An Undo toast restores the snapshot, not the inverse action

My library can mark a book finished, and a toast then shows an Undo button. The obvious way to implement Undo is to run the opposite action. But the action that looks like the opposite often does more than undo. "Mark unread" isn't the inverse of "mark finished" if it also resets the reading place to the start. Undo should keep the record as it was before the action, and write back exactly the fields the action changed. That way both directions end up exactly where they started.

- Only show a toast like this when the action visibly changed what's on screen (the item dropped out of the current filter).
- Give Undo toasts a limited lifetime (about 10 s). Otherwise an action toast never times out, and results nobody acts on shouldn't pile up.
- Pause the timer on hover and focus, so it doesn't run out while someone is reaching for the button.

Toasts that have to work while a modal is open must render inside it: see [the top layer](/html/top-layer/#a-toast-above-a-modal-must-live-inside-the-modal).

## A put-back restores only the row the write took

The same idea applies to an optimistic write over a cached list, like the list of captures. With TanStack Query, the write removes the capture from the cached list before the storage write finishes, so the screen updates right away. If the write then fails, the capture has to come back.

TanStack's own example does that by saving the whole previous list before the write and restoring it in `onError`. That's wrong as soon as two writes overlap. Say someone removes a capture and then clears the rest, and the removal fails after the clear went through. Restoring the snapshot taken before the removal brings back every row the clear had just removed. A clear that fails after another write has the same problem the other way around.

So a put-back restores only what its own write took out: the one removed row, put back into the cache (`cache.put(row)`), or for a clear, the cleared rows placed ahead of any rows created since. Then the write invalidates the list in `onSettled`, which runs whatever the outcome, so the cache ends up at what storage holds, whatever order the writes finished in. The cache side is on [svelte-query v6](/svelte/svelte-query/).

## One toast for a run of failed background saves

Some background saves run on every interaction, like saving the reading place on every page turn. If the save fails, that would add a `role="alert"` toast on every failure: someone keeps reading, and a new alert appears with every page they turn. Show a toast for the first failure in a run, then stay quiet until a save succeeds or the context changes.
