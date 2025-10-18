import { json } from "@hyperbun/core";
import { createJSXServer, resolveJSXRuntimeEnvironment, type JSXServerOptions } from "@hyperbun/core/jsx";

const PUBLIC_PREFIX = "/public" as const;

export function createExampleJSXOptions(moduleExtension: string, baseDir: string, publicDir: string): JSXServerOptions {
  const extension = moduleExtension.startsWith(".") ? moduleExtension : `.${moduleExtension}`;
  const toModule = (relative: string) => `./${relative}${extension}`;

  return {
    baseDir,
    publicDir,
    publicPrefix: PUBLIC_PREFIX,
    pages: {
      "/": {
        component: toModule("pages/home"),
        title: "HyperBun Example",
        hydrate: ({ url }) => url.searchParams.get("hydrate") !== "0",
      },
    },
    notFoundPage: {
      component: toModule("pages/not-found"),
      title: "Not Found",
      hydrate: false,
      getProps: ({ url }) => ({ path: url.pathname }),
    },
    layout: toModule("layout"),
    clientImports: ["./styles/app.css"],
  };
}

async function bootstrap() {
  const port = Number(Bun.env.PORT ?? 3000);
  const runtime = resolveJSXRuntimeEnvironment(import.meta.dir);

  const sharedConfig = createExampleJSXOptions(
    runtime.moduleExtension,
    runtime.baseDir,
    runtime.publicDir,
  );

  const server = await createJSXServer({
    port,
    ...sharedConfig,
    publicPrefix: PUBLIC_PREFIX,
    skipClientBuild: runtime.skipClientBuild,
    baseHeaders: {
      "x-powered-by": "hyperbun-example",
    },
    apiRoutes: {
      "/api/time": () => json({ now: new Date().toISOString() }),
      "/api/echo": {
        POST: async ({ json: parse }) => {
          const body = await parse<{ message?: string }>();
          return json({ echoed: body?.message ?? null }, { status: 201 });
        },
      },
    },
  });

  console.log(`[example-basic] listening on ${server.url}`);
}

if (import.meta.main) {
  await bootstrap();
}

export { PUBLIC_PREFIX };
