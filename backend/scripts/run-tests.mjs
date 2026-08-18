// Cross-platform test runner.
//
// `tsx --test "src/**/*.test.ts"` does not work here: cmd.exe does not expand the
// glob, and Node 20's directory discovery only matches .js. So walk src/ ourselves
// and hand the explicit file list to tsx.
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

function findTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findTests(full));
    else if (entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const files = findTests(root);
if (files.length === 0) {
  console.error("No *.test.ts files found under src/");
  process.exit(1);
}

// shell:true is needed to resolve the tsx bin on Windows, but it also means the
// shell re-splits arguments — so quote paths (this repo lives under "Rishav Patel").
const tsx = process.platform === "win32" ? "tsx.cmd" : "tsx";
const quoted = files.map((f) => JSON.stringify(f));
const child = spawn(tsx, ["--test", ...quoted], { stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 1));
