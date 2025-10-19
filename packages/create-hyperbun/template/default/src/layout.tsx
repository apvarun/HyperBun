import type { HyperBunLayoutProps } from "@hyperbun/core/jsx";
import { HyperBunHydrationScripts } from "@hyperbun/core/jsx";

const Layout = ({
  title,
  route,
  hydrate,
  scriptPath,
  styleHrefs,
  serializedProps,
  children,
}: HyperBunLayoutProps) => {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {styleHrefs?.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body
        data-hyperbun-route={route}
        data-hydrated={hydrate ? "pending" : "static"}
        className="min-h-screen bg-black text-gray-100 antialiased"
      >
        <header className="border-b border-gray-800 bg-black">
          <nav className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-4 text-sm text-gray-300">
            <a className="font-semibold text-white transition hover:text-gray-100" href="/">
              __APP_TITLE__
            </a>
            <div className="flex items-center gap-4">
              <a className="transition hover:text-gray-100" href="/public/index.html">
                Static asset
              </a>
              <a className="transition hover:text-gray-100" href="/api/time">
                API demo
              </a>
            </div>
            <span className="hidden text-xs font-medium uppercase tracking-wide text-gray-400 sm:inline-flex">
              Tailwind enabled
            </span>
          </nav>
        </header>
        <div data-hyperbun-root>{children}</div>
        <HyperBunHydrationScripts
          hydrate={hydrate}
          route={route}
          scriptPath={scriptPath}
          serializedProps={serializedProps}
        />
      </body>
    </html>
  );
};

export default Layout;
