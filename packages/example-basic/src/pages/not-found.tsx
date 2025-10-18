interface NotFoundProps {
  path: string;
}

const NotFound = ({ path }: NotFoundProps) => (
  <main className="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center gap-6 border border-gray-800 bg-black px-8 py-16 text-gray-100">
    <h1 className="text-5xl font-black tracking-tight text-white">404</h1>
    <p className="text-lg text-gray-300">
      Sorry, we could not find{" "}
      <code className="bg-gray-900 px-2 py-1 font-medium text-gray-200">
        {path}
      </code>
      .
    </p>
    <p className="text-base text-gray-300">
      Go back{" "}
      <a
        href="/"
        className="font-semibold text-gray-200 underline decoration-gray-500 underline-offset-4 hover:text-white"
      >
        home
      </a>
      .
    </p>
  </main>
);

export default NotFound;
