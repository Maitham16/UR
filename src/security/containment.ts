import type { ContainmentVerdict, Scope, SecurityAction } from "./types.ts";
import { classifyRequest } from "./classify.ts";
import { isLabOrOwned, isLocalHost } from "./scope.ts";
import { toolPolicy } from "./policy.ts";

const REDIRECT =
  "I can help with the defensive equivalent instead: a code/security audit, hardening steps, " +
  "detection logic, threat modeling, or a safe local lab simulation.";

/**
 * The Security Containment Firewall. It blocks out-of-scope targets, unsafe
 * intent, destructive actions, unapproved active tooling, and out-of-policy
 * intensity — and always offers a safe alternative. This is the security
 * realization of the paper's Analyze-stage guardrails + containment.
 */
export function evaluate(action: SecurityAction, scope: Scope | null): ContainmentVerdict {
  // 1. Intent classification.
  if (action.requestText) {
    const c = classifyRequest(action.requestText);
    if (c.cls === "unsafe") {
      return { allow: false, reason: `blocked: ${c.category ?? "unsafe"} request`, alternative: REDIRECT };
    }
  }

  // 2. Destructive actions are never run silently or automatically.
  if (action.destructive) {
    if (!(scope && scope.approved && isLabOrOwned(scope.targetType))) {
      return {
        allow: false,
        reason: "destructive action blocked",
        alternative: "Run only in an approved lab/owned scope (`/scope set lab-vm …` then `/scope approve`), or use a non-destructive check.",
        requiresApproval: true,
      };
    }
  }

  // 3. Tool policy gating.
  if (action.tool) {
    const policy = toolPolicy(action.tool);
    const cls = action.toolClass ?? policy?.classification ?? "active";
    const localOnly = action.target ? isLocalHost(action.target) : false;

    if (policy?.classification === "destructive" && !(scope && scope.approved && isLabOrOwned(scope.targetType))) {
      return { allow: false, reason: `${action.tool} is destructive`, alternative: REDIRECT, requiresApproval: true };
    }
    if ((cls === "active" || cls === "destructive") && policy?.requiresScope && !scope && !localOnly) {
      return { allow: false, reason: `${action.tool} needs a defined scope`, alternative: "Define scope: `/scope set …`, `/scope add-target …`, then `/scope approve`." };
    }
    if (policy?.requiresApproval && !(scope && scope.approved) && !localOnly) {
      return { allow: false, reason: `${action.tool} requires explicit approval`, alternative: "Approve the engagement with `/scope approve`.", requiresApproval: true };
    }
  }

  // 4. Target scoping.
  if (action.target && !isLocalHost(action.target)) {
    if (!scope) {
      return { allow: false, reason: `no scope defined for target ${action.target}`, alternative: "Define and approve a scope first." };
    }
    if (scope.disallowedHosts.includes(action.target)) {
      return { allow: false, reason: `${action.target} is explicitly out of scope`, alternative: "Remove it from the deny list or pick an in-scope target." };
    }
    if (!(scope.allowedHosts.includes(action.target) || scope.target === action.target)) {
      return { allow: false, reason: `${action.target} is not in the authorized scope`, alternative: "Add it with `/scope add-target` (only if you own/are authorized for it)." };
    }
  }

  // 5. Intensity policy.
  if (action.intensity === "aggressive-lab-only" && !(scope && isLabOrOwned(scope.targetType))) {
    return { allow: false, reason: "aggressive intensity is restricted to lab/owned targets", alternative: "Lower intensity, or set a lab/owned scope." };
  }

  return { allow: true };
}
