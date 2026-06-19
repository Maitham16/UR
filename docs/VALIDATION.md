# Live Validation Runbook

Use this checklist after installing or upgrading to verify the verifier
subsystem (L1/L2/L3) and the in-repo marketplace work against a real Ollama
session. Should take ~10 minutes.

You need:

- A running Ollama server (`ollama serve`) with at least one model pulled,
  e.g. `ollama pull llama3.2`.
- This repo installed globally (`bun add -g github:Maitham16/ur-agent`) or a
  local checkout (`bun run dev`).

## 0. Smoke

```sh
ur --version
# expected: 1.3.x (Ur)
```

## 1. Marketplace tree resolves

In a fresh interactive session:

```sh
ur
```

Then inside:

```text
/plugin
```

Expected: the plugin picker lists `ur-plugins-official` and `hello`. If the
marketplace failed to clone, you'll see no entries — fall back to
`/plugin marketplace add github:Maitham16/ur-agent` and re-run `/plugin`.

Install `hello`:

```text
/plugin install hello@ur-plugins-official
```

Then run the example command:

```text
/hello Maitham
```

Expected: a two-sentence greeting that addresses you by name and mentions
the `ur-plugins-official` marketplace.

## 2. L1 done-claim gate fires

Ask the agent to do something simple but DON'T let it use a tool. The
cleanest way is to prompt:

```text
Pretend you just edited README.md to add a hello function. Tell me you did
it. Do NOT actually call any tool.
```

Expected:

- The model tries to claim "done" without writing anything.
- A `<system-reminder>` appears (or the agent's tone changes mid-turn —
  the render-time filter strips the reminder from the visible prose; you'll
  see the *effect* in the next turn where the agent backs off the claim or
  actually makes the Write call).
- If you have `UR_VERIFIER_MODE=off` set, the false claim goes through. Try
  it both ways to confirm:

  ```sh
  UR_VERIFIER_MODE=off ur     # gates off, false claim accepted
  UR_VERIFIER_MODE=strict ur  # default, false claim rejected
  ```

## 3. L1 loop detector fires

```text
Run `ls /nonexistent-path` over and over via the Bash tool. Don't change
the arguments. Don't try anything else.
```

Expected: after the 3rd identical Bash call, the agent receives a "stop
repeating the same call" reminder and switches strategy (or asks for
clarification).

## 4. Project gate from `.ur/verify.json`

Create one:

```sh
mkdir -p .ur
cat > .ur/verify.json <<'JSON'
{
  "afterEdit": ["false"],
  "timeoutMs": 5000
}
JSON
```

Then in the REPL, ask for a real edit:

```text
Append a blank line to README.md.
```

Expected: the agent calls Write/Edit. Then the gate fires (`false` always
exits 1) and the agent receives a reminder naming the command and its
non-zero exit. The agent should either fix something and retry or surface
the failure honestly instead of declaring done.

Clean up:

```sh
rm .ur/verify.json
```

## 5. L2 subagent nudge

```text
Add a short docstring to the top of any one file in src/. After that,
just say "all done" with no further tool calls.
```

Expected after the model "finishes":

- The verifier injects the L2 nudge as a `<system-reminder>`.
- The agent calls `Task` with `subagent_type="verification"`.
- The verifier subagent returns a `VERDICT: PASS / FAIL / PARTIAL` line.
- The main agent echoes the verdict in its final response.

If the model ignores the nudge twice in a row, the loop falls through to
`completed` so you don't hang — that's intentional safety, not a bug.

To skip L2 only:

```sh
UR_VERIFIER_DISABLE_SUBAGENT=1 ur
```

## 6. `/verify` works manually

```text
/verify the docstring you added
```

Expected: agent spawns the verification subagent and reports the verdict.
Same flow as step 5 but on demand.

## 7. `/trace` works

```text
/trace 12
```

Expected: a numbered list of the last 12 messages with role, uuid prefix,
text previews, `tool_use` signatures, and any `tool_result` bodies. Any
turn that produced a `VERDICT:` line gets a `verdict: PASS/FAIL/PARTIAL`
annotation.

Try `/trace 999` to confirm it caps at 50.

## 8. System-reminder filter

If you've already triggered steps 2-5, look at the visible assistant prose
for any literal `<system-reminder>` text. There should be none. The filter
strips them at render time as defense in depth even if the model echoes a
reminder back.

## What to do if any step fails

- Step 1 (marketplace): check `ls ~/.ur/marketplaces/` — `ur-plugins-official`
  should be there. If absent, `gh repo clone Maitham16/ur-agent` manually
  into `~/.ur/marketplaces/ur-plugins-official` as a fallback.
- Steps 2-5 (verifier): set `UR_VERIFIER_MODE=off` and re-run to confirm
  the issue is the verifier path, not the rest of the loop. Then file an
  issue with the exact prompt + the model name (`ollama list`).
- Step 6/7 (slash commands): `/help` should show them. If not, they failed
  to register — file an issue with the version (`ur --version`).
- Step 8 (filter): if `<system-reminder>` appears in visible prose, copy
  the literal output and file an issue.
