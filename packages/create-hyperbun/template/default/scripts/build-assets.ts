import path from "node:path";
import { buildJSXStaticAssets } from "@hyperbun/core";

import { createAppJSXOptions } from "../src/server";

const projectDir = path.resolve(import.meta.dir, "..");
const srcDir = path.join(projectDir, "src");
const distDir = path.join(projectDir, "dist");
const publicOutDir = path.join(distDir, "public");

const jsxConfig = createAppJSXOptions(".tsx", srcDir, publicOutDir);

await buildJSXStaticAssets({
  ...jsxConfig,
  componentOutDir: distDir,
  moduleExtension: ".js",
  clientFileName: "hyperbun-client",
  staticSourceDir: path.resolve(projectDir, "public"),
});
