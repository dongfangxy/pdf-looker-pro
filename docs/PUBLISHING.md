# Publishing a release

Everything needed to ship a new version, in order. The whole cycle is four commands once
the repository exists.

## First time only: create the repository and push

The repository is already initialised locally with one commit on `main`. Create the empty
GitHub repository — **do not** let GitHub add a README, licence or `.gitignore`, or the
first push will conflict — then:

```bash
cd D:/CodeX/REA/reconstruction/pdfreader
git remote add origin https://github.com/dongfangxy/pdf-looker-pro.git
git push -u origin main
```

## Every release after that

```bash
# 1. Set the version. This updates package.json and src/product.ts together, so the
#    About dialog and the packaged artefact can never disagree.
npm run version:bump 1.1.0

# 2. Build and verify. The packaged run is part of this, not optional: two bugs in 1.0.0
#    appeared only in the packaged build.
npm run build
npm run pack
npm run test:desktop

# 3. Commit and tag. The tag must match the version — the release workflow checks and
#    fails loudly if it does not.
git commit -am "Release 1.1.0"
git tag v1.1.0
git push --follow-tags
```

## What happens next

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which:

1. verifies the tag matches `package.json`,
2. builds and packages the portable executable,
3. runs the packaged verification suites,
4. publishes a GitHub Release with the artefact attached.

The release body is read from `docs/RELEASE-2.0.0.md`. When you cut a new version, copy
that file to `docs/RELEASE-<version>.md`, update it, and point `body_path` in the workflow
at the new file.

Every push to `main` also runs `.github/workflows/ci.yml`, which builds, regenerates the
assets and fails if they are not reproducible, runs all browser suites, packages the app
and runs the packaged suites.

## Before tagging, check

- [ ] `npm test` passes
- [ ] `npm run pack && npm run test:desktop` passes
- [ ] `CHANGELOG.md` has an entry for the new version
- [ ] `docs/RELEASE-<version>.md` exists and the workflow points at it
- [ ] `README.md` and `README.zh-CN.md` agree with each other

## A note on the download size

The 2.0.0 build is about 108 MB, almost entirely the Electron runtime. Reducing it is the
first roadmap item; `docs/RELEASE-2.0.0.md` lists the specific opportunities and how much
each is expected to save. Record the new size in the changelog when it changes, so the
trend is visible.
