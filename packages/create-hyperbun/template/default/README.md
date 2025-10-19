# __APP_TITLE__

Generated with [`create-hyperbun`](https://github.com/apvarun/HyperBun/tree/main/packages/create-hyperbun).

## Scripts

- `bun install` – install dependencies.
- `bun run dev` – start the development server with hot reloading.
- `bun run build` – build static assets and compile the server output into `dist/`.
- `bun run start` – run the compiled server from `dist/`.

## Project Structure

- `src/server.ts` – HyperBun entry point that wires routes, React pages, and API handlers.
- `src/pages` – React components rendered through HyperBun's JSX runtime.
- `src/components` – Additional UI pieces (lazy loaded footer in the starter).
- `src/styles` – Tailwind-aware CSS entry imported by the hydration bundle.
- `scripts/build-assets.ts` – Generates hydration bundles and copies static assets to `dist/`.
- `public/` – Static files served through HyperBun's static middleware.

## Next Steps

1. Update copy & routes in `src/pages/home.tsx`.
2. Remove Tailwind if you do not need it (delete `src/styles/app.css` and remove the plugin in `bunfig.toml`).
3. Deploy with your favourite Bun-friendly hosting provider.
