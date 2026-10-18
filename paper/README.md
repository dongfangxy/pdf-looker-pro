# Paper: PDF Looker Pro

A systems paper describing the application, its PDF writers and the verification methodology.

## Files

| Path | Purpose |
|---|---|
| `main.tex` | Root document: preamble, title, abstract, `\input` of each section |
| `sections/01-intro.tex` … `sections/09-discussion.tex` | Body, one file per section |
| `sections/11-bibliography.tex` | Inline bibliography (no BibTeX pass) |
| `figures/screenshot.png` | Figure 2, captured with `tools/make-screenshots.mjs` |
| `metrics/results.json` | Per-suite assertion counts, from `tools/collect-metrics.mjs` |
| `metrics/benchmark.json` | Timings, from `tools/benchmark.mjs` |

## Build

Two `pdflatex` passes; nothing else is required and there is no BibTeX step.

```powershell
cd paper
pdflatex -interaction=nonstopmode main.tex
pdflatex -interaction=nonstopmode main.tex
```

The last build produced 15 pages with no overfull boxes and no undefined references.

## Every number in the paper

The measurements are reproducible, and the scripts refuse to invent a value:

```powershell
# 31 suites, assertion counts written to paper/metrics/results.json
node tools/collect-metrics.mjs

# timings, written to paper/metrics/benchmark.json
# (requires the preview server: npx vite preview --port 4173)
node tools/benchmark.mjs
```

Line counts, bundle sizes and dependency versions were read from the working tree at the
commit the paper describes; the tables state the commit.

## Submitting to arXiv

The submission is a LaTeX upload. arXiv compiles it with its own TeX Live, so the source
archive must contain everything `main.tex` reaches and nothing it does not.

1. Build the archive (from the repository root):

   ```powershell
   cd paper
   tar -a -c -f arxiv-submission.zip main.tex sections figures
   ```

   `pdflatex` artefacts (`.aux`, `.log`, `.out`) and `preview/` must not be included; the
   command above lists only the three directories the document needs.

2. Metadata to enter on arXiv:

   - **Title** — `PDF Looker Pro: an open-source annotating PDF reader and document editor`
   - **Authors** — `Chengxi Zhang` (Jiangnan University, Wuxi 214122, China;
     ORCID 0000-0002-3130-6497; https://dongfangxy.github.io/)
   - **Primary category** — `cs.SE` (Software Engineering)
   - **Cross-list** — `cs.HC` (Human-Computer Interaction)
   - **Comments** — `15 pages, 5 tables, 2 figures. Source code and verification suites:
     https://github.com/dongfangxy/pdf-looker-pro`
   - **Licence** — arXiv's non-exclusive licence, or CC BY 4.0 if preferred. The *software*
     is MIT; the paper's licence is a separate choice.
   - **Abstract** — copy from `main.pdf`, or from `main.tex` between `\begin{abstract}` and
     `\end{abstract}` (strip the LaTeX).

3. Check the compiled PDF arXiv produces against the local one. arXiv's editor is not
   identical to a local TeX Live install; a difference usually means a package is missing
   from the archive.

## Two build dependencies worth knowing

**CJK.** The author name and one personal name in the acknowledgements are typeset with
`CJKutf8` and the `gbsn` font, which ships in TeX Live's `arphic` package
(`collection-langchinese`). A full TeX Live installation has it; arXiv's does. If a minimal
installation lacks it, the build still succeeds with a font-substitution warning and the
characters render; if they do not, the only CJK in the document is those two names and they
can be replaced with their pinyin.

**No other dependency.** No BibTeX pass, no shell escape, no external tool.

## Disclosure

The Acknowledgements state that the software and this preprint were developed with the
assistance of DeepSeek AI and DSH (DeepSeek Harness), that this is the reason the software is
released as open source in full, and that the authors thank 梁圣人 (Liang Shengren) and this
era. The disclosure is deliberate and should not be edited out before submission: a reader is
entitled to know how a document was produced.

## What the paper does and does not claim

It claims: the design of the writers, the invariants they satisfy, the verification
methodology and the measured size, cost and defect record.

It does not claim: a new algorithm, ISO conformance, a rendering-quality comparison against
other readers, or test coverage as a percentage. `sections/08-evaluation.tex` states the
threats to validity and `sections/09-discussion.tex` lists the known limitations.
