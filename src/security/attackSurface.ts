import * as fs from "node:fs";
import * as path from "node:path";

export interface AttackSurface {
  routes: string[];
  subprocess: string[];
  dynamicEval: string[];
  fileUploads: string[];
  envSecrets: string[];
  dependencies: string[];
  dockerfiles: string[];
  summary: string;
}

const SKIP = new Set(["node_modules", ".git", "dist", "coverage", ".309"]);

/** Static attack-surface map of a local codebase (no network, no execution). */
export function scanWorkspace(root: string, maxFiles = 2000): AttackSurface {
  const s: AttackSurface = {
    routes: [], subprocess: [], dynamicEval: [], fileUploads: [], envSecrets: [], dependencies: [], dockerfiles: [], summary: "",
  };
  let count = 0;

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (e.name === "Dockerfile" || e.name.endsWith(".dockerfile")) s.dockerfiles.push(path.relative(root, full));
      if (e.name === "package.json") {
        try {
          const pkg = JSON.parse(fs.readFileSync(full, "utf8")) as { dependencies?: Record<string, string> };
          s.dependencies.push(...Object.keys(pkg.dependencies ?? {}));
        } catch {
          /* ignore */
        }
      }
      if (!/\.(ts|tsx|js|jsx|py|go|rb|java|php)$/.test(e.name)) continue;
      if (count++ > maxFiles) return;
      let text = "";
      try {
        text = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const rel = path.relative(root, full);
      text.split("\n").forEach((line, i) => {
        const loc = `${rel}:${i + 1}`;
        if (/\b(app|router|fastify|server)\.(get|post|put|delete|patch)\s*\(|@(Get|Post|Put|Delete|Mapping)\(|@app\.route\(/.test(line)) s.routes.push(loc);
        if (/child_process|subprocess\.|os\.system|\bexec(Sync)?\s*\(|\bspawn\s*\(|Runtime\.getRuntime/.test(line)) s.subprocess.push(loc);
        if (/\beval\s*\(|new Function\s*\(/.test(line)) s.dynamicEval.push(loc);
        if (/multer|\bupload\b|MultipartFile|request\.files/.test(line)) s.fileUploads.push(loc);
        if (/process\.env\.|os\.environ|System\.getenv/.test(line)) s.envSecrets.push(loc);
      });
    }
  };
  walk(root);

  const dedup = (a: string[]) => [...new Set(a)];
  s.routes = dedup(s.routes);
  s.subprocess = dedup(s.subprocess);
  s.dynamicEval = dedup(s.dynamicEval);
  s.fileUploads = dedup(s.fileUploads);
  s.envSecrets = dedup(s.envSecrets);
  s.dependencies = dedup(s.dependencies);
  s.dockerfiles = dedup(s.dockerfiles);
  s.summary = `routes ${s.routes.length} · subprocess ${s.subprocess.length} · eval ${s.dynamicEval.length} · uploads ${s.fileUploads.length} · env ${s.envSecrets.length} · deps ${s.dependencies.length} · dockerfiles ${s.dockerfiles.length}`;
  return s;
}
