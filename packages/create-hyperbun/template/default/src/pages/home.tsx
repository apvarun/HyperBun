import { Suspense, lazy, useState } from "react";

const Footer = lazy(() => import("../components/footer"));

const Home = () => {
  const [count, setCount] = useState(0);

  return (
    <Suspense
      fallback={
        <div className="grid min-h-[40vh] place-items-center text-gray-500">
          Loading interface…
        </div>
      }
    >
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-8 py-12 text-gray-100">
        <header className="border border-gray-800 bg-black px-10 py-12 shadow-lg shadow-black/40">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
            HyperBun + Tailwind
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl text-white">
            Welcome to __APP_TITLE__
          </h1>
          <p className="mt-4 text-lg text-gray-300">
            Server render by default, hydrate when you need to. Toggle hydration with{" "}
            <code className="bg-gray-900 px-2 py-1 font-medium text-gray-200">
              ?hydrate=0
            </code>
            .
          </p>
        </header>

        <section className="grid gap-6 border border-gray-800 bg-black/90 p-8 shadow-xl shadow-black/40 lg:grid-cols-2">
          <article className="flex flex-col gap-4">
            <h2 className="text-2xl font-semibold text-white">Explore the starter</h2>
            <p className="text-gray-300">
              Try the{" "}
              <a
                className="font-medium text-gray-200 underline decoration-gray-500 hover:text-white"
                href="/api/time"
              >
                /api/time
              </a>{" "}
              endpoint, POST to{" "}
              <code className="bg-gray-900 px-2 py-1 font-medium text-gray-200">
                /api/echo
              </code>
              , or visit the{" "}
              <a
                className="font-medium text-gray-200 underline decoration-gray-500 hover:text-white"
                href="/public/index.html"
              >
                static asset
              </a>{" "}
              bundled by HyperBun.
            </p>
          </article>

          <div className="flex flex-col items-start gap-4 border border-gray-800 bg-black/95 p-6">
            <h3 className="text-lg font-semibold">Interactive counter</h3>
            <p className="text-sm text-gray-400">
              Demonstrates SSR + hydration using Tailwind styled components.
            </p>
            <button
              type="button"
              onClick={() => setCount((value) => value + 1)}
              className="inline-flex items-center gap-2 border border-gray-700 bg-gray-900 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-black/40 transition hover:bg-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500"
            >
              Count: {count}
            </button>
          </div>
        </section>

        <Footer />
      </main>
    </Suspense>
  );
};

export default Home;
