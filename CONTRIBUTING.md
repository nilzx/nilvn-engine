# Contributing

Thanks for your interest. This repository is the public half of NilVN: the
runtime (`@nilvn/engine`), the contract layer (`@nilvn/core`) and the plugin SDK
(`@nilvn/plugin-sdk`). The editor that produces games for it is closed source,
so a change here is judged against what that editor and the games it exports
rely on.

## Before opening a pull request

- Open an issue first for anything beyond a small fix, so the change can be
  discussed.
- For a bug, include the engine version, a minimal script (or `nilvn.json`
  package) that shows it, and the diagnostics you got (`engine.diagnostics`).

## Working in the repository

Node 22 or newer and pnpm 11.

```bash
pnpm install
pnpm test              # vitest across the three packages, including a boot of the built IIFE
pnpm typecheck         # every package
pnpm typecheck:test    # the test suites themselves
pnpm build             # dist/ for the three packages
pnpm spec:check        # the generated plugin contract matches its source
pnpm pack:smoke        # pack the tarballs and consume them from a throwaway project
```

CI runs exactly these. A pull request should keep them green and come with a
test for what it changes.

## Ground rules

- **Content never throws.** A bad line, a missing plugin or a broken package is
  a diagnostic and play degrades around it; only host programming errors throw.
- **Plugins see capabilities, never the engine or the DOM.** When something a
  plugin needs is missing, the fix is a new capability in the engine and the
  spec, not an import that reaches around the boundary.
- `packages/engine/docs/` is the public reference — keep it in step with the
  code. `plugin-spec.json` and the SDK template are generated: run
  `pnpm --filter @nilvn/plugin-sdk spec:gen` after changing the contract.
- Code, comments, documentation and commit messages are English.

## Releases

`pnpm version:set engine x.y.z` sets the shared version (three `package.json`
files and `packages/engine/src/version.ts`); pushing the tag `engine-vx.y.z`
publishes the three packages to npm.
