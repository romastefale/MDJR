// Builds web/src (React app) into the single file served as web/app.js.
//   npm run build            write web/app.js
//   npm run build -- --check fail if web/app.js is not exactly what the source builds to
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { APP_VERSION } from "../web/src/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "web/app.js");

// index.html, bot/server.js and the bundle must announce the same version (cache busting and the
// /health -> `webapp` ?v= check).
export function versionProblems(version = APP_VERSION) {
  const problems = [];
  const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
  for (const asset of ["app.js", "desk.css"]) {
    const found = [...html.matchAll(new RegExp(`${asset.replace(".", "\\.")}\\?v=(\\d+)`, "g"))].map((m) => m[1]);
    if (!found.length || found.some((v) => v !== version)) problems.push(`web/index.html ${asset}?v=${found.join(",") || "?"} != ${version}`);
  }
  const server = fs.readFileSync(path.join(root, "bot/server.js"), "utf8");
  const serverVersion = /const APP_VERSION = "(\d+)"/.exec(server)?.[1];
  if (serverVersion !== version) problems.push(`bot/server.js APP_VERSION ${serverVersion} != ${version}`);
  return problems;
}

// hits.js and worklet.js stay plain files next to app.js; hits.js is imported at runtime with the
// same ?v= as the bundle, exactly like the original build.
const hitsExternal = {
  name: "hits-external",
  setup(build) {
    build.onResolve({ filter: /^\.\.\/hits\.js$/ }, () => ({ path: `./hits.js?v=${APP_VERSION}`, external: true }));
  },
};

export async function buildWeb() {
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ["web/src/main.jsx"],
    bundle: true,
    minify: true,
    format: "esm",
    jsx: "automatic",
    target: "esnext",
    define: { "process.env.NODE_ENV": '"production"' },
    legalComments: "eof",
    plugins: [hitsExternal],
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

async function main() {
  const problems = versionProblems();
  if (problems.length) {
    console.error(`Version mismatch:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  const code = await buildWeb();
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (current !== code) {
      console.error("web/app.js is out of date: run `npm run build` and commit the result.");
      process.exit(1);
    }
    console.log(`web/app.js is up to date (${code.length} bytes, v${APP_VERSION}).`);
    return;
  }
  fs.writeFileSync(OUT, code);
  console.log(`web/app.js written (${code.length} bytes, v${APP_VERSION}).`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
