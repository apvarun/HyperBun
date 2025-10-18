import path from "path";
import { buildJSXStaticAssets } from "@hyperbun/core/jsx";

import { createExampleJSXOptions } from "../src/server";

const packageDir = path.resolve(import.meta.dir, "..");
const srcDir = path.resolve(packageDir, "src");
const distDir = path.resolve(packageDir, "dist");
const publicOutDir = path.join(distDir, "public");

const jsxConfig = createExampleJSXOptions(".tsx", srcDir, publicOutDir);

await buildJSXStaticAssets({
  ...jsxConfig,
  componentOutDir: distDir,
  moduleExtension: ".js",
  clientFileName: "hyperbun-client",
  staticSourceDir: path.resolve(packageDir, "public"),
});
