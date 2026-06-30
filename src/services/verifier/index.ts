// Verifier — public API.
//
// Layer 1: cheap deterministic gates that run inside the agent loop
// with no extra Ollama round-trip (done-claim, loop detector, project
// gates from .ur/verify.json or auto-detected project commands). This is
// the lightweight "try the implementation" pass and is always on (outside
// mode=off).
// Layer 2: the heavy verification subagent. OPT-IN — by default the
// verifier never auto-spawns it after a turn. Trigger the deep pass
// yourself with the /verify command; set UR_VERIFIER_AUTO_SUBAGENT=1 to
// restore the old automatic nudge after every mutating turn.
//
// Wiring: a single `Verifier` instance per QueryEngine. The loop calls
// `recordToolCall` after every tool result, and `checkTurn` once the
// assistant's text is finalized for a turn. `checkTurn` returns either
// `{ ok: true }` (let the turn proceed) or `{ ok: false, reminder }` —
// the loop should inject `reminder` as a user message and continue
// instead of yielding the assistant turn to the renderer.
//
// Mode env vars (read at construction time, override constructor opts):
//   UR_VERIFIER_MODE=off      disable both layers entirely
//   UR_VERIFIER_MODE=loose    L1 done-claim + project gates off; loop
//                             detector + empty-turn check stay
//   UR_VERIFIER_MODE=strict   default (all L1 gates on)
//   UR_VERIFIER_AUTO_SUBAGENT=1      opt in to the automatic L2 nudge
//                                    after every mutating turn
//   UR_VERIFIER_DISABLE_SUBAGENT=1   hard-off for L2; also unregisters the
//                                    verification agent so /verify can't
//                                    spawn it either

import type { ToolUseBlock } from '@urhq-ai/sdk/resources/index.mjs'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { detectProjectQualityStack } from '../projectQuality.js'
import { detectDoneClaim, evaluateDoneGate } from './doneDetector.js'
import { ToolEffectLedger } from './ledger.js'
import { LoopDetector, type LoopHit } from './loopDetector.js'
import {
  hasNonIgnoredEdits,
  loadVerifyConfig,
  pickCommands,
  runGateCommands,
  type VerifyConfig,
} from './projectGates.js'
import { loadPluginValidators, type PluginValidator } from '../../utils/plugins/loadPluginValidators.js'
import picomatch from 'picomatch'
import { buildSubagentNudge, type SubagentNudge } from './subagentNudge.js'

export type VerifierMode = 'off' | 'loose' | 'strict'

export type VerifierOptions = {
  cwd: string
  /** Hard cap on consecutive verifier rejections per turn to avoid loops. */
  maxRejectionsPerTurn?: number
  /** Override the loop detector's repeat threshold. */
  repeatThreshold?: number
  /**
   * After L1 passes on a mutating turn, ask the loop to nudge the model to
   * spawn the verification subagent. OPT-IN: when not explicitly passed it
   * defaults to false, so the deep verification only runs when the user
   * triggers it on demand (the /verify command). It defaults to true only
   * if UR_VERIFIER_AUTO_SUBAGENT is set (and mode!='off' and
   * UR_VERIFIER_DISABLE_SUBAGENT!='1').
   */
  enableSubagentNudge?: boolean
  /**
   * Overall mode. UR_VERIFIER_MODE env var wins if set; otherwise this
   * value; otherwise 'strict'.
   */
  mode?: VerifierMode
}

export type CheckResult = { ok: true } | { ok: false; reminder: string }

function resolveMode(opt: VerifierMode | undefined): VerifierMode {
  const env = (process.env.UR_VERIFIER_MODE ?? '').toLowerCase()
  if (env === 'off' || env === 'loose' || env === 'strict') return env
  return opt ?? 'strict'
}

const DEFAULT_MAX_REJECTIONS_PER_TURN = 3
const AUTO_DETECTED_GATE_TIMEOUT_MS = 600_000

export class Verifier {
  readonly ledger = new ToolEffectLedger()
  private loops: LoopDetector
  private configPromise: Promise<VerifyConfig | null>
  private pluginValidatorsPromise: Promise<PluginValidator[]>
  private rejectionsByTurn = new Map<string, number>()
  private nudgedTurns = new Set<string>()
  private userTaskHintByTurn = new Map<string, string>()
  private maxRejections: number
  private cwd: string
  private enableSubagentNudge: boolean
  private mode: VerifierMode

  constructor(options: VerifierOptions) {
    this.cwd = options.cwd
    this.maxRejections = options.maxRejectionsPerTurn ?? DEFAULT_MAX_REJECTIONS_PER_TURN
    this.loops = new LoopDetector(options.repeatThreshold)
    this.configPromise = loadVerifyConfig(options.cwd)
    this.pluginValidatorsPromise = loadPluginValidators()
    this.mode = resolveMode(options.mode)
    // L2 is opt-in: the deep verification subagent only auto-spawns when the
    // user explicitly enables it via UR_VERIFIER_AUTO_SUBAGENT. By default the
    // verifier runs L1 gates only ("try the implementation") and the user
    // triggers deep verification on demand with the /verify command.
    const subagentEnabledByDefault =
      this.mode !== 'off' &&
      process.env.UR_VERIFIER_DISABLE_SUBAGENT !== '1' &&
      isEnvTruthy(process.env.UR_VERIFIER_AUTO_SUBAGENT)
    this.enableSubagentNudge =
      options.enableSubagentNudge ?? subagentEnabledByDefault
  }

  /** Reset per-turn state at the start of each new user request. */
  beginTurn(turnId: string, userTaskHint?: string): void {
    this.loops.reset()
    this.rejectionsByTurn.delete(turnId)
    this.nudgedTurns.delete(turnId)
    if (userTaskHint) this.userTaskHintByTurn.set(turnId, userTaskHint)
  }

  /**
   * Called after each tool finishes. Returns a reminder if the loop
   * detector trips on a repeated call.
   */
  recordToolCall(
    turnId: string,
    toolUse: ToolUseBlock,
    succeeded: boolean,
  ): LoopHit | null {
    this.ledger.record(turnId, toolUse, succeeded)
    return this.loops.observe(toolUse.name, toolUse.input)
  }

  /**
   * Validate an assistant turn before it's rendered to the user.
   *
   * @param turnId    originating user-request UUID
   * @param assistantText finalized text of the assistant's message
   * @param hadToolCalls  true if the model emitted ≥1 tool call this turn
   */
  async checkTurn(
    turnId: string,
    assistantText: string,
    hadToolCalls: boolean,
  ): Promise<CheckResult> {
    if (this.mode === 'off') return { ok: true }
    if (this.shouldBail(turnId)) {
      return { ok: true }
    }

    // 1. Empty-turn check (loose + strict)
    const emptyHit = this.loops.checkEmptyTurn(
      assistantText.trim().length > 0,
      hadToolCalls,
    )
    if (emptyHit) {
      this.bumpRejection(turnId)
      return { ok: false, reminder: emptyHit.reminder }
    }

    // 2. Done-claim check (strict only)
    if (this.mode === 'strict') {
      const claim = detectDoneClaim(assistantText)
      if (claim) {
        const gate = evaluateDoneGate(
          claim,
          this.ledger.hasMutatingEffect(turnId),
          this.ledger.ranBash(turnId),
        )
        if (!gate.ok) {
          this.bumpRejection(turnId)
          const failed = gate as Extract<typeof gate, { ok: false }>
          return { ok: false, reminder: failed.reminder }
        }
      }
    }

    // 3. Project gates (strict only; only when the turn actually mutated something)
    if (this.mode === 'strict') {
      const config = await this.configPromise
      const modifiedFiles = this.ledger.modifiedFiles(turnId)
      const ranBash = this.ledger.ranBash(turnId)
      let commands = config
        ? pickCommands(config, modifiedFiles, ranBash, this.cwd)
        : null
      let timeoutMs = config?.timeoutMs
      if (!commands && hasNonIgnoredEdits(config, modifiedFiles, this.cwd)) {
        commands = this.autoDetectedAfterEditCommands()
        timeoutMs = config?.timeoutMs ?? AUTO_DETECTED_GATE_TIMEOUT_MS
      }
      if (commands && commands.length > 0) {
        const result = await runGateCommands(
          commands,
          this.cwd,
          timeoutMs,
        )
        if (!result.ok) {
          this.bumpRejection(turnId)
          const failed = result as Extract<typeof result, { ok: false }>
          return { ok: false, reminder: failed.reminder }
        }
      }

      // 4. Plugin validator gates
      const pluginValidators = await this.pluginValidatorsPromise
      const validatorCommands = pickPluginValidators(
        pluginValidators,
        modifiedFiles,
        ranBash,
      )
      for (const { command, timeoutMs: validatorTimeoutMs } of validatorCommands) {
        const result = await runGateCommands(
          [command],
          this.cwd,
          validatorTimeoutMs ?? timeoutMs,
        )
        if (!result.ok) {
          this.bumpRejection(turnId)
          const failed = result as Extract<typeof result, { ok: false }>
          return {
            ok: false,
            reminder: `[plugin validator] ${failed.reminder}`,
          }
        }
      }
    }

    return { ok: true }
  }

  /**
   * L2 nudge: if L1 passed on a mutating turn and we have not yet
   * nudged the model to spawn the verification subagent, return the
   * reminder. Otherwise null. Caller is expected to inject the reminder
   * as a user message and re-enter the loop.
   */
  shouldNudgeSubagent(
    turnId: string,
    hadToolCalls: boolean,
  ): SubagentNudge | null {
    if (this.mode === 'off') return null
    if (!this.enableSubagentNudge) return null
    if (this.nudgedTurns.has(turnId)) return null
    // Only nudge when the model is about to finish (no further tool calls)
    // AND it actually changed something — otherwise verification is a
    // no-op cost.
    if (hadToolCalls) return null
    if (!this.ledger.hasMutatingEffect(turnId)) return null
    const nudge = buildSubagentNudge({
      modifiedFiles: this.ledger.modifiedFiles(turnId),
      ranBash: this.ledger.ranBash(turnId),
      userTaskHint: this.userTaskHintByTurn.get(turnId),
    })
    return nudge
  }

  markSubagentNudged(turnId: string): void {
    this.nudgedTurns.add(turnId)
  }

  /** Drop ledger + rejection state for a finished turn. */
  endTurn(turnId: string): void {
    this.ledger.forget(turnId)
    this.rejectionsByTurn.delete(turnId)
    this.nudgedTurns.delete(turnId)
    this.userTaskHintByTurn.delete(turnId)
  }

  private bumpRejection(turnId: string): void {
    this.rejectionsByTurn.set(
      turnId,
      (this.rejectionsByTurn.get(turnId) ?? 0) + 1,
    )
  }

  /**
   * If the verifier has already rejected this turn `maxRejections` times,
   * stop rejecting — let the agent finish so the user can see what happened
   * and intervene. Without this cap we risk infinite loops on a
   * misconfigured project gate or an over-eager claim detector.
   */
  private shouldBail(turnId: string): boolean {
    const rejections = this.rejectionsByTurn.get(turnId) ?? 0
    return rejections >= this.maxRejections
  }

  private autoDetectedAfterEditCommands(): string[] {
    return detectProjectQualityStack(this.cwd).commands.map(
      command => command.command,
    )
  }
}

function pickPluginValidators(
  validators: PluginValidator[],
  modifiedFiles: string[],
  ranBash: boolean,
): PluginValidator[] {
  return validators.filter(v => {
    if (v.when === 'always') return true
    if (v.when === 'afterBash') return ranBash
    // Default afterEdit
    if (modifiedFiles.length === 0) return false
    if (!v.patterns || v.patterns.length === 0) return true
    const matcher = picomatch(v.patterns)
    return modifiedFiles.some(file => matcher(file))
  })
}

export { ToolEffectLedger } from './ledger.js'
export { LoopDetector } from './loopDetector.js'
export {
  hasNonIgnoredEdits,
  loadVerifyConfig,
  pickCommands,
  runGateCommands,
  type VerifyConfig,
} from './projectGates.js'
export {
  detectDoneClaim,
  evaluateDoneGate,
  type ClaimKind,
  type DoneGateResult,
} from './doneDetector.js'
export { buildSubagentNudge, type SubagentNudge } from './subagentNudge.js'
