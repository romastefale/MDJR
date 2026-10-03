// Builds web/src (React app) into the single file served as web/app.js, and stamps the app version
// into web/index.html.
//   npm run build            write web/app.js
//   npm run build -- --check fail if web/app.js or web/index.html is not exactly what the source builds to
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "web/app.js");

// The one app version: "version" in package.json. bot/server.js reads it at start-up; the build
// puts it in the bundle and in web/index.html (?v= of app.js and desk.css, for cache busting).
export const APP_VERSION = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const INDEX = path.join(root, "web/index.html");

export function indexHtml(html = fs.readFileSync(INDEX, "utf8")) {
  return html.replace(/(\.\/(?:app\.js|desk\.css)\?v=)[^"]*/g, `$1${APP_VERSION}`);
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
    define: { "process.env.NODE_ENV": '"production"', __APP_VERSION__: JSON.stringify(APP_VERSION) },
    legalComments: "eof",
    plugins: [hitsExternal],
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

async function main() {
  const code = await buildWeb();
  const html = indexHtml();
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (current !== code || fs.readFileSync(INDEX, "utf8") !== html) {
      console.error("web/app.js or web/index.html is out of date: run `npm run build` and commit the result.");
      process.exit(1);
    }
    console.log(`web/app.js and web/index.html are up to date (${code.length} bytes, v${APP_VERSION}).`);
    return;
  }
  fs.writeFileSync(OUT, code);
  fs.writeFileSync(INDEX, html);
  console.log(`web/app.js and web/index.html written (${code.length} bytes, v${APP_VERSION}).`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
