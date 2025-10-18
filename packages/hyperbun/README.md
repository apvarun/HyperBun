# HyperBun

HyperBun is a Bun-first HTTP helper that wraps [`Bun.serve`](https://bun.com/docs/api/http) with a small routing layer, static file helpers, and response utilities. It stays light so you can slot the pieces into an existing Bun app instead of adopting a full framework.

## Highlights
- Plain-object routing with per-method handlers while keeping Bun's native ergonomics.
- Static file serving with prefix/index support and simple cache headers.
- Response helpers (`json`, `html`, `text`) that normalise handler return values.
- Optional JSX entry point to render React pages and ship per-route hydration bundles.

## Start a New Project
```bash
mkdir my-hyperbun-app
cd my-hyperbun-app
bun init -y
bun add @hyperbun/core
```

Drop the quick-start server below into `server.ts` and launch it with `bun run server.ts` (or `bun --hot server.ts` for auto-reload). Your server is now listening on port 3000.

Need JSX pages later? Keep going with the React / JSX option section once the basics are running.

## Repository Layout
- `packages/hyperbun` (`@hyperbun/core`) – the library source. Requires Bun ≥ 3.0.0. React peer deps remain optional unless you enable the JSX runtime.
- `packages/example-basic` – a small demo that wires the primitives together.

## Local Install
```bash
bun install
```

## Build & Test (repo)
```bash
bun run build
bun test
```

## Quick Start
```ts
import { createServer, html, json } from "@hyperbun/core";

createServer({
  port: 3000,
  routes: {
    "/": () => html("<h1>Welcome to HyperBun</h1>"),
    "/api/health": () => json({ ok: true }),
  },
  static: { dir: "./public", prefix: "/public" },
  baseHeaders: { "x-powered-by": "hyperbun" },
});
```

## React / JSX Option
```ts
import { createJSXServer } from "@hyperbun/core/jsx";
import { json } from "@hyperbun/core";

await createJSXServer({
  baseDir: import.meta.dir,
  publicDir: "./public",
  pages: {
    "/": { component: "./pages/home.tsx#Home", title: "HyperBun" },
  },
  apiRoutes: {
    "/api/health": () => json({ ok: true }),
  },
});
```

`createJSXServer` renders the listed React components on the server, emits a hydration bundle per route (skippable with `hydrate: false`), and merges any `apiRoutes` you define.

## Tailwind CSS
HyperBun will automatically enable [Tailwind CSS](https://tailwindcss.com) when it detects [`bun-plugin-tailwind`](https://bun.com/docs/bundler/plugins#tailwindcss) in your project. The example under `packages/example-basic` demonstrates the setup:

1. Install the plugin and Tailwind runtime:
   ```bash
   bun add -D bun-plugin-tailwind tailwindcss
   ```
2. Register the plugin in `bunfig.toml`:
   ```toml
   [serve.static]
   plugins = ["bun-plugin-tailwind"]
   ```
3. Import Tailwind in a CSS module that ships with your JSX bundle:
   ```css
   /* src/styles/app.css */
   @import "tailwindcss";
   ```
4. Tell the JSX server to include the stylesheet in the hydration bundle:
   ```ts
   await createJSXServer({
     // …other options
     clientImports: ["./styles/app.css"],
   });
   ```

Your React pages can now use Tailwind utility classes directly. HyperBun links the generated CSS automatically in the layout when a stylesheet is emitted, and static HTML routes can opt-in with `<link rel="stylesheet" href="tailwindcss" />` as documented by Bun.

## Status
HyperBun is currently 0.x software—expect breaking changes while the API settles.

## License

MIT
