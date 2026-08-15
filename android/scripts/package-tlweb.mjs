import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const source = path.resolve(args.get("--source") || "");
const destination = path.resolve(args.get("--destination") || "");
const expectedDestination = path.resolve(projectRoot, "app/build/generated/tlWebAssets");
assert.equal(destination, expectedDestination, "refusing to write outside the Android generated-asset directory");
assert.equal(fs.lstatSync(source).isSymbolicLink(), false, "TL Web dist root cannot be a symbolic link");
assert.ok(fs.statSync(source).isDirectory(), `TL Web dist not found at ${source}`);

for (const component of [
  projectRoot,
  path.join(projectRoot, "app"),
  path.join(projectRoot, "app/build"),
  path.join(projectRoot, "app/build/generated"),
  destination
]) {
  if (fs.existsSync(component)) {
    assert.equal(
      fs.lstatSync(component).isSymbolicLink(),
      false,
      `generated asset path component cannot be a symbolic link: ${component}`
    );
  }
}

function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const stat = fs.lstatSync(full);
    assert.equal(stat.isSymbolicLink(), false, `symbolic links cannot enter the APK: ${full}`);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile()) result.push(full);
    else assert.fail(`unsupported TL Web dist entry: ${full}`);
  }
  return result;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function git(repo, ...commandArgs) {
  const result = spawnSync("git", ["-C", repo, ...commandArgs], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function findGitRoot(start) {
  let cursor = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(cursor, ".git"))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

const sourceFiles = walk(source);
const relativeFiles = sourceFiles.map((file) => path.relative(source, file).replaceAll("\\", "/"));
for (const relative of relativeFiles) {
  assert.equal(relative.endsWith(".map"), false, `source maps cannot enter the APK: ${relative}`);
  assert.equal(relative.startsWith("assets/algos/tl/"), false, `legacy signing utility cannot enter the APK: ${relative}`);
  assert.equal([
    "assets/algos/manifest.json",
    "assets/algos/package.json",
    "assets/algos/package-lock.json"
  ].includes(relative), false, `unreviewed algorithm metadata cannot enter the APK: ${relative}`);
}

const algoPrefix = "assets/algos/";
const allowedAlgos = new Set(["range_vdip_trail.js", "ribbon_pucker_trend.js"]);
for (const relative of relativeFiles.filter((value) => value.startsWith(algoPrefix))) {
  const remainder = relative.slice(algoPrefix.length);
  assert.equal(remainder.includes("/"), false, `algorithm subdirectories cannot enter the APK: ${relative}`);
  assert.equal(allowedAlgos.has(remainder), true, `unreviewed algorithm cannot enter the APK: ${relative}`);
}

const sourceIndex = fs.readFileSync(path.join(source, "index.html"), "utf8");
assert.match(sourceIndex, /<base href="\/">/);
assert.match(sourceIndex, /Content-Security-Policy/);
assert.match(sourceIndex, /default-src 'self'/);

if (fs.existsSync(destination)) {
  for (const entry of walk(destination)) {
    assert.equal(fs.lstatSync(entry).isSymbolicLink(), false, "generated asset cleanup cannot traverse a link");
  }
  fs.rmSync(destination, { recursive: true, force: false });
}
fs.mkdirSync(path.join(destination, "tlweb"), { recursive: true });

for (let index = 0; index < sourceFiles.length; index += 1) {
  const relative = relativeFiles[index];
  const output = path.join(destination, "tlweb", ...relative.split("/"));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(sourceFiles[index], output);
}

const packagedIndexPath = path.join(destination, "tlweb", "index.html");
const packagedIndex = fs.readFileSync(packagedIndexPath, "utf8")
  .replace('<base href="/">', '<base href="/assets/tlweb/">')
  .replace(
    "</head>",
    '<link rel="stylesheet" href="mobile-overrides.css" data-tradelayer-mobile="v1"></head>'
  );
assert.match(packagedIndex, /<base href="\/assets\/tlweb\/">/);
assert.match(packagedIndex, /data-tradelayer-mobile="v1"/);
fs.writeFileSync(packagedIndexPath, packagedIndex, "utf8");

const repo = findGitRoot(source);
const packagedFiles = walk(path.join(destination, "tlweb"))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => ({
    path: path.relative(path.join(destination, "tlweb"), file).replaceAll("\\", "/"),
    bytes: fs.statSync(file).size,
    sha256: sha256(file)
  }));
const sourceHint = repo
  ? `${path.basename(repo)}/${path.relative(repo, source).replaceAll("\\", "/")}`
  : path.basename(source);
const manifest = {
  schema: "tradelayer_mobile_web_package_v1",
  source_dist: sourceHint,
  source_commit: repo ? git(repo, "rev-parse", "HEAD") : null,
  source_dirty: repo ? Boolean(git(repo, "status", "--porcelain")) : null,
  files: packagedFiles
};
fs.writeFileSync(
  path.join(destination, "tlweb", "tlweb-package-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(JSON.stringify({
  ok: true,
  schema: manifest.schema,
  source: manifest.source_dist,
  sourceCommit: manifest.source_commit,
  sourceDirty: manifest.source_dirty,
  files: manifest.files.length
}, null, 2));
