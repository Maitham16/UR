// src/sdk/index.ts
import { execFile } from "node:child_process";
function pickResultText(parsed) {
  if (parsed == null)
    return null;
  if (typeof parsed === "string")
    return parsed;
  if (Array.isArray(parsed)) {
    for (let i = parsed.length - 1;i >= 0; i--) {
      const found = pickResultText(parsed[i]);
      if (found !== null)
        return found;
    }
    return null;
  }
  if (typeof parsed === "object") {
    const obj = parsed;
    if (typeof obj.result === "string")
      return obj.result;
    if (typeof obj.text === "string")
      return obj.text;
    if (typeof obj.content === "string")
      return obj.content;
  }
  return null;
}
function pickTerminalResultText(parsed) {
  for (let i = parsed.length - 1;i >= 0; i--) {
    const item = parsed[i];
    if (typeof item === "object" && item !== null && !Array.isArray(item) && item.type === "result") {
      const found = pickResultText(item);
      if (found !== null)
        return found;
    }
  }
  return null;
}
function parseResultText(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed)
    return "";
  try {
    return pickResultText(JSON.parse(trimmed)) ?? trimmed;
  } catch {
    const parsedLines = [];
    for (const line of trimmed.split(/\r?\n/u)) {
      const candidate = line.trim();
      if (!candidate)
        continue;
      try {
        parsedLines.push(JSON.parse(candidate));
      } catch {}
    }
    if (parsedLines.length === 0)
      return trimmed;
    return pickTerminalResultText(parsedLines) ?? trimmed;
  }
}
function validateQueryInput(prompt, options) {
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new TypeError("prompt must be a non-empty string");
  }
  if (options.maxTurns !== undefined && (!Number.isSafeInteger(options.maxTurns) || options.maxTurns <= 0)) {
    throw new RangeError("maxTurns must be a positive safe integer");
  }
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new RangeError("timeoutMs must be a positive safe integer");
  }
  if (options.outputFormat !== undefined && !["json", "text", "stream-json"].includes(options.outputFormat)) {
    throw new TypeError('outputFormat must be "json", "text", or "stream-json"');
  }
}
function buildArgs(prompt, options) {
  const outputFormat = options.outputFormat ?? "json";
  const args = [
    ...options.bin?.args ?? [],
    "-p",
    "--output-format",
    outputFormat
  ];
  if (outputFormat === "stream-json")
    args.push("--verbose");
  if (options.maxTurns !== undefined) {
    args.push("--max-turns", String(options.maxTurns));
  }
  if (options.skipPermissions)
    args.push("--dangerously-skip-permissions");
  args.push(prompt);
  return args;
}
async function query(prompt, options = {}) {
  validateQueryInput(prompt, options);
  const file = options.bin?.file ?? "ur";
  const args = buildArgs(prompt, options);
  const env = {
    ...process.env,
    ...options.env ?? {},
    ...options.model ? { UR_MODEL: options.model } : {}
  };
  return await new Promise((resolve) => {
    execFile(file, args, { cwd: options.cwd, env, timeout: options.timeoutMs ?? 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const raw = stdout ?? "";
      const exitCode = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      resolve({
        ok: exitCode === 0,
        text: parseResultText(raw),
        raw,
        exitCode,
        stderr: stderr ?? ""
      });
    });
  });
}
async function queryJSON(prompt, options = {}) {
  const { ok, text } = await query(prompt, options);
  if (!ok)
    return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

class UrClient {
  defaults;
  constructor(defaults = {}) {
    this.defaults = defaults;
  }
  query(prompt, options = {}) {
    return query(prompt, this.mergeOptions(options));
  }
  queryJSON(prompt, options = {}) {
    return queryJSON(prompt, this.mergeOptions(options));
  }
  mergeOptions(options) {
    return {
      ...this.defaults,
      ...options,
      env: this.defaults.env || options.env ? { ...this.defaults.env ?? {}, ...options.env ?? {} } : undefined
    };
  }
}
export {
  queryJSON,
  query,
  parseResultText,
  UrClient
};
