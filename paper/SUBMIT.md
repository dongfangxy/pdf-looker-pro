# Submitting this paper to arXiv

Everything below is ready to paste. The upload is `arxiv-submission.zip` in this directory.

The one thing this sheet cannot do for you is make the licence choice and accept the
submission agreement. arXiv's own licence page is explicit about why: *"the submitter must
certify that they have the right to grant that license"* and *"The license chosen is
irrevocable and cannot be changed."* That is your act as the author, not a formality a tool
can tick.

## 1. Upload the archive

| Step | Value |
|---|---|
| Start | <https://arxiv.org/submit> → **Start New Submission** |
| File | `paper/arxiv-submission.zip` (110 kB, LaTeX source) |
| Format | LaTeX, not PDF — arXiv compiles it with its own TeX Live, so the source is preferred and the archive was verified to build from an empty directory |

Expected result: arXiv compiles 15 pages. If it reports errors, the cause is almost always
a missing file in the archive; re-create it with

```powershell
cd paper
tar -a -c -f arxiv-submission.zip main.tex sections figures
```

## 2. Metadata

**Title**

```
PDF Looker Pro: an open-source annotating PDF reader and document editor
```

**Authors**

```
Chengxi Zhang
```

(ORCID, if arXiv offers the field: `0000-0002-3130-6497`. Affiliation: Jiangnan University,
Wuxi 214122, China.)

**Abstract** — plain text, 274 words, in `paper/abstract.txt`. It is the same text as the
PDF's abstract with the LaTeX markup removed.

**Comments**

```
15 pages, 2 figures, 5 tables. Source code and verification suites:
https://github.com/dongfangxy/pdf-looker-pro
```

**Primary category**

```
cs.SE  — Computer Science > Software Engineering
```

**Cross-list**

```
cs.HC  — Human-Computer Interaction
```

**Journal reference / DOI / ACM class** — leave empty. This is a preprint of no accepted
journal version.

## 3. Licence — your decision, with the options

arXiv offers six, listed at <https://info.arxiv.org/help/license/index.html>. The choice is
permanent and cannot be revised for a given version.

| Option | What it means here |
|---|---|
| **CC BY 4.0** (recommended) | Anyone may reuse with attribution, including commercially. Most publishers accept a CC BY preprint; the software is MIT, so this is the closest match in spirit. |
| arXiv perpetual non-exclusive | arXiv may distribute; everyone else needs permission. Choose this if a funder or journal requires a licence arXiv does not list — you then state that licence on the paper's first page. |
| CC BY-SA 4.0 | As CC BY, but adaptations must carry the same licence. |
| CC BY-NC-SA / CC BY-NC-ND | Non-commercial, and ND forbids derivatives. Publishers often prefer ND for accepted manuscripts. |
| CC Zero | You give up copyright entirely. Incompatible with most publishers. |

If the paper is intended for a specific journal, check that journal's preprint policy first:
several allow CC BY, some require the arXiv licence plus an embargo.

## 4. Two things that may stop the submission

**Endorsement.** A first submission in a category can require an endorsement code from an
established author in that category. If arXiv asks, the submission cannot proceed until you
have one — this is a property of your account's history, not of the paper.

**Moderation.** Submissions are announced only after moderation, typically a day or two. A
paper describing a single piece of software may attract a question about research
contribution; `sections/08-evaluation.tex` and the abstract are written to answer it
(invariants, verification methodology, measured costs), and the acknowledgements disclose
how the work was produced.

## 5. After it is announced

- Add the arXiv identifier to the repository's `README.md` and to `docs/RELEASE-2.0.0.md`.
- arXiv assigns a DOI of the form `10.48550/arXiv.XXXX.XXXXX`; it is citable immediately.

## Files

| File | Use |
|---|---|
| `arxiv-submission.zip` | upload this |
| `abstract.txt` | paste into the abstract field |
| `main.pdf` | the local build, for comparison against arXiv's compiled PDF |
| `metrics/` | the measurements the paper reports, for anyone who asks |
