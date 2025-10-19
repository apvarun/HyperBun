# create-hyperbun

Create a new [HyperBun](https://github.com/apvarun/HyperBun) project with one command.

```
npm create hyperbun@latest my-app
# or
bun create hyperbun my-app
```

The CLI scaffolds a project similar to `packages/example-basic`, including:

- TypeScript-ready Bun server that renders JSX routes through `@hyperbun/core`.
- Example React page, layout, and API routes.
- Tailwind-aware static asset pipeline wired to `bun-plugin-tailwind`.

## Commands

- `--install <bun|npm|pnpm|yarn|skip>` controls dependency installation. Defaults to detecting Bun, then npm.
- `--git` (default) initialises a Git repository. Use `--no-git` to skip.
- `--force` allows writing into a non-empty directory.
- `--template default` selects the starter template (more to come).

Run `create-hyperbun --help` for the full option list.
