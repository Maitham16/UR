import * as fs from "node:fs";
import { join } from "node:path";

const WARN = "// LOCAL SECURITY LAB — intentionally vulnerable. Do NOT deploy or expose to any network.\n";

export interface LabResult {
  created: string[];
  warning: string;
}

/** Create a safe, local-only, intentionally-vulnerable learning lab. */
export function createLab(kind: string, baseDir: string): LabResult {
  const dir = join(baseDir, "labs", kind);
  fs.mkdirSync(dir, { recursive: true });
  const created: string[] = [];
  const write = (name: string, content: string) => {
    const p = join(dir, name);
    fs.writeFileSync(p, content);
    created.push(p);
  };

  switch (kind) {
    case "web-vuln":
      write(
        "vulnerable_app.js",
        WARN +
          "const express = require('express');\nconst app = express();\n" +
          "app.get('/calc', (req, res) => res.send(String(eval(req.query.x))));\n" +
          "app.get('/user', (req, res) => db.query(`SELECT * FROM users WHERE id = ${req.query.id}`));\n" +
          "module.exports = app;\n",
      );
      write("README.md", "# Web-vuln lab\nIntentionally vulnerable (eval + SQL injection). Local only — for learning and detection practice.");
      break;
    case "api-vuln":
      write("api.js", WARN + "// Missing authn/authz + IDOR demo\napp.get('/account/:id', (req, res) => res.json(getAccount(req.params.id)));\n");
      write("README.md", "# API-vuln lab\nBroken access control / IDOR demo. Local only.");
      break;
    case "linux-audit":
      write("notes.md", "# Linux audit lab\nPractice read-only hardening checks (sshd, firewall, permissions) against this directory.");
      break;
    case "pcap":
      write("mock-traffic.txt", "# mock capture summary (not a real pcap)\nGET /login\nPOST /login username=demo&password=demo (cleartext)\n");
      write("README.md", "# PCAP lab\nMock cleartext-credential traffic for detection practice. Local only.");
      break;
    default:
      write("README.md", WARN + `# ${kind} lab\nLocal-only learning lab.`);
  }

  return { created, warning: "Lab created locally and is intentionally insecure — never expose it to a network." };
}
