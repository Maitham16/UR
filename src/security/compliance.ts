import { OWASP_TOP10_2021 } from "./mappings.ts";

export const SSDF: Record<string, string> = {
  PO: "Prepare the Organization",
  PS: "Protect the Software",
  PW: "Produce Well-Secured Software",
  RV: "Respond to Vulnerabilities",
};

export const CIS_CONTROLS: Record<string, string> = {
  "1": "Inventory and Control of Enterprise Assets",
  "3": "Data Protection",
  "4": "Secure Configuration of Assets",
  "5": "Account Management",
  "6": "Access Control Management",
  "7": "Continuous Vulnerability Management",
  "8": "Audit Log Management",
  "16": "Application Software Security",
  "18": "Penetration Testing",
};

export const ASVS: Record<string, string> = {
  V1: "Architecture, Design and Threat Modeling",
  V2: "Authentication",
  V3: "Session Management",
  V4: "Access Control",
  V5: "Validation, Sanitization and Encoding",
  V7: "Error Handling and Logging",
  V9: "Communications",
  V10: "Malicious Code",
  V14: "Configuration",
};

export function complianceReport(framework: string): string {
  const map: Record<string, Record<string, string>> = {
    owasp: OWASP_TOP10_2021,
    ssdf: SSDF,
    cis: CIS_CONTROLS,
    asvs: ASVS,
  };
  const m = map[framework.toLowerCase()];
  if (!m) return "frameworks: owasp, ssdf, cis, asvs";
  return Object.entries(m)
    .map(([k, v]) => `${k}  ${v}`)
    .join("\n");
}
