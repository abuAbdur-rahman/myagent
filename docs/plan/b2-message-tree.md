# Plan: B2 message tree

Status: slice 1. Target 0.12.0. Owner decisions 2026-11-08.

Scope: replace the flat message list with a parent/child tree so edit and
regenerate keep the old answer, and a version switcher can move between siblings.
`branchFrom` stays a separate chat fork; it is not replaced by this.

## Decisions

- Delete removes the message and its descendants only. Siblings and their
  replies stay. Deleting the active leaf moves the leaf to its parent.
- Edit and regenerate insert siblings. No row is overwritten or deleted.
- Existing chats backfill as one chain by `created_at`, then `id`.
- The visible thread is the path from the current leaf to the root.
- Slice 1 changes no user-visible behavior.

## Slices

1. Schema and write links. Migration 35 adds `messages.parent_id` and
   `conversations.current_leaf_id`, backfills a single chain and the last leaf.
   `addMessage` and `insertMessageFull` accept a parent and move the leaf;
   branch, import, delete, truncate and clear keep the leaf consistent. Exit:
   migration test backfills an old chat; import remaps parents; no dangling
   leaf. Reads stay flat, so behavior does not change.
2. Read path and write path. `src/lib/message-tree.ts` adds path, ordering and
   sibling helpers; `listMessages` returns the path for the current leaf;
   regenerate and edit insert siblings and update the leaf. Exit: helper tests
   cover path and cycle guard; edit and regenerate never delete a row; a reload
   shows the same thread.
3. Switcher. Sibling arrows on a message with more than one version, persisted
   leaf, A12 actions rewired. Exit: switching matches switching after reload.
4. Invariants. Subtree delete, export/import preserve `parent_id` and the leaf,
   branch clone copies the tree, compaction respects `summary_through` after a
   switch. Exit: round trip and delete tests.

## Constraints

- `message_fts` is trigger-maintained; `parent_id` is not indexed.
- The export schema already carries `parentId` and `childrenIds`; keep the shape.
- Do not change `summary_through` semantics inside a slice; compaction uses
  message ids as a cutoff.
