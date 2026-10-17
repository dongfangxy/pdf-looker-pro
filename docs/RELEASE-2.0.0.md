# PDF Looker Pro 2.0.0

Released 2026-10-18. This release closes the four tiers of work that were planned after
1.0.0, and fixes a defect in how saved annotations were handled.

## The annotation defect, and what it was

Annotations are written into the PDF itself rather than into a sidecar, which is what
makes them visible to other readers. That writer is an incremental update: it appends
objects and rewrites the page dictionaries that gained annotations.

It appended **without removing what it had written before**. Two consequences, both of
them visible to a reader:

- **A deleted annotation came back.** Removing an annotation from the list and saving
  left the original object in `/Annots`, so the mark survived every save. Once bitten,
  there was no way to get it out of the file short of a different editor.
- **Every save duplicated every annotation.** Each save appended a fresh copy of
  everything on the page and listed both. The copies sit exactly on top of each other,
  so the page looked right, but the file grew and the reader could end up selecting one
  copy while deleting the other — which reads as "the delete does nothing".

The writer now takes the object numbers it produced last time, drops them from the
page's `/Annots`, and appends the current set. A page whose annotations were all deleted
is still rewritten, because that is the only way its `/Annots` stops pointing at them.

Interoperability is unchanged: everything written is still a standard annotation object,
and objects left behind by earlier saves are harmless orphans rather than live marks.

`tools/e2e-save-reopen.mjs` pins this down: save two, reopen, click one (it selects),
save twice more (the file still points at two), delete one, save, reopen (only the other
remains), delete the last, save, reopen (the file points at nothing).

## The four tiers

**A — the reader.** Continuous, single, facing and facing-continuous views; actual size,
fit width, fit page and fit visible area; zoom-to dialogue; previous/next view on
`Alt`+arrows; a magnifier read from the rendered page; printing with a page range, scale
and orientation; go-to-page; rotating.

**B — document editing.** A whole-document rewrite that rebuilds the page tree, copies
every object and recomputes the cross-reference. On top of it: rotate, delete, insert,
insert blank pages, extract, crop and reorder page ranges; new blank documents; documents
from an image; and **merging another PDF in**, which copies a second object graph with
every reference renumbered.

**C — annotation depth.** Six standard stamps written as `/Stamp`; the typewriter and
callout text tools under the names the original product uses; **replace text**, which
strikes a selection and carries its substitute; flattening annotations into the page;
summarising the annotated pages into a new document; measurement labels; a named author
on every annotation (`/T`); replies as `/IRT` annotations; and form fields tinted so a
reader can see where a form asks for input.

**D — search.** A results panel grouped by page with the words around each match, folder
search across a whole tree of PDFs, and saved searches that re-run in one click.

## Verification

Every tier was required to pass `npm run build` and real assertions in a browser and in
the packaged application before being called done.

- `npm test` — 729 assertions across 27 suites, 0 failures
- `npm run test:desktop` — 26 + 21 + 8 assertions against the packaged build, 0 failures

## Known limitations

- No installer and no code signing. The portable executable will trigger a SmartScreen
  warning; the only fix is a code-signing certificate.
- Encrypted PDFs are refused for writing.
- Repeated saves grow the file. The incremental update never rewrites the whole document,
  so superseded objects stay behind as orphans.
- Flattening cannot encode text outside Latin-1, because the embedded font is Helvetica.
- Form fields are highlighted but **not fillable**; there is no form layer.
- FreeText annotations ask for Helvetica, so a reader without it may substitute a font.
- The desktop suite's window-geometry assertion is stateful: it can fail when several
  suites run back to back with the process killed between them, and pass on its own.
