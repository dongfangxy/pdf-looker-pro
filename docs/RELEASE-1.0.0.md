# PDF Looker Pro 1.0.0

**Released 2026-02-14** · [Download `PDFLookerPro-portable.exe`](https://github.com/dongfangxy/pdf-looker-pro/releases/tag/v1.0.0)

The first public release. A desktop PDF reader with a from-scratch interface:
virtualised continuous scrolling, ten annotation types with in-place editing,
distance/perimeter/area measurement, named style presets, multi-document tabs and a
toolbar you can shape yourself. Chinese and English, four themes.

`352` automated assertions pass against the browser build and the packaged
application.

---

## About the download size

**The portable build is about 108 MB. This is larger than it should be, and reducing it
is the first item on the roadmap for the next release.**

To be clear about where the weight is, and where it is not:

| Part | Approximate size |
| --- | --- |
| Electron runtime (Chromium + Node) | ~105 MB |
| This project's own code and assets | well under 1 MB |

The application itself is small. Almost everything in the download is the runtime it
is built on, which is the usual cost of shipping a web-technology desktop application.
It is not an accident or a mistake in this repository, but it is also not something to
leave alone.

### Where the reduction will come from

These are the concrete opportunities, in the order they are worth trying:

1. **Prune the runtime's unused locales and resources.** Electron ships translations
   and helper binaries for every locale and several integration paths this application
   never touches. Excluding the unused ones is the single largest and least risky win.
2. **Recompress the ASAR and the executable.** The current build stores both with
   default settings; a higher compression level costs only build time.
3. **Ship a lighter packaging target.** The portable build is a self-extracting
   archive that carries a full copy of the runtime. An NSIS or 7z-based package, or a
   plain unpacked folder, can be materially smaller for the same functionality.
4. **Trim the renderer bundle.** `pdf.js` is bundled in full. A build restricted to
   the features actually used would cut a few hundred kilobytes, and is worth doing
   for tidiness even though it is not where the megabytes are.
5. **Consider a non-Electron shell** for a future major version. The renderer is
   already isolated behind `src/platform/desktop.ts`, so the interface layer could be
   replaced without touching the viewer.

Items 1 and 3 together should bring the download down substantially. Progress will be
recorded in the [changelog](../CHANGELOG.md).

---

## What is in this release

### Reading

- Continuous, single-page, two-page and full-screen view modes
- Virtualised rendering: only pages near the viewport are drawn
- Text layer with selection and copy
- Find with match highlighting (`Ctrl+F`)
- Fit width, fit page, free zoom, `Ctrl` + wheel
- 90° rotation
- Outline, thumbnails and an annotation list
- Light, dark, sepia and high-contrast themes
- Chinese and English, switchable at runtime
- Multiple documents in tabs, each keeping its own state

### Annotating

- Ten types: highlight, underline, strikeout, freehand ink, sticky note, rectangle,
  ellipse, arrow, text box, callout
- Selection under any tool; the toolbar returns to the pointer after creating
- Drag to move, with a visible frame and a corner grip
- Double-click to edit text in place — no dialog
- Boxes that fit their content, unless you size them by hand
- Adjustable colour, line style, line width and text size
- Named style presets

### Measuring

- Distance, perimeter and area, drawn on the page
- Millimetres, centimetres, inches or points, honouring `/UserUnit`

### Everything else

- A toolbar every command can be added to, from the *More* menu
- Export the current page as an image, or annotations as JSON or `.arpk`
- Native menu, recent files and window geometry, restored between launches

---

## Known limitations

- **Annotations are not written back into the PDF.** There is no PDF writer here;
  annotations live in a `.arpk` sidecar, so other readers will not see them.
- **Windows portable build only.** No installer, and the binary is not code-signed,
  so Windows SmartScreen will warn on first run.
- **Measurement covers two-point distance and rectangular perimeter/area.** Polyline
  measurement of irregular shapes is not implemented.
- **No forms, digital signatures or OCR.**
- The bundled font covers Latin and CJK and carries no hinting or kerning.

## Verification

Every feature was verified by running the application, not by asserting against mocks.
Twelve suites drive a headless browser and the packaged Electron binary:

```
352 assertions, 0 failures
```

Two bugs in this release were found only in the packaged build, which is why the
packaged run is part of the standard test procedure rather than an optional extra.
