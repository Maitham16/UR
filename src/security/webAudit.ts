import { isLocalHost } from "./scope.ts";
import type { Scope } from "./types.ts";

export type WebFetchLike = (url: string) => Promise<{ ok: boolean; status: number; headers: Record<string, string>; text(): Promise<string> }>;

const SECURITY_HEADERS = [
  "content-security-policy",
  "strict-transport-security",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

export interface WebAudit {
  url: string;
  status: number;
  presentHeaders: string[];
  missingHeaders: string[];
  tech: string[];
  notes: string[];
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

const defaultWebFetch: WebFetchLike = async (url) => {
  const res = await fetch(url);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return { ok: res.ok, status: res.status, headers, text: () => res.text() };
};

/** Passive web checks (headers, TLS hints, security headers, tech). Scope-gated. */
export async function auditWeb(url: string, opts: { scope: Scope | null; fetchImpl?: WebFetchLike }): Promise<{ blocked?: string; result?: WebAudit }> {
  if (!/^https?:\/\//i.test(url)) return { blocked: "url must start with http(s)://" };
  const host = hostOf(url);
  const inScope = isLocalHost(host) || (opts.scope ? opts.scope.allowedHosts.includes(host) || opts.scope.target === host : false);
  if (!inScope) return { blocked: `${host || url} is not in an authorized scope` };

  const fetchImpl = opts.fetchImpl ?? defaultWebFetch;
  const res = await fetchImpl(url);
  const present = SECURITY_HEADERS.filter((h) => res.headers[h] !== undefined);
  const missing = SECURITY_HEADERS.filter((h) => res.headers[h] === undefined);
  const tech: string[] = [];
  if (res.headers["server"]) tech.push(`server: ${res.headers["server"]}`);
  if (res.headers["x-powered-by"]) tech.push(`x-powered-by: ${res.headers["x-powered-by"]}`);

  const notes: string[] = [];
  if (missing.includes("content-security-policy")) notes.push("No Content-Security-Policy (XSS exposure).");
  if (missing.includes("strict-transport-security") && url.startsWith("https")) notes.push("No HSTS header.");
  if (missing.includes("x-content-type-options")) notes.push("No X-Content-Type-Options: nosniff.");

  return { result: { url, status: res.status, presentHeaders: present, missingHeaders: missing, tech, notes } };
}
