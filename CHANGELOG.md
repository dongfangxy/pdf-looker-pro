# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Reduce the packaged download size (see the 1.0.0 release notes)
- Write annotations back into the PDF instead of a sidecar
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
