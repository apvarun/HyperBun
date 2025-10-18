import type { BunFile, BunRequest, Serve, Server } from "bun";
import path from "path";

type NativeServer = Server<unknown>;

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export type HandlerResult =
  | Response
  | string
  | number
  | bigint
  | boolean
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream
  | Blob
  | BunFile
  | null
  | undefined
  | Record<string, unknown>;

export type Handler<TPath extends string = string> = (
  ctx: HyperContext<TPath>,
) => HandlerResult | Promise<HandlerResult>;

export type MethodTable<TPath extends string = string> = Partial<
  Record<HttpMethod | "ALL", Handler<TPath> | Response>
>;

export type RouteEntry<TPath extends string = string> =
  | Handler<TPath>
  | MethodTable<TPath>
  | Response;

export type RouteTable<TPath extends string = string> = Record<TPath, RouteEntry<TPath>>;

export interface StaticConfig {
  /** Directory on disk to read files from */
  dir: string;
  /** Optional URL prefix, defaults to "/" */
  prefix?: string;
  /** File served for directory matches, defaults to "index.html" */
  index?: string;
  /** Cache-Control max-age in seconds */
  maxAge?: number;
}

export interface HyperContext<TPath extends string = string> {
  request: BunRequest<TPath>;
  url: URL;
  params: BunRequest<TPath>["params"];
  server: NativeServer;
  locals: Record<string, unknown>;
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
  formData(): Promise<FormData>;
}

export interface HyperServerOptions
  extends Omit<Serve.Options<unknown, string>, "routes" | "fetch"> {
  routes?: RouteTable;
  static?: StaticConfig | StaticConfig[];
  notFound?: Handler | Response;
  onError?: (error: unknown, ctx: HyperContext) => Response | Promise<Response>;
  baseHeaders?: HeadersInit;
}

const METHODS: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
] as const;

const EMPTY_HEADERS = new Headers();

type NativeRouteHandler = (
  request: BunRequest<string>,
  server: NativeServer,
) => Response | Promise<Response>;

type NativeRoutes = Record<string, NativeRouteHandler>;

export function createServer(options: HyperServerOptions): NativeServer {
  const {
    routes,
    static: staticDefs,
    notFound,
    onError,
    baseHeaders,
    ...serveOptions
  } = options;

  const localsFactory = () => Object.create(null) as Record<string, unknown>;
  const staticHandlers = buildStaticHandlers(staticDefs);

  let serverRef: NativeServer | undefined;

  const mappedRoutes = routes
    ? mapRoutes(routes, () => {
        if (!serverRef) {
          throw new Error("HyperBun server reference not initialised yet");
        }
        return serverRef;
      }, localsFactory, baseHeaders, onError)
    : undefined;

  const fetchHandler = async (request: Request, serverInstance: NativeServer) => {
    serverRef = serverInstance;
    const url = new URL(request.url);

    for (const handler of staticHandlers) {
      const staticResponse = await handler(request, url, baseHeaders);
      if (staticResponse) return staticResponse;
    }

    if (notFound) {
      const ctx = createContext(
        request as BunRequest<string>,
        serverInstance,
        localsFactory(),
      );
      try {
        const response = await resolveEntry(notFound, ctx, baseHeaders);
        if (response) return response;
      } catch (error) {
        if (onError) {
          const recovery = await handleError(onError, error, ctx, baseHeaders);
          if (recovery) return recovery;
        }
        logError(error);
        return applyBaseHeaders(
          new Response("Internal Server Error", { status: 500 }),
          baseHeaders,
        );
      }
    }

    return applyBaseHeaders(
      new Response("Not Found", { status: 404 }),
      baseHeaders,
    );
  };

  const bunOptions = {
    ...(serveOptions as Serve.Options<unknown, string>),
    fetch: fetchHandler,
  } as Serve.Options<unknown, string>;

  if (mappedRoutes) {
    bunOptions.routes = mappedRoutes as unknown as Serve.Routes<unknown, string>;
  }

  const server = Bun.serve(bunOptions);

  if (!serverRef) {
    serverRef = server;
  }

  return server;
}

export function json<T>(payload: T, init?: ResponseInit): Response {
  return Response.json(payload, init);
}

export function html(body: string, init?: ResponseInit): Response {
  const response = new Response(body, init);
  if (!response.headers.has("Content-Type")) {
    response.headers.set("Content-Type", "text/html; charset=utf-8");
  }
  return response;
}

export function text(body: string, init?: ResponseInit): Response {
  const response = new Response(body, init);
  if (!response.headers.has("Content-Type")) {
    response.headers.set("Content-Type", "text/plain; charset=utf-8");
  }
  return response;
}

function mapRoutes(
  routes: RouteTable,
  getServer: () => NativeServer,
  localsFactory: () => Record<string, unknown>,
  baseHeaders: HeadersInit | undefined,
  onError: HyperServerOptions["onError"],
): NativeRoutes {
  const mapped: NativeRoutes = {};
  for (const [pattern, entry] of Object.entries(routes)) {
    mapped[pattern] = createRouteHandler(
      entry,
      pattern,
      getServer,
      localsFactory,
      baseHeaders,
      onError,
    );
  }
  return mapped;
}

function createRouteHandler(
  entry: RouteEntry,
  pattern: string,
  getServer: () => NativeServer,
  localsFactory: () => Record<string, unknown>,
  baseHeaders: HeadersInit | undefined,
  onError: HyperServerOptions["onError"],
): NativeRouteHandler {
  if (entry instanceof Response) {
    return () => cloneResponse(entry, baseHeaders);
  }

  if (typeof entry === "function") {
    return (request, server) =>
      executeHandler(entry, request, server, localsFactory(), baseHeaders, onError);
  }

  if (entry && typeof entry === "object") {
    const table = normaliseMethodTable(entry);
    const allowHeader = [...table.allowed].join(", ");

    return async (request, server) => {
      const method = request.method.toUpperCase() as HttpMethod;
      const selected = table.methods.get(method) ?? table.methods.get("ALL");
      if (!selected) {
        const res = new Response("Method Not Allowed", {
          status: 405,
          headers: allowHeader ? { Allow: allowHeader } : undefined,
        });
        return applyBaseHeaders(res, baseHeaders);
      }

      if (selected instanceof Response) {
        return cloneResponse(selected, baseHeaders);
      }

      return executeHandler(
        selected,
        request,
        server,
        localsFactory(),
        baseHeaders,
        onError,
      );
    };
  }

  throw new TypeError(`Unsupported route entry for pattern "${pattern}"`);
}

function normaliseMethodTable(entry: MethodTable) {
  const methods = new Map<HttpMethod | "ALL", Handler | Response>();
  const allowed = new Set<HttpMethod>();

  for (const key of Object.keys(entry)) {
    const methodKey = key.toUpperCase();
    if (methodKey === "ALL") {
      const value = entry[key as keyof MethodTable];
      if (value) methods.set("ALL", value);
      continue;
    }

    if (METHODS.includes(methodKey as HttpMethod)) {
      const value = entry[key as keyof MethodTable];
      if (value) {
        methods.set(methodKey as HttpMethod, value);
        allowed.add(methodKey as HttpMethod);
      }
      continue;
    }

    throw new TypeError(`Unsupported HTTP method key "${key}"`);
  }

  return { methods, allowed };
}

async function executeHandler(
  handler: Handler,
  request: BunRequest,
  server: NativeServer,
  locals: Record<string, unknown>,
  baseHeaders: HeadersInit | undefined,
  onError: HyperServerOptions["onError"],
): Promise<Response> {
  const ctx = createContext(request, server, locals);

  try {
    const result = await handler(ctx);
    return normaliseResponse(result, baseHeaders);
  } catch (error) {
    if (onError) {
      const recovery = await handleError(onError, error, ctx, baseHeaders);
      if (recovery) {
        return recovery;
      }
    }

    logError(error);
    return applyBaseHeaders(
      new Response("Internal Server Error", { status: 500 }),
      baseHeaders,
    );
  }
}

function createContext(
  request: BunRequest,
  server: NativeServer,
  locals: Record<string, unknown>,
): HyperContext {
  const url = new URL(request.url);
  return {
    request,
    url,
    params: request.params ?? (Object.create(null) as Record<string, string>),
    server,
    locals,
    json: <T>() => request.json() as Promise<T>,
    text: () => request.text(),
    formData: () => request.formData() as Promise<FormData>,
  };
}

async function resolveEntry(
  entry: Handler | Response,
  ctx: HyperContext,
  baseHeaders: HeadersInit | undefined,
): Promise<Response> {
  if (entry instanceof Response) {
    return cloneResponse(entry, baseHeaders);
  }
  const result = await entry(ctx);
  return normaliseResponse(result, baseHeaders);
}

async function handleError(
  onError: NonNullable<HyperServerOptions["onError"]>,
  error: unknown,
  ctx: HyperContext,
  baseHeaders: HeadersInit | undefined,
): Promise<Response | null> {
  try {
    const result = await onError(error, ctx);
    if (result) {
      return applyBaseHeaders(result, baseHeaders);
    }
    return null;
  } catch (secondary) {
    logError(secondary);
    return applyBaseHeaders(
      new Response("Internal Server Error", { status: 500 }),
      baseHeaders,
    );
  }
}

function normaliseResponse(
  result: HandlerResult,
  baseHeaders: HeadersInit | undefined,
): Response {
  if (result instanceof Response) {
    return applyBaseHeaders(result, baseHeaders);
  }

  if (result === undefined || result === null) {
    const res = new Response(null, { status: 204 });
    return applyBaseHeaders(res, baseHeaders);
  }

  if (typeof result === "string") {
    return applyBaseHeaders(new Response(result), baseHeaders);
  }

  if (
    typeof result === "number" ||
    typeof result === "boolean" ||
    typeof result === "bigint"
  ) {
    return applyBaseHeaders(new Response(String(result)), baseHeaders);
  }

  if (isBinaryLike(result)) {
    return applyBaseHeaders(new Response(result as BodyInit), baseHeaders);
  }

  if (result && typeof result === "object") {
    return applyBaseHeaders(Response.json(result), baseHeaders);
  }

  return applyBaseHeaders(new Response(String(result)), baseHeaders);
}

function isBinaryLike(value: unknown): value is BodyInit {
  return (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof Blob ||
    value instanceof ReadableStream
  );
}

function applyBaseHeaders(
  response: Response,
  baseHeaders: HeadersInit | undefined,
): Response {
  if (!baseHeaders) return response;
  const base = new Headers(baseHeaders);
  base.forEach((value, key) => {
    if (!response.headers.has(key)) {
      response.headers.set(key, value);
    }
  });
  return response;
}

function cloneResponse(
  response: Response,
  baseHeaders: HeadersInit | undefined,
): Response {
  try {
    const cloned = response.clone();
    return applyBaseHeaders(cloned, baseHeaders);
  } catch {
    // Final fallback – consume to arrayBuffer and create a new Response
    return applyBaseHeaders(
      new Response(response.body, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      }),
      baseHeaders,
    );
  }
}

type StaticHandler = (
  request: Request,
  url: URL,
  baseHeaders: HeadersInit | undefined,
) => Promise<Response | null>;

function buildStaticHandlers(
  staticDefs: HyperServerOptions["static"],
): StaticHandler[] {
  if (!staticDefs) return [];
  const defs = Array.isArray(staticDefs) ? staticDefs : [staticDefs];
  return defs.map(def => createStaticHandler(def));
}

function createStaticHandler(config: StaticConfig): StaticHandler {
  const root = path.resolve(config.dir);
  const prefix = sanitisePrefix(config.prefix ?? "/");
  const trimmedPrefix = prefix === "/" ? "/" : prefix.slice(0, -1);
  const indexFile = config.index ?? "index.html";
  const maxAge = config.maxAge;

  return async (request, url, baseHeaders) => {
    if (request.method !== "GET" && request.method !== "HEAD") return null;

    let relative: string | null = null;
    if (prefix === "/") {
      relative = url.pathname.length > 1 ? url.pathname.slice(1) : "";
    } else if (url.pathname.startsWith(prefix)) {
      relative = url.pathname.slice(prefix.length);
    } else if (url.pathname === trimmedPrefix) {
      relative = "";
    } else {
      return null;
    }

    const decoded = decodeURIComponent(relative);
    const targetPath = await resolveStaticPath(root, decoded, indexFile);
    if (!targetPath) return null;

    const file = Bun.file(targetPath);
    if (!(await file.exists())) return null;

    const headers = new Headers(baseHeaders ?? EMPTY_HEADERS);
    if (file.type) headers.set("Content-Type", file.type);
    if (typeof maxAge === "number") {
      headers.set("Cache-Control", `public, max-age=${Math.max(0, maxAge)}`);
    }
    headers.set("Content-Length", file.size.toString());

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }

    return new Response(file, { status: 200, headers });
  };
}

async function resolveStaticPath(
  root: string,
  relative: string,
  indexFile: string,
): Promise<string | null> {
  const safeRelative = normaliseRelativePath(relative);
  const primary = path.resolve(root, safeRelative);

  if (!isWithin(root, primary)) return null;

  const file = Bun.file(primary);
  if (await file.exists()) return primary;

  const withIndex = path.resolve(primary, indexFile);
  if (!isWithin(root, withIndex)) return null;
  const indexCandidate = Bun.file(withIndex);
  if (await indexCandidate.exists()) {
    return withIndex;
  }

  return null;
}

function normaliseRelativePath(relative: string): string {
  const segments = relative.split("/");
  const safe: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      safe.pop();
      continue;
    }
    safe.push(segment);
  }
  return safe.join(path.sep);
}

function sanitisePrefix(prefix: string): string {
  if (!prefix.startsWith("/")) prefix = `/${prefix}`;
  if (!prefix.endsWith("/")) prefix = `${prefix}/`;
  return prefix;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function logError(error: unknown) {
  if (error instanceof Error) {
    console.error(error.message);
    if (error.stack) console.error(error.stack);
    return;
  }
  console.error(error);
}
