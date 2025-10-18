import { mkdir, readdir, stat, copyFile } from "node:fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import type { BunPlugin } from "bun";

import {
  createServer,
  html,
  type Handler,
  type HyperContext,
  type HyperServerOptions,
  type RouteTable,
  type StaticConfig,
} from "./core";

interface ComponentReference {
  modulePath: string;
  exportName: string;
}

type ComponentSpec =
  | string
  | ComponentType<any>
  | { module: string; export?: string }
  | { component: ComponentType<any>; module?: string; export?: string };

interface NormalizedComponent {
  reference?: ComponentReference;
  component?: ComponentType<any>;
}

export interface JSXPage {
  /** Path to the module exporting the React component. Relative to {@link JSXServerOptions.baseDir}. */
  component: ComponentSpec;
  /** Name of the page used in the document `<title>`. */
  title: string | ((ctx: HyperContext) => string | Promise<string>);
  /** Optional function returning props passed to the component. */
  getProps?: (ctx: HyperContext) => unknown | Promise<unknown>;
  /** Whether the page should hydrate on the client. Defaults to `true`. */
  hydrate?: boolean | ((ctx: HyperContext) => boolean | Promise<boolean>);
}

export interface JSXServerOptions
  extends Omit<HyperServerOptions, "routes" | "static" | "notFound"> {
  /** Directory used to resolve relative component imports. Usually `import.meta.dir`. */
  baseDir: string;
  /** Directory that exposes client assets (used for the hydration bundle). */
  publicDir: string;
  /** URL prefix for the public directory. Defaults to `/public`. */
  publicPrefix?: string;
  /** All JSX-backed pages indexed by route path. */
  pages: Record<string, JSXPage>;
  /** Additional HTTP routes (e.g. JSON APIs) merged with the page handlers. */
  apiRoutes?: RouteTable;
  /** Optional additional static file configuration merged with the generated one. */
  static?: StaticConfig | StaticConfig[];
  /** Output filename (without extension) for the hydration bundle. Defaults to `hyperbun-client`. */
  clientFileName?: string;
  /** Additional module specifiers imported only in the hydration bundle (e.g. global styles). */
  clientImports?: string[];
  /** Skip building the hydration bundle. Useful for tests. */
  skipClientBuild?: boolean;
  /** Directory used to store generated sources. Defaults to `<publicDir>/../.hyperbun`. */
  cacheDir?: string;
  /** Optional JSX definition used when no route matches. */
  notFoundPage?: JSXPage;
  /** Optional layout component overriding the default HTML shell. */
  layout?: ComponentSpec;
}

export interface HyperBunLayoutProps {
  title: string;
  route: string;
  hydrate: boolean;
  scriptPath: string;
  styleHrefs?: readonly string[];
  serializedProps?: string;
  children: ReactNode;
}

export interface HyperBunHydrationScriptsProps {
  hydrate: boolean;
  route: string;
  scriptPath: string;
  serializedProps?: string;
}

const DEFAULT_CLIENT_FILENAME = "hyperbun-client";
const NOT_FOUND_KEY = "__hyperbun_not_found__";

const BUN_EXTERNAL_DEPENDENCIES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react-dom/server",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
] as const;

interface JSXPreparationResult {
  prefix: string;
  scriptHref: string;
  styleHrefs: string[];
  descriptors: Record<string, NormalizedComponent>;
  bundleDescriptors: Record<string, ComponentReference>;
  layoutDescriptor?: NormalizedComponent;
  notFoundDescriptor?: NormalizedComponent;
  staticEntries: StaticConfig | StaticConfig[];
}

interface PrepareJSXInput {
  pages: Record<string, JSXPage>;
  baseDir: string;
  publicDir: string;
  publicPrefix: string;
  clientFileName: string;
  layout?: ComponentSpec;
  notFoundPage?: JSXPage;
  static?: StaticConfig | StaticConfig[];
}

export interface JSXHydrationBuildOptions
  extends Pick<
    JSXServerOptions,
    | "pages"
    | "baseDir"
    | "publicDir"
    | "publicPrefix"
    | "clientFileName"
    | "clientImports"
    | "cacheDir"
    | "notFoundPage"
    | "layout"
  > {}

export interface JSXStaticAssetOptions extends JSXHydrationBuildOptions {
  componentOutDir: string;
  moduleExtension?: string;
  staticSourceDir?: string;
}

export interface JSXRuntimeEnvironment {
  moduleExtension: string;
  baseDir: string;
  publicDir: string;
  skipClientBuild: boolean;
  isBundledOutput: boolean;
}

export interface JSXRuntimeEnvironmentOptions {
  bundleDirName?: string;
  sourcePublicDir?: string;
  bundlePublicDir?: string;
  skipEnvFlag?: string;
}

export async function createJSXServer(options: JSXServerOptions) {
  const {
    pages,
    baseDir,
    publicDir,
    publicPrefix = "/public",
    apiRoutes,
    static: userStatic,
    clientFileName = DEFAULT_CLIENT_FILENAME,
    clientImports: clientImportsList = [],
    skipClientBuild = Bun.env.HYPERBUN_SKIP_CLIENT_BUILD === "1",
    cacheDir = path.resolve(publicDir, "..", ".hyperbun"),
    notFoundPage,
    layout,
    ...rest
  } = options;

  const prepared = prepareJSXEnvironment({
    pages,
    baseDir,
    publicDir,
    publicPrefix,
    clientFileName,
    layout,
    notFoundPage,
    static: userStatic,
  });

  if (!skipClientBuild) {
    prepared.styleHrefs = await buildClientBundle(
      prepared.bundleDescriptors,
      publicDir,
      cacheDir,
      clientFileName,
      prepared.prefix,
      baseDir,
      clientImportsList,
    );
  } else {
    prepared.styleHrefs = await discoverClientStyleAssets(publicDir, prepared.prefix, clientFileName);
  }

  const componentCache = new Map<string, ComponentType<any>>();
  const getLayout = createLayoutLoader(prepared.layoutDescriptor, componentCache);

  const pageHandlers: RouteTable = {};
  for (const [route, descriptor] of Object.entries(prepared.descriptors)) {
    const page = pages[route];
    if (!page) {
      throw new Error(`No page configuration found for route "${route}"`);
    }
    pageHandlers[route] = createPageHandler({
      routeKey: route,
      descriptor,
      hydrate: page.hydrate,
      scriptHref: prepared.scriptHref,
      styleHrefs: prepared.styleHrefs,
      getProps: page.getProps,
      getTitle: page.title,
      componentCache,
      getLayout,
    });
  }

  const combinedRoutes = {
    ...(apiRoutes ?? {}),
    ...pageHandlers,
  } satisfies RouteTable;

  let notFoundHandler: Handler | undefined;
  if (prepared.notFoundDescriptor && notFoundPage) {
    notFoundHandler = createPageHandler({
      routeKey: NOT_FOUND_KEY,
      descriptor: prepared.notFoundDescriptor,
      hydrate: notFoundPage.hydrate,
      scriptHref: prepared.scriptHref,
      styleHrefs: prepared.styleHrefs,
      getProps: notFoundPage.getProps,
      getTitle: notFoundPage.title,
      componentCache,
      getLayout,
    });
  }

  return createServer({
    ...rest,
    routes: combinedRoutes,
    static: prepared.staticEntries,
    ...(notFoundHandler ? { notFound: notFoundHandler } : {}),
  });
}

export async function buildJSXHydrationBundle(options: JSXHydrationBuildOptions) {
  const {
    pages,
    baseDir,
    publicDir,
    publicPrefix = "/public",
    clientFileName = DEFAULT_CLIENT_FILENAME,
    clientImports: clientImportsList = [],
    cacheDir = path.resolve(publicDir, "..", ".hyperbun"),
    notFoundPage,
    layout,
  } = options;

  const prepared = prepareJSXEnvironment({
    pages,
    baseDir,
    publicDir,
    publicPrefix,
    clientFileName,
    layout,
    notFoundPage,
    static: undefined,
  });

  await buildClientBundle(
    prepared.bundleDescriptors,
    publicDir,
    cacheDir,
    clientFileName,
    prepared.prefix,
    baseDir,
    clientImportsList,
  );
}

export async function buildJSXStaticAssets(options: JSXStaticAssetOptions) {
  const {
    pages,
    baseDir,
    publicDir,
    publicPrefix = "/public",
    clientFileName = DEFAULT_CLIENT_FILENAME,
    clientImports: clientImportsList = [],
    cacheDir = path.resolve(publicDir, "..", ".hyperbun"),
    notFoundPage,
    layout,
    componentOutDir,
    moduleExtension = ".js",
    staticSourceDir,
  } = options;

  const prepared = prepareJSXEnvironment({
    pages,
    baseDir,
    publicDir,
    publicPrefix,
    clientFileName,
    layout,
    notFoundPage,
    static: undefined,
  });

  const normalizedExt = moduleExtension.startsWith(".") ? moduleExtension : `.${moduleExtension}`;
  const compiled = new Set<string>();
  const tasks: Promise<void>[] = [];

  const schedule = (reference?: ComponentReference) => {
    if (!reference) return;
    if (compiled.has(reference.modulePath)) return;
    compiled.add(reference.modulePath);
    const relative = path.relative(baseDir, reference.modulePath);
    const outputRelative = replaceExtension(relative, normalizedExt);
    const outfile = path.join(componentOutDir, outputRelative);
    tasks.push(buildSingleModule(reference.modulePath, outfile));
  };

  for (const descriptor of Object.values(prepared.descriptors)) {
    schedule(descriptor.reference);
  }

  schedule(prepared.layoutDescriptor?.reference);
  schedule(prepared.notFoundDescriptor?.reference);

  if (staticSourceDir) {
    await copyStaticDirectory(staticSourceDir, publicDir);
  }

  await Promise.all(tasks);
  await buildClientBundle(
    prepared.bundleDescriptors,
    publicDir,
    cacheDir,
    clientFileName,
    prepared.prefix,
    baseDir,
    clientImportsList,
  );
}

function prepareJSXEnvironment(input: PrepareJSXInput): JSXPreparationResult {
  const {
    pages,
    baseDir,
    publicDir,
    publicPrefix,
    clientFileName,
    layout,
    notFoundPage,
    static: userStatic,
  } = input;

  if (!pages || Object.keys(pages).length === 0) {
    throw new Error("createJSXServer requires at least one page definition");
  }

  const prefix = normalizePrefix(publicPrefix);
  const scriptHref = `${prefix === "/" ? "" : prefix}/${clientFileName}.js`;
  const descriptors = buildComponentDescriptors(pages, baseDir);
  const bundleDescriptors: Record<string, ComponentReference> = {};

  for (const [route, descriptor] of Object.entries(descriptors)) {
    const page = pages[route];
    if (!page) {
      throw new Error(`No page configuration found for route "${route}"`);
    }
    ensureHydratableCapability(route, page.hydrate, descriptor);
    if (descriptor.reference) {
      bundleDescriptors[route] = descriptor.reference;
    }
  }

  const layoutDescriptor = layout ? normalizeComponentSpec(layout, baseDir) : undefined;

  let notFoundDescriptor: NormalizedComponent | undefined;
  if (notFoundPage) {
    notFoundDescriptor = normalizeComponentSpec(notFoundPage.component, baseDir);
    ensureHydratableCapability("notFound", notFoundPage.hydrate, notFoundDescriptor, true);
    if (notFoundDescriptor.reference) {
      bundleDescriptors[NOT_FOUND_KEY] = notFoundDescriptor.reference;
    }
  }

  const staticEntries = mergeStatic(userStatic, {
    dir: publicDir,
    prefix,
  });

  return {
    prefix,
    scriptHref,
    styleHrefs: [],
    descriptors,
    bundleDescriptors,
    layoutDescriptor,
    notFoundDescriptor,
    staticEntries,
  };
}

async function buildClientBundle(
  descriptors: Record<string, ComponentReference>,
  publicDir: string,
  cacheDir: string,
  clientFileName: string,
  prefix: string,
  baseDir: string,
  clientImports: readonly string[],
): Promise<string[]> {
  if (Object.keys(descriptors).length === 0) {
    return [];
  }

  await ensureDir(cacheDir);
  await ensureDir(publicDir);
  const entryPath = path.join(cacheDir, `${clientFileName}.tsx`);
  const entrySource = createClientEntry(descriptors, entryPath, baseDir, clientImports);
  await Bun.write(entryPath, entrySource);
  const tailwindPlugin = await resolveTailwindPlugin();
  const plugins = tailwindPlugin ? [tailwindPlugin] : undefined;
  const buildResult = await Bun.build({
    entrypoints: [entryPath],
    outdir: publicDir,
    target: "browser",
    format: "esm",
    throw: false,
    minify: false,
    plugins,
  });

  if (!buildResult.success) {
    const message = buildResult.logs.map(log => log.message).join("\n");
    throw new Error(
      `Failed to build HyperBun hydration bundle:\n${message || "Unknown build error"}`,
    );
  }

  return collectClientStyleAssets(publicDir, prefix, clientFileName);
}

async function discoverClientStyleAssets(
  publicDir: string,
  prefix: string,
  clientFileName: string,
): Promise<string[]> {
  return collectClientStyleAssets(publicDir, prefix, clientFileName);
}

async function collectClientStyleAssets(
  publicDir: string,
  prefix: string,
  clientFileName: string,
): Promise<string[]> {
  const styleHrefs: string[] = [];
  const cssFile = path.join(publicDir, `${clientFileName}.css`);
  if (await pathExists(cssFile)) {
    const relative = path.relative(publicDir, cssFile);
    styleHrefs.push(toPublicHref(prefix, relative));
  }
  return styleHrefs;
}

let tailwindPluginPromise: Promise<BunPlugin | null> | null = null;

async function resolveTailwindPlugin(): Promise<BunPlugin | null> {
  if (!tailwindPluginPromise) {
    tailwindPluginPromise = (async () => {
      try {
        const mod = await import("bun-plugin-tailwind");
        const plugin = mod?.default;
        return plugin ?? null;
      } catch (error) {
        if (isModuleNotFoundError(error)) {
          return null;
        }
        console.warn(
          "[hyperbun] Failed to load bun-plugin-tailwind; proceeding without Tailwind transformation.",
          error,
        );
        return null;
      }
    })();
  }
  return tailwindPluginPromise;
}

function isModuleNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "MODULE_NOT_FOUND") return true;
  const message = error.message ?? "";
  return message.includes("Cannot find module") || message.includes("Could not resolve");
}

function toPublicHref(prefix: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const base = prefix === "/" ? "" : prefix;
  const pathSegment = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `${base}${pathSegment}`;
}

function createPageHandler(args: {
  routeKey: string;
  descriptor: NormalizedComponent;
  hydrate: JSXPage["hydrate"];
  scriptHref: string;
  styleHrefs: readonly string[];
  getProps?: JSXPage["getProps"];
  getTitle: JSXPage["title"];
  componentCache: Map<string, ComponentType<any>>;
  getLayout: () => Promise<ComponentType<HyperBunLayoutProps>>;
}): Handler {
  const {
    routeKey,
    descriptor,
    hydrate,
    scriptHref,
    styleHrefs,
    getProps,
    getTitle,
    componentCache,
    getLayout,
  } = args;
  return async ctx => {
    const component = await loadComponent(descriptor, componentCache);
    const props = getProps ? await getProps(ctx) : undefined;
    const title = typeof getTitle === "function" ? await getTitle(ctx) : getTitle;
    const shouldHydrate = await resolveHydrate(hydrate, ctx);
    const layout = await getLayout();
    const response = renderPage(createElement(component, props), {
      route: routeKey,
      title,
      scriptPath: scriptHref,
      styleHrefs,
      hydrate: shouldHydrate,
      props,
      layout,
    });
    return response;
  };
}

function renderPage(
  element: ReactNode,
  options: {
    route: string;
    title: string;
    hydrate: boolean;
    scriptPath: string;
    styleHrefs: readonly string[];
    props?: unknown;
    layout: ComponentType<HyperBunLayoutProps>;
  },
) {
  const serializedProps = options.props === undefined ? undefined : serializeProps(options.props);
  const LayoutComponent = options.layout;
  let markup: string;
  try {
    markup = renderToString(
      <LayoutComponent
        title={options.title}
        route={options.route}
        hydrate={options.hydrate}
        scriptPath={options.scriptPath}
        styleHrefs={options.styleHrefs}
        serializedProps={serializedProps}
      >
        {element}
      </LayoutComponent>,
    );
  } catch (error) {
    if (isSuspenseWithoutBoundaryError(error)) {
      appendSuspenseHint(error);
    }
    throw error;
  }
  return html(`<!doctype html>${markup}`);
}

function isSuspenseWithoutBoundaryError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  const message = error.message ?? "";
  return (
    message.includes("A component suspended while responding to synchronous input") ||
    message.includes("A component suspended while rendering, but no fallback UI was specified") ||
    message.includes("A React component suspended while rendering, but no fallback UI was specified")
  );
}

function appendSuspenseHint(error: Error): void {
  const hint =
    "\n\nHyperBun hint: A component suspended during render without a surrounding <Suspense> fallback. " +
    "Wrap the subtree that might suspend in <Suspense fallback={...}> (for example in your layout) or load it eagerly.";
  if (!error.message.includes("HyperBun hint")) {
    error.message += hint;
    console.warn("[hyperbun] " + hint.trim());
  }
}

function createLayoutLoader(
  descriptor: NormalizedComponent | undefined,
  cache: Map<string, ComponentType<any>>,
): () => Promise<ComponentType<HyperBunLayoutProps>> {
  let resolved: ComponentType<HyperBunLayoutProps> | null = null;
  return async () => {
    if (resolved) return resolved;
    if (!descriptor) {
      resolved = DefaultLayout;
      return resolved;
    }
    const layoutComponent = await loadComponent(descriptor, cache);
    resolved = layoutComponent as ComponentType<HyperBunLayoutProps>;
    return resolved;
  };
}

function ensureHydratableCapability(
  route: string,
  hydrate: JSXPage["hydrate"] | undefined,
  descriptor: NormalizedComponent,
  isNotFound = false,
): void {
  const wantsHydration =
    hydrate === undefined || hydrate === true || typeof hydrate === "function";
  if (wantsHydration && !descriptor.reference) {
    const target = isNotFound ? "notFoundPage" : `page "${route}"`;
    throw new Error(
      `${target} is configured to hydrate but no module reference was provided. ` +
        "Provide a module path (e.g. './entry.tsx#Component') or set hydrate to false.",
    );
  }
}

async function resolveHydrate(
  hydrate: JSXPage["hydrate"],
  ctx: HyperContext,
): Promise<boolean> {
  if (typeof hydrate === "function") {
    return await hydrate(ctx);
  }
  if (hydrate === undefined) return true;
  return hydrate;
}

export const HyperBunHydrationScripts = ({
  hydrate,
  route,
  scriptPath,
  serializedProps,
}: HyperBunHydrationScriptsProps) => {
  if (!hydrate) return null;

  const bootstrap = sanitizeScript(
    `globalThis.__HYPERBUN_ROUTE__=${JSON.stringify(route)};${
      serializedProps ? `globalThis.__HYPERBUN_PROPS__=${serializedProps};` : ""
    }`,
  );

  return (
    <>
      <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: bootstrap }} />
      <script type="module" src={scriptPath} />
    </>
  );
};

const DefaultLayout = ({
  title,
  route,
  hydrate,
  scriptPath,
  styleHrefs,
  serializedProps,
  children,
}: HyperBunLayoutProps) => {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>{title}</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
        {styleHrefs?.map(href => (
          <link
            key={href}
            rel="stylesheet"
            href={href}
          />
        ))}
      </head>
      <body data-hyperbun-route={route} data-hydrated={hydrate ? "pending" : "static"}>
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

function sanitizeScript(value: string): string {
  return value.replace(/<\//g, "<\\/").replace(/-->/g, "--\\>");
}

function serializeProps(props: unknown): string {
  return JSON.stringify(props).replace(/</g, "\\u003c");
}

function buildComponentDescriptors(pages: Record<string, JSXPage>, baseDir: string) {
  const descriptors: Record<string, NormalizedComponent> = {};
  for (const [route, page] of Object.entries(pages)) {
    descriptors[route] = normalizeComponentSpec(page.component, baseDir);
  }
  return descriptors;
}

function normalizeComponentSpec(spec: ComponentSpec, baseDir: string): NormalizedComponent {
  if (typeof spec === "function") {
    return { component: spec };
  }

  if (typeof spec === "string") {
    const [modulePath, exportName] = parseComponentSpecifier(spec);
    return {
      reference: {
        modulePath: path.resolve(baseDir, modulePath),
        exportName,
      },
    };
  }

  if (typeof spec === "object" && spec) {
    if ("component" in spec && typeof spec.component === "function") {
      const moduleValue = "module" in spec && typeof spec.module === "string" ? spec.module : undefined;
      const exportValue = "export" in spec && typeof spec.export === "string" ? spec.export : "default";
      return {
        component: spec.component,
        reference: moduleValue
          ? {
              modulePath: path.resolve(baseDir, moduleValue),
              exportName: exportValue,
            }
          : undefined,
      };
    }

    if ("module" in spec && typeof spec.module === "string") {
      const exportName = "export" in spec && typeof spec.export === "string" ? spec.export : "default";
      return {
        reference: {
          modulePath: path.resolve(baseDir, spec.module),
          exportName,
        },
      };
    }
  }

  throw new TypeError("Unsupported component specification provided to HyperBun JSX server");
}

function parseComponentSpecifier(specifier: string): [string, string] {
  const [modulePath, exportName] = specifier.split("#");
  if (!modulePath) {
    throw new Error(`Invalid component specifier "${specifier}". Expected "<path>#<export>" or "<path>".`);
  }
  return [modulePath, exportName ?? "default"];
}

async function loadComponent(
  descriptor: NormalizedComponent,
  cache: Map<string, ComponentType<any>>,
): Promise<ComponentType<any>> {
  if (descriptor.component) {
    return descriptor.component;
  }

  const reference = descriptor.reference;
  if (!reference) {
    throw new Error("Component descriptor missing module reference");
  }

  const cacheKey = `${reference.modulePath}#${reference.exportName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const module = (await import(pathToFileURL(reference.modulePath).href)) as Record<string, unknown>;
  const component = module[reference.exportName];
  if (typeof component !== "function") {
    throw new Error(
      `Export "${reference.exportName}" from module "${reference.modulePath}" is not a React component`,
    );
  }
  cache.set(cacheKey, component as ComponentType<any>);
  return component as ComponentType<any>;
}

function mergeStatic(staticDefs: StaticConfig | StaticConfig[] | undefined, generated: StaticConfig) {
  if (!staticDefs) return generated;
  const defs = Array.isArray(staticDefs) ? staticDefs : [staticDefs];
  return [...defs, generated];
}

function replaceExtension(targetPath: string, extension: string): string {
  const { dir, name } = path.parse(targetPath);
  return path.join(dir, `${name}${extension}`);
}

async function buildSingleModule(entry: string, outfile: string): Promise<void> {
  const outdir = path.dirname(outfile);
  const entryFileName = path.basename(outfile);
  await ensureDir(outdir);
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    target: "bun",
    format: "esm",
    splitting: true,
    minify: false,
    sourcemap: "none",
    external: [...BUN_EXTERNAL_DEPENDENCIES],
    naming: {
      entry: entryFileName,
      chunk: "[name]-[hash].js",
    },
    throw: false,
  });

  if (!result.success) {
    const message = result.logs.map(log => log.message).join("\n");
    throw new Error(`Failed to compile JSX module "${entry}":\n${message || "Unknown build error"}`);
  }
}

async function copyStaticDirectory(source: string, destination: string): Promise<void> {
  if (!(await pathExists(source))) return;
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map(async entry => {
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        await copyStaticDirectory(sourcePath, destinationPath);
      } else if (entry.isFile()) {
        await ensureDir(path.dirname(destinationPath));
        await copyFile(sourcePath, destinationPath);
      }
    }),
  );
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export function resolveJSXRuntimeEnvironment(
  importDir: string,
  options: JSXRuntimeEnvironmentOptions = {},
): JSXRuntimeEnvironment {
  const {
    bundleDirName = "dist",
    sourcePublicDir = "../public",
    bundlePublicDir = "./public",
    skipEnvFlag = "HYPERBUN_SKIP_CLIENT_BUILD",
  } = options;

  const dirName = path.basename(importDir);
  const isBundledOutput = dirName === bundleDirName;
  const moduleExtension = isBundledOutput ? ".js" : ".tsx";
  const baseDir = importDir;
  const publicDir = path.resolve(importDir, isBundledOutput ? bundlePublicDir : sourcePublicDir);

  const skipClientBuild =
    isBundledOutput ||
    (typeof Bun !== "undefined" && Bun.env && Bun.env[skipEnvFlag] === "1");

  return {
    moduleExtension,
    baseDir,
    publicDir,
    skipClientBuild,
    isBundledOutput,
  };
}

function normalizePrefix(prefix: string): string {
  if (!prefix.startsWith("/")) prefix = `/${prefix}`;
  if (prefix.length > 1 && prefix.endsWith("/")) prefix = prefix.slice(0, -1);
  return prefix;
}

function ensureDir(dir: string) {
  return mkdir(dir, { recursive: true });
}

function createClientEntry(
  descriptors: Record<string, ComponentReference>,
  entryPath: string,
  baseDir: string,
  clientImports: readonly string[],
): string {
  const imports: string[] = [];
  const resolvedClientImports = new Set(clientImports);

  for (const specifier of resolvedClientImports) {
    if (typeof specifier !== "string" || specifier.length === 0) continue;
    let target = specifier;
    if (specifier.startsWith(".")) {
      const absolute = path.resolve(baseDir, specifier);
      target = toImportPath(path.dirname(entryPath), absolute);
    }
    imports.push(`import "${target}";`);
  }

  const registrations: string[] = [];
  let index = 0;
  for (const [route, descriptor] of Object.entries(descriptors)) {
    const importName = `route${index}`;
    const relativeModule = toImportPath(path.dirname(entryPath), descriptor.modulePath);
    imports.push(`import * as ${importName} from "${relativeModule}";`);
    const access = descriptor.exportName === "default"
      ? `${importName}.default`
      : `${importName}["${descriptor.exportName}"]`;
    registrations.push(`  "${route}": ${access}`);
    index += 1;
  }

  const header = `import React from "react";\nimport { hydrateRoot } from "react-dom/client";`;
  const mapDecl = `const ROUTES = {\n${registrations.join(",\n")}\n} as const;`;
  const body = `const container = document.querySelector('[data-hyperbun-root]');\nconst routeId = (globalThis as any).__HYPERBUN_ROUTE__;\nif (container instanceof HTMLElement && typeof routeId === "string") {\n  const Component = (ROUTES as Record<string, React.ComponentType<any>>)[routeId];\n  if (Component) {\n    const props = (globalThis as any).__HYPERBUN_PROPS__;\n    hydrateRoot(container, React.createElement(Component, props ?? undefined));\n    document.body?.setAttribute('data-hydrated', 'active');\n  }\n}`;

  return [imports.join("\n"), header, mapDecl, body].filter(Boolean).join("\n\n");
}

function toImportPath(fromDir: string, absoluteTarget: string): string {
  let relative = path.relative(fromDir, absoluteTarget).replace(/\\/g, "/");
  if (!relative.startsWith(".")) {
    relative = `./${relative}`;
  }
  return relative;
}
