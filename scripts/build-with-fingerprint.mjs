import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = process.cwd();
const manifest = JSON.parse(
    await readFile(path.join(sourceRoot, "manifest.json"), "utf8")
);
const head = gitText(["rev-parse", "HEAD"]);
const dirtyStatus = gitText(["status", "--porcelain=v1", "--untracked-files=all"]);
const sourceStateHash = await hashSourceState();
const builtAt = new Date().toISOString();
const buildId = [
    head.slice(0, 12),
    builtAt.replaceAll(/[-:.TZ]/g, ""),
    sourceStateHash.slice(0, 12),
    randomUUID().slice(0, 8),
].join("-");

const fingerprint = {
    head,
    dirty: dirtyStatus.length > 0,
    sourceStateHash,
    buildId,
    builtAt,
    manifestId: manifest.id,
    manifestVersion: manifest.version,
};
const buildEnvironment = {
    ...process.env,
    VITE_JOURNAL_STREAM_BUILD_HEAD: fingerprint.head,
    VITE_JOURNAL_STREAM_BUILD_DIRTY: String(fingerprint.dirty),
    VITE_JOURNAL_STREAM_SOURCE_STATE_HASH: fingerprint.sourceStateHash,
    VITE_JOURNAL_STREAM_BUILD_ID: fingerprint.buildId,
    VITE_JOURNAL_STREAM_BUILD_TIME: fingerprint.builtAt,
    VITE_JOURNAL_STREAM_MANIFEST_ID: fingerprint.manifestId,
    VITE_JOURNAL_STREAM_MANIFEST_VERSION: fingerprint.manifestVersion,
};

runPnpm(["exec", "svelte-check"], buildEnvironment);
runPnpm(["exec", "vite", "build", "--mode", "production"], buildEnvironment);

const artifactHashes = {};
for (const filename of ["main.js", "manifest.json", "styles.css"]) {
    artifactHashes[filename] = await sha256(path.join(sourceRoot, filename));
}

const buildInfo = {
    schemaVersion: 1,
    ...fingerprint,
    artifactHashes,
};
const outputDir = path.join(sourceRoot, "artifacts");
await mkdir(outputDir, { recursive: true });
await writeFile(
    path.join(outputDir, "current-build-info.json"),
    `${JSON.stringify(buildInfo, null, 2)}\n`
);

console.log(`Journal Stream build ID: ${buildId}`);
console.log(`Journal Stream source state: ${sourceStateHash}`);

function gitText(args) {
    return execFileSync("git", args, {
        cwd: sourceRoot,
        encoding: "utf8",
    }).trim();
}

async function hashSourceState() {
    const hash = createHash("sha256");
    hash.update(
        execFileSync("git", ["diff", "--binary", "HEAD", "--", "."], {
            cwd: sourceRoot,
        })
    );
    const untracked = execFileSync(
        "git",
        ["ls-files", "--others", "--exclude-standard", "-z"],
        { cwd: sourceRoot }
    )
        .toString("utf8")
        .split("\0")
        .filter(Boolean)
        .sort();
    for (const relativePath of untracked) {
        hash.update(`\0${relativePath}\0`);
        hash.update(await readFile(path.join(sourceRoot, relativePath)));
    }
    return hash.digest("hex");
}

function runPnpm(args, environment) {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = spawnSync(command, args, {
        cwd: sourceRoot,
        env: environment,
        encoding: "utf8",
        stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
    }
}

async function sha256(filePath) {
    return createHash("sha256")
        .update(await readFile(filePath))
        .digest("hex");
}
