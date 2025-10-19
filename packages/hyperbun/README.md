# HyperBun

_Bun-native HTTP primitives with optional React hydration and zero-framework lock-in._

HyperBun wraps [`Bun.serve`](https://bun.com/docs/api/http) with a tiny routing layer, static file helpers, and JSX tooling so you can compose your own stack instead of adopting a monolithic framework.

## Why HyperBun?
- **Plain-object routing** – Declare routes as nested objects or per-method tables (`GET`, `POST`, `ALL`) while keeping Bun's Serve ergonomics.
- **Static assets with guardrails** – Prefix/index support, path sanitisation, cache headers, and HEAD handling out of the box.
- **Response normalisation** – Return primitives, JSON-like objects, streams, Bun files, or a `Response` and HyperBun will set sensible defaults.
- **Opt-in React runtime** – `createJSXServer` renders React pages, ships one hydration bundle per route, and merges APIs alongside HTML routes.
- **Tailwind-aware** – Detects `bun-plugin-tailwind` automatically and links generated CSS without manual wiring.
- **Zero runtime surprises** – Everything compiles down to Bun API calls, so debugging stays familiar.

## Install
```bash
bun add @hyperbun/core
```

> Peer dependencies: Bun ≥ 1.2.3. React/ReactDOM stay optional unless you use the JSX runtime.

### Requirements
- Bun runtime `>= 1.2.3` (required for `Bun.serve`, `Bun.build`, and TypeScript transpilation).
- TypeScript `^5` if you rely on type checking or emit declarations during CI.
- React and ReactDOM `>= 18` only when using `@hyperbun/core/jsx`.

## Quick Taste
```ts
import { createServer, html, json } from "@hyperbun/core";

createServer({
  port: 3000,
  routes: {
    "/": () => html("<h1>Hello from HyperBun</h1>"),
    "/api/health": () => json({ ok: true }),
    "/notes": {
      GET: ({ json }) => json({ notes: [] }),
      POST: async ctx => {
        const body = await ctx.json<{ note: string }>();
        return json({ created: body.note }, { status: 201 });
      },
    },
  },
  static: { dir: "./public", prefix: "/assets", maxAge: 86400 },
  baseHeaders: { "x-powered-by": "hyperbun" },
  onError: (error, ctx) => {
    console.error("Route failure:", error, ctx.url.pathname);
    return html("<h1>Something went wrong</h1>", { status: 500 });
  },
});
```

Run it with `bun --hot server.ts` for rapid feedback while developing.

## Routing Model
- **Route table** – Supply a plain object where keys are path patterns understood by Bun (e.g. `/users/:id`). Values can be a handler, a method table, or a pre-built `Response`.
- **Method tables** – Use `{ GET, POST, ALL }` to differentiate per-method logic. Unsupported methods return `405` with an automatic `Allow` header.
- **Context helpers** – Every handler receives `{ request, url, params, server, locals, json, text, formData }`.
  - `locals` is a fresh object per request for per-request state.
  - `json()`, `text()`, `formData()` proxy Bun's request helpers with inferred types.
- **Response helpers** – `json`, `html`, and `text` set content types automatically. Any handler return value is normalised (numbers, booleans, `Bun.file`, `ReadableStream`, etc.).
- **Error & 404 handling** – Provide `onError` for global error recovery and `notFound` for unmatched routes. Both receive the same context shape and may return anything a normal handler can.
- **Base headers** – `baseHeaders` inject default headers for every response unless the handler overrides them.

### createServer Options At-A-Glance
- `routes`: Record of path patterns to handlers, method tables, or `Response` objects.
- `static`: Single config or array. Each entry supports `{ dir, prefix?, index?, maxAge? }`.
- `notFound`: Handler or `Response` for unmatched routes.
- `onError`: `(error, ctx) => Response` for centralised error handling.
- `baseHeaders`: Headers applied to every outgoing response unless already set.
- Plus all native `Bun.serve` options (`hostname`, `port`, TLS keys, etc.).

## Static Assets
```ts
createServer({
  static: [
    { dir: "./public", prefix: "/public", index: "index.html", maxAge: 3600 },
    { dir: "./uploads", prefix: "/uploads" },
  ],
});
```
- Requests outside the configured directories are rejected to prevent path traversal.
- `GET` and `HEAD` are supported; HEAD skips reading the file body.
- Detected MIME types are applied automatically and `Cache-Control` is derived from `maxAge`.

## React / JSX Runtime
```ts
import { createJSXServer } from "@hyperbun/core/jsx";
import { json } from "@hyperbun/core";

await createJSXServer({
  baseDir: import.meta.dir,
  publicDir: "./public",
  pages: {
    "/": { component: "./pages/home.tsx#Home", title: "HyperBun" },
    "/about": {
      component: "./pages/about.tsx#AboutPage",
      title: ctx => `About – ${ctx.url.host}`,
      getProps: () => ({ features: ["routing", "hydration"] }),
    },
  },
  apiRoutes: {
    "/api/health": () => json({ ok: true }),
  },
  clientImports: ["./styles/app.css"],
  notFoundPage: { component: "./pages/404.tsx#NotFound", title: "Not Found" },
});
```

What you get:
- Per-route server rendering with optional client hydration (`hydrate: false` to ship static HTML).
- Automatic client bundles written beneath `<publicDir>/<prefix>` (defaults to `/public`) and cached in `.hyperbun`.
- Layout overrides via the `layout` option or default HTML shell.
- Optional JSX fallback page for unmatched routes.
- Skip bundle generation with `HYPERBUN_SKIP_CLIENT_BUILD=1` (useful for tests).
- Additional static configs merge seamlessly with generated assets.

### Tailwind, styles, and assets
If your project registers `bun-plugin-tailwind`, HyperBun will:
1. Detect the plugin during bundle generation.
2. Import Tailwind output and expose asset URLs automatically.
3. Attach discovered stylesheets to the rendered document.  

Spin up `packages/example-basic` for a full working reference.

## Working in This Repo
- `packages/hyperbun` (this package) contains the source; the published build lives in `dist/`.
- `packages/example-basic` showcases the routing and JSX runtime together.
- Shared tooling (TypeScript configs, linting, bun workspace setup) lives at the repository root to keep package-level configs minimal.

### Install & Develop
```bash
bun install
bun --filter @hyperbun/core run build   # compile TypeScript + Bun bundle
bun --filter example-basic run dev      # run the example project
```

### Build & Test
```bash
bun run build
bun test
```

## Troubleshooting
- **Hydration bundle not updating?** Delete `.hyperbun` (inside `public/..`) and rerun the JSX server; stale cache files are regenerated automatically.
- **Tailwind styles missing?** Confirm `bunfig.toml` lists `bun-plugin-tailwind` under `[serve.static]` and that your `clientImports` references the CSS entry.
- **React not found errors?** Install `react` and `react-dom` as dependencies or disable hydration with `hydrate: false`.
- **Custom headers ignored?** Ensure you mutate headers on the returned `Response` before returning it; `baseHeaders` only fills in missing keys.
- **TypeScript emits failing builds?** Run `bun run build` once before publishing to ensure both `bun build` and `tsc` succeed; they output into `dist/` which is the only published directory.

## Status
HyperBun is currently `0.x`; expect breaking changes while the API settles.

## License
MIT © HyperBun contributors
