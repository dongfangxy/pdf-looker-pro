# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Annotations are written into the PDF itself.** A self-authored incremental
  writer appends objects to the original file, adds a new cross-reference section
  with a `/Prev` pointer, and rewrites only the page dictionaries that gained
  annotations. The original bytes are never touched, so a reader that does not
  understand the new section still sees a valid document.
- **PDF annotations are read back on open.** A file that already carries markup
  shows it straight away, editable, with colours, line styles, text sizes and text
  preserved. Both directions are implemented without a third-party PDF library.
- `Ctrl+S` now writes into the PDF. The sidecar save moved to `Ctrl+Shift+S`.

### Changed

- **Save is one action again.** The separate "write into PDF" verb is gone: `Ctrl+S`
  now writes the annotations back into the file that is open, overwriting it in place
  with no dialog. A file that refuses the write falls back to Save As.
- **`Ctrl+Z` undoes and `Ctrl+Shift+Z` redoes** annotation changes. Rapid edits such
  as a drag coalesce into one step, so one undo reverses the whole gesture.
- **The sidebar toggle moved into Settings**, along with the status bar. `Ctrl+B`
  still works for readers who know it.
- The toolbar save button is a floppy disk, as tradition demands.

### Notes

- An encrypted document is refused rather than written to; the security handler is
  not implemented.
- Text boxes store their text in full and ask for Helvetica, so another reader
  without a matching glyph falls back to a substitute font. This reader is exact.
- Repeated saves append another section each time. The file stays valid, and a PDF
  optimiser will compact it.

### Planned

- Reduce the packaged download size (see the 1.0.0 release notes)
- Polyline measurement for irregular shapes
- An installer, in addition to the portable build

## [1.0.0] - 2026-02-14

First public release.

### Added

- **Reading** — continuous, single-page, two-page and full-screen view modes over a
  virtualised renderer; text layer with selection and copy; find with match
  highlighting; fit-width, fit-page, free zoom and `Ctrl` + wheel; 90° rotation;
  outline, thumbnails and an annotation list in a collapsible sidebar.
- **Appearance** — light, dark, sepia and high-contrast themes; Chinese and English
  language packs, switchable at runtime.
- **Annotations** — highlight, underline, strikeout, freehand ink, sticky note,
  rectangle, ellipse, arrow, text box and callout.
- **Annotation editing** — selection under any tool, drag to move, in-place text
  editing, and boxes that fit their own content unless you size them by hand.
- **Styling** — adjustable colour, line style, line width and text size, applied to
  the selection or to the next annotation, plus named style presets.
- **Measurement** — distance, perimeter and area, in millimetres, centimetres,
  inches or points, honouring each page's `/UserUnit`.
- **Multiple documents** — tabbed sessions, each keeping its own scroll position,
  zoom and annotations.
- **Customisable toolbar** — every command is listed in the *More* menu with a tick
  box that puts it on the bar.
- **Export** — the current page as an image, annotations as JSON or `.arpk`.
- **Desktop shell** — native menu, recent files and window geometry, all restored
  between launches.
- **Original assets** — an icon set and a text font produced for this project, packed
  into a self-authored resource container.

### Known limitations

- Annotations are not written back into the PDF; they live in a `.arpk` sidecar.
- Windows portable build only; no installer and no code signing.
- Measurement covers two-point distance and rectangular perimeter/area only.
- No forms, digital signatures or OCR.

[Unreleased]: https://github.com/dongfangxy/pdf-looker-pro/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/dongfangxy/pdf-looker-pro/releases/tag/v1.0.0
