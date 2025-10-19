#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";

const DEFAULT_TEMPLATE = "default";
const DEFAULT_HYPERBUN_VERSION = "^0.1.0";
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".woff", ".woff2"]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadPackageJson() {
  const pkgPath = path.join(__dirname, "..", "package.json");
  const raw = await fsPromises.readFile(pkgPath, "utf8");
  return JSON.parse(raw);
}

function parseArgs(rawArgs) {
  const options = {
    template: DEFAULT_TEMPLATE,
    git: true,
    install: "auto",
    force: false,
    help: false,
    version: false,
    hyperbunVersion: DEFAULT_HYPERBUN_VERSION,
  };

  const positionals = [];

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];

    if (arg === "--") {
      positionals.push(...rawArgs.slice(i + 1));
      break;
    }

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "-v" || arg === "--version") {
      options.version = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--no-git") {
      options.git = false;
      continue;
    }

    if (arg === "--git") {
      options.git = true;
      continue;
    }

    if (arg === "--no-install") {
      options.install = "skip";
      continue;
    }

    if (arg.startsWith("--install=")) {
      options.install = arg.split("=", 2)[1] ?? "auto";
      continue;
    }

    if (arg === "--install" || arg === "-i") {
      const next = rawArgs[i + 1];
      if (next && !next.startsWith("-")) {
        options.install = next;
        i += 1;
      } else {
        options.install = "auto";
      }
      continue;
    }

    if (arg.startsWith("--template=")) {
      options.template = arg.split("=", 2)[1] ?? DEFAULT_TEMPLATE;
      continue;
    }

    if (arg === "--template" || arg === "-t") {
      const next = rawArgs[i + 1];
      if (next && !next.startsWith("-")) {
        options.template = next;
        i += 1;
      }
      continue;
    }

    if (arg.startsWith("--hyperbun-version=")) {
      options.hyperbunVersion = arg.split("=", 2)[1] ?? DEFAULT_HYPERBUN_VERSION;
      continue;
    }

    if (arg === "--hyperbun-version") {
      const next = rawArgs[i + 1];
      if (next && !next.startsWith("-")) {
        options.hyperbunVersion = next;
        i += 1;
      }
      continue;
    }

    if (arg === "-y" || arg === "--yes") {
      options.skipPrompts = true;
      continue;
    }

    if (arg.startsWith("-")) {
      console.warn(`Unknown option "${arg}" will be ignored.`);
      continue;
    }

    positionals.push(arg);
  }

  return { options, positionals };
}

function formatHelp(pkg) {
  return `
create-hyperbun ${pkg.version}

Usage:
  npm create hyperbun@latest <app-name> [options]
  bun create hyperbun <app-name> [options]

Options:
  -t, --template <name>        Select template (default: "${DEFAULT_TEMPLATE}")
  -i, --install <manager>      Install deps with bun|npm|pnpm|yarn|skip (default: auto)
      --no-install             Skip dependency installation
      --git / --no-git         Initialise a Git repo (default: on)
      --force                  Allow non-empty directory
      --hyperbun-version <v>   Override @hyperbun/core version (default: ${DEFAULT_HYPERBUN_VERSION})
  -y, --yes                    Skip prompts when using defaults
  -h, --help                   Show this message
  -v, --version                Print CLI version
`.trim();
}

async function promptForName(defaultName) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(`What is your project named? (${defaultName}): `);
    return answer.trim() || defaultName;
  } finally {
    rl.close();
  }
}

function toValidPackageName(value) {
  const lower = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const collapsed = lower.replace(/-+/g, "-").replace(/^[-.]+/, "");
  return collapsed.length ? collapsed : "hyperbun-app";
}

function toTitleCase(value) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || "HyperBun App";
}

async function ensureTargetDirectory(dirPath, force) {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true });
  } catch (error) {
    console.error(`Unable to create directory at ${dirPath}`, error);
    process.exit(1);
  }

  const files = await fsPromises.readdir(dirPath);
  if (files.length > 0 && !force) {
    console.error(`Target directory "${dirPath}" is not empty. Use --force to continue.`);
    process.exit(1);
  }
}

function isBinaryFile(filePath) {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function copyTemplate(templateDir, targetDir, tokens) {
  const entries = await fsPromises.readdir(templateDir, { withFileTypes: true });

  for (const entry of entries) {
    const source = path.join(templateDir, entry.name);
    const destinationName = entry.name === "_gitignore" ? ".gitignore" : entry.name;
    const destination = path.join(targetDir, destinationName);

    if (entry.isDirectory()) {
      await fsPromises.mkdir(destination, { recursive: true });
      await copyTemplate(source, destination, tokens);
      continue;
    }

    if (entry.isFile()) {
      const buffer = await fsPromises.readFile(source);

      if (isBinaryFile(source)) {
        await fsPromises.writeFile(destination, buffer);
        continue;
      }

      let content = buffer.toString("utf8");
      for (const [token, value] of Object.entries(tokens)) {
        content = content.replaceAll(token, value);
      }
      await fsPromises.writeFile(destination, content, "utf8");
    }
  }
}

function commandExists(command) {
  try {
    const result = spawn(command, ["--version"], { stdio: "ignore" });
    return new Promise((resolve) => {
      result.on("error", () => resolve(false));
      result.on("exit", (code) => resolve(code === 0));
    });
  } catch {
    return Promise.resolve(false);
  }
}

async function runInstall(manager, cwd) {
  let command = manager;
  const args = [];

  switch (manager) {
    case "bun":
      args.push("install");
      break;
    case "npm":
      args.push("install");
      break;
    case "pnpm":
      args.push("install");
      break;
    case "yarn":
      args.push("install");
      break;
    default:
      console.warn(`Unknown package manager "${manager}". Skipping install.`);
      return false;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      console.warn(`Failed to run ${manager} install:`, error.message);
      resolve(false);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        console.warn(`${manager} install exited with code ${code}.`);
        resolve(false);
      }
    });
  });
}

async function runGitInit(targetDir) {
  return new Promise((resolve) => {
    const child = spawn("git", ["init"], {
      cwd: targetDir,
      stdio: "ignore",
    });

    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2));
  const pkg = await loadPackageJson();

  if (options.version) {
    console.log(pkg.version);
    return;
  }

  if (options.help) {
    console.log(formatHelp(pkg));
    return;
  }

  let targetDirArg = positionals[0];
  const defaultName = "hyperbun-app";

  if (!targetDirArg) {
    if (options.skipPrompts) {
      targetDirArg = defaultName;
    } else {
      targetDirArg = await promptForName(defaultName);
    }
  }

  const targetDir = path.resolve(process.cwd(), targetDirArg);
  const packageName = toValidPackageName(path.basename(targetDir));
  const appTitle = toTitleCase(packageName);

  await ensureTargetDirectory(targetDir, options.force);

  const templateDir = path.join(__dirname, "..", "template", options.template);
  const templateExists = fs.existsSync(templateDir) && fs.statSync(templateDir).isDirectory();
  if (!templateExists) {
    console.error(`Template "${options.template}" not found at ${templateDir}`);
    process.exit(1);
  }

  const tokens = {
    __PACKAGE_NAME__: packageName,
    __APP_TITLE__: appTitle,
    __HYPERBUN_VERSION__: options.hyperbunVersion || DEFAULT_HYPERBUN_VERSION,
  };

  await copyTemplate(templateDir, targetDir, tokens);

  let gitInitialised = false;
  if (options.git) {
    gitInitialised = await runGitInit(targetDir);
  }

  let installManager = null;
  if (options.install !== "skip") {
    if (options.install !== "auto") {
      installManager = options.install;
    } else if (await commandExists("bun")) {
      installManager = "bun";
    } else if (await commandExists("npm")) {
      installManager = "npm";
    } else if (await commandExists("pnpm")) {
      installManager = "pnpm";
    } else if (await commandExists("yarn")) {
      installManager = "yarn";
    }
  }

  let installSucceeded = false;
  if (installManager) {
    console.log(`\nInstalling dependencies with ${installManager}...\n`);
    installSucceeded = await runInstall(installManager, targetDir);
  }

  const relativeDir = path.relative(process.cwd(), targetDir) || ".";
  console.log(`\nSuccess! Created ${appTitle} at ${relativeDir}`);

  const nextCommands = [];
  if (relativeDir !== ".") {
    nextCommands.push(`cd ${relativeDir}`);
  }

  if (!installSucceeded) {
    const recommendation = installManager ?? "bun";
    nextCommands.push(`${recommendation} install`);
  }

  nextCommands.push("bun run dev");

  console.log("\nNext steps:");
  for (const command of nextCommands) {
    console.log(`  • ${command}`);
  }

  if (gitInitialised) {
    console.log("\nGit repository initialised.");
  } else if (options.git) {
    console.log("\nGit was not initialised. Install Git and rerun `git init` if desired.");
  }

  console.log("\nHappy hacking with HyperBun! 🚀");
}

main().catch((error) => {
  console.error("create-hyperbun failed with an unexpected error:");
  console.error(error);
  process.exit(1);
});
