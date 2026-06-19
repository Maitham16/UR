export function secureDesign(feature: string): string {
  return [
    `# Secure design — ${feature || "feature"}`,
    "- Threat model first: assets, entry points, trust boundaries, abuse cases.",
    "- Authentication: proven libraries; MFA for sensitive operations.",
    "- Authorization: least privilege, enforced at every boundary; default deny.",
    "- Input validation and output encoding on every untrusted input.",
    "- Secrets: environment / secret manager, never in code; rotate regularly.",
    "- Logging without secrets; audit security-relevant events.",
    "- Fail closed with safe defaults; handle errors without leaking internals.",
    "- Dependencies: pin, audit (OSV), and patch promptly.",
  ].join("\n");
}

export function secureApi(spec: string): string {
  return [
    `# Secure API checklist${spec ? ` — ${spec}` : ""}`,
    "- AuthN/AuthZ on every endpoint; object-level checks (prevent IDOR).",
    "- Validate request schemas; reject unknown fields.",
    "- Rate limit and quota per principal.",
    "- No sensitive data in URLs or logs.",
    "- Consistent error format; no stack traces to clients.",
    "- CORS restricted to known origins; security headers set.",
    "- Versioning and deprecation policy.",
  ].join("\n");
}

export function secureCi(): string {
  return [
    "# Secure CI checklist",
    "- Pin action/runner versions; least-privilege tokens.",
    "- SAST (semgrep), dependency audit (osv/npm audit), secret scan on every PR.",
    "- Block merges on high-severity findings.",
    "- Sign artifacts; generate an SBOM (syft).",
    "- Store secrets in the CI secret store; never echo them.",
  ].join("\n");
}

export function secureDocker(): string {
  return [
    "# Secure Docker checklist",
    "- Pin base image by digest; use minimal/distroless bases.",
    "- Run as a non-root USER; drop capabilities; read-only rootfs where possible.",
    "- No secrets in ENV/ARG/layers; use build/runtime secrets.",
    "- Scan images (trivy/grype); keep them small.",
    "- HEALTHCHECK and explicit, least-privilege ports.",
  ].join("\n");
}

export function secureDeploy(): string {
  return [
    "# Secure deployment checklist",
    "- TLS everywhere; HSTS; modern ciphers.",
    "- Least-privilege service accounts and network policies.",
    "- Secrets from a manager; rotation and audit.",
    "- Centralized logging/monitoring with alerts.",
    "- Backups + tested restore; documented incident response.",
    "- Patch cadence and vulnerability management.",
  ].join("\n");
}
