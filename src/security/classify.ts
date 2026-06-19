import type { RequestClass } from "./types.ts";

export interface Classification {
  cls: RequestClass;
  category?: string;
  reasons: string[];
}

// Categories that are never assisted, regardless of any "authorized/lab" claim.
const ALWAYS_UNSAFE: Array<[string, RegExp]> = [
  ["malware", /\b(write|create|build|make|generate|develop|code)\b[\s\S]{0,40}\b(malware|ransomware|keylogger|root ?kit|trojan|virus|worm|botnet|spyware|stealer|cryptominer)\b/i],
  ["phishing", /\b(phish|phishing|spear[- ]?phish|smish|vish)\b|\bfake (login|sign[- ]?in|bank) (page|site)\b|\bclone\b[\s\S]{0,30}\b(login|website)\b[\s\S]{0,20}\bsteal\b/i],
  ["ddos", /\b(ddos|dos attack|denial[- ]of[- ]service)\b|\b(flood|overwhelm|knock offline)\b[\s\S]{0,30}\b(server|service|site|network|target)\b/i],
  ["exfiltration", /\bexfiltrat/i],
  ["credential_theft", /\b(steal|dump|harvest|grab|sniff)\b[\s\S]{0,30}\b(password|passwords|credential|credentials|cookie|session token|api key)\b/i],
  ["stealth_evasion", /\b(evade|bypass|defeat|disable|turn off)\b[\s\S]{0,30}\b(detection|edr|av|antivirus|defender|logging|audit log|ids|ips|siem)\b|\bundetect|\banti[- ]?forensic|\bcover (my|your|our) tracks\b|\bwipe (the )?logs\b/i],
  ["persistence", /\b(establish|maintain|install|plant|drop)\b[\s\S]{0,20}\b(persistence|backdoor|implant|web ?shell)\b|\bbackdoor\b/i],
  ["weaponize", /\b(weaponize|fully working exploit|working exploit chain|drop a shell on)\b/i],
];

// Unauthorized-access intent (unsafe unless clearly about the user's own/lab assets).
const UNAUTHORIZED = /\b(hack|break|breaking|broke)\b[\s\S]{0,12}\b(in ?to)\b|\bgain (unauthorized|illegal|admin) access\b|\bwithout (their|his|her|the owner'?s|any) (permission|authorization|consent|knowledge)\b|\bsomeone ?else'?s\b|\b(my )?(ex|neighbou?r|girlfriend|boyfriend|coworker|teacher|school|employer)'?s? (account|phone|wi[- ]?fi|computer|email|network)\b/i;

const AUTHORIZED = /\b(my own|i own|we own|owned|authorized|with (written )?permission|lab|ctf|test environment|sandbox|localhost|127\.0\.0\.1|on my (own )?(machine|laptop|server|network|vm))\b/i;

const OFFENSIVE_TOOLING = /\b(nmap|masscan|rustscan|sqlmap|metasploit|msfconsole|hydra|hashcat|aircrack|burp|nikto|nuclei|ffuf|gobuster|dirb|exploit|brute[- ]?force|open ports?|port[- ]?scan(ning)?)\b|\bscan\b[\s\S]{0,30}\b(host|server|network|ip|domain|site|ports?|target|machine|subnet)\b/i;

const DEFENSIVE = /\b(audit|harden|hardening|secure|security review|code review|review .* security|detect|defen[sc]|mitigat|remediat|patch|fix .* vulnerab|threat model|owasp|cwe|cvss|baseline|incident|triage|posture|compliance|sast|dependency|secrets? scan)\b/i;

/**
 * Classify a free-text request as defensive, dual-use (needs scope/approval),
 * or unsafe (must be redirected). This is a heuristic first line; the real
 * gate is scope + approval in the containment firewall.
 */
export function classifyRequest(text: string): Classification {
  const reasons: string[] = [];

  for (const [category, re] of ALWAYS_UNSAFE) {
    if (re.test(text)) {
      reasons.push(`matched ${category} intent`);
      return { cls: "unsafe", category, reasons };
    }
  }

  if (UNAUTHORIZED.test(text)) {
    reasons.push("targets a system the user does not own / is not authorized for");
    return { cls: "unsafe", category: "unauthorized_access", reasons };
  }

  if (OFFENSIVE_TOOLING.test(text)) {
    if (AUTHORIZED.test(text)) {
      reasons.push("active/offensive tooling against an authorized or owned target");
      return { cls: "dual_use", category: "authorized_active", reasons };
    }
    reasons.push("active/offensive tooling without an explicit authorization context");
    return { cls: "dual_use", category: "needs_scope", reasons };
  }

  if (DEFENSIVE.test(text)) {
    reasons.push("defensive / blue-team / secure-code intent");
    return { cls: "defensive", reasons };
  }

  return { cls: "defensive", reasons: ["no offensive or unsafe intent detected"] };
}
