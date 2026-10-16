# Contributing

Thanks for taking the time to look at this project. Bug reports and pull requests are
both welcome.

## Reporting a bug

Open an [issue](https://github.com/dongfangxy/pdf-looker-pro/issues/new/choose). The
template asks for the version, your Windows version, and the steps to reproduce. A
screenshot helps a great deal for anything visual.

If the problem is that a document renders wrongly, please say whether the same file
opens correctly in another reader — that separates a rendering bug from a broken file.

## Setting up

```bash
git clone https://github.com/dongfangxy/pdf-looker-pro.git
cd pdf-looker-pro
npm install
npm run fixtures
npm run dev
```

## Before opening a pull request

Run the verification suites. They drive a real browser and the packaged application,
so they catch the kind of regression that unit tests miss:

```bash
npm run build     # must type-check and bundle cleanly
npm test          # browser suites
npm run pack      # produces the portable build
npm run test:desktop   # runs the packaged build
```

A pull request that changes behaviour without a corresponding assertion in one of the
`tools/e2e-*.mjs` suites will be asked to add one. This project has already shipped
two bugs that only appeared in the packaged build, so the packaged run is not optional.

## Code style

- TypeScript, strict mode, no `any` without a comment saying why.
- Comments explain *why*, not *what*. If a line needs a comment to say what it does,
  rewrite the line.
- Keep the renderer free of Electron APIs; go through `src/platform/desktop.ts`.

## Assets

The icons and the bundled font are generated from source by `npm run assets`. Do not
add third-party artwork, fonts or interface strings: the project must stay free of
material it cannot license.

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
