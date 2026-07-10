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
      return { allow: false, reason: `blocked ${c.category ?? "unsafe"} request`, alternative: REDIRECT };
    }
  }

  // 2. Destructive actions require an explicitly approved owned/lab scope.
  if (action.destructive) {
    if (!(scope && scope.approved && isLabOrOwned(scope.targetType))) {
      return {
        allow: false,
        reason: "destructive action requires an approved owned/lab scope",
        alternative: REDIRECT,
      };
    }
  }

  // 3. Tool policy gating.
  if (action.tool) {
    const policy = toolPolicy(action.tool);
    const cls = action.toolClass ?? policy?.classification ?? "active";
    const localOnly = action.target ? isLocalHost(action.target) : false;

    if (policy?.classification === "destructive" && !(scope && scope.approved && isLabOrOwned(scope.targetType))) {
      return { allow: false, reason: `${action.tool} requires an approved owned/lab scope`, alternative: REDIRECT };
    }
    if ((cls === "active" || cls === "destructive") && policy?.requiresScope && !scope && !localOnly) {
      return { allow: false, reason: `${action.tool} requires an explicit target scope`, alternative: REDIRECT };
    }
    if (policy?.requiresApproval && !(scope && scope.approved) && !localOnly) {
      return { allow: false, reason: `${action.tool} requires explicit scope approval`, alternative: REDIRECT };
    }
  }

  // 4. Target scoping.
  if (action.target && !isLocalHost(action.target)) {
    if (!scope) {
      return { allow: false, reason: `target ${action.target} has no authorized scope`, alternative: REDIRECT };
    }
    if (scope.disallowedHosts.includes(action.target)) {
      return { allow: false, reason: `${action.target} is explicitly disallowed`, alternative: REDIRECT };
    }
    if (!(scope.allowedHosts.includes(action.target) || scope.target === action.target)) {
      return { allow: false, reason: `${action.target} is outside the authorized scope`, alternative: REDIRECT };
    }
  }

  // 5. Intensity policy.
  if (action.intensity === "aggressive-lab-only" && !(scope && isLabOrOwned(scope.targetType))) {
    return { allow: false, reason: "aggressive intensity is limited to owned/lab scopes", alternative: REDIRECT };
  }

  return { allow: true };
}
