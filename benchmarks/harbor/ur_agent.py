"""Run UR's own loop in Harbor task environments (Harbor 0.24.0 contract).

Requires an explicit immutable UR release version. The installed agent needs
neither Node.js nor Bun. Provider configuration is supplied through Harbor's
agent environment; this adapter does not substitute another agent's runtime.
"""
import json
import math
import re
import shlex
from pathlib import Path
from urllib.parse import urlparse

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class UrAgent(BaseInstalledAgent):
    @staticmethod
    def name() -> str:
        return "ur-nexus"

    def __init__(self, logs_dir: Path, version: str | None = None,
                 max_turns: int | None = None, max_budget_usd: float | None = None,
                 skip_permissions: bool = False, provider: str | None = None,
                 base_url: str | None = None, **kwargs):
        if not version or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
            raise ValueError("Pass --ak version=<published UR version> for reproducible native installation")
        if max_turns is not None and (isinstance(max_turns, bool) or not isinstance(max_turns, int) or max_turns < 1):
            raise ValueError("max_turns must be a positive integer")
        if max_budget_usd is not None and (isinstance(max_budget_usd, bool) or not isinstance(max_budget_usd, (int, float)) or not math.isfinite(max_budget_usd) or max_budget_usd <= 0):
            raise ValueError("max_budget_usd must be positive")
        if provider is not None and not re.fullmatch(r"[a-z0-9-]{1,128}", provider):
            raise ValueError("provider must be a canonical UR provider ID")
        if base_url is not None:
            url = urlparse(base_url)
            if not provider or url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
                raise ValueError("base_url requires provider and an HTTP(S) endpoint without credentials")
        self.max_turns = max_turns
        self.max_budget_usd = max_budget_usd
        self.skip_permissions = skip_permissions
        self.provider = provider
        self.base_url = base_url
        super().__init__(logs_dir=logs_dir, version=version, **kwargs)

    async def install(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(environment, command="command -v curl >/dev/null && command -v git >/dev/null || (apt-get update && apt-get install -y ca-certificates curl git)")
        url = f"https://github.com/Maitham16/UR/releases/download/v{self.version()}/install.sh"
        # The release's installer validates the native archive checksum/version.
        await self.exec_as_agent(environment, command=f"set -eu; installer=$(mktemp); trap 'rm -f \"$installer\"' EXIT; curl --fail --silent --show-error --location {shlex.quote(url)} -o \"$installer\"; sh \"$installer\" {shlex.quote(self.version())}")

    @with_prompt_template
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        args = ["-p", "--verbose", "--output-format", "stream-json"]
        if self.provider:
            settings = {"active": self.provider}
            if self.base_url:
                settings["baseUrls"] = {self.provider: self.base_url}
            args += ["--settings", json.dumps({"provider": settings})]
        if self.model_name:
            args += ["--model", self.model_name]
        if self.max_turns is not None:
            args += ["--max-turns", str(self.max_turns)]
        if self.max_budget_usd is not None:
            args += ["--max-budget-usd", str(self.max_budget_usd)]
        if self.skip_permissions:
            args += ["--dangerously-skip-permissions"]
        args.append(instruction)
        command = 'mkdir -p /logs/agent; "$HOME/.local/bin/ur" ' + shlex.join(args) + ' > /logs/agent/ur-stream.jsonl 2> /logs/agent/ur-stderr.log'
        await self.exec_as_agent(environment, command=command)

    def populate_context_post_run(self, context: AgentContext) -> None:
        stream = self.logs_dir / "ur-stream.jsonl"
        if not stream.is_file():
            return
        final = None
        for line in stream.read_text(encoding="utf8").splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(event, dict) and event.get("type") == "result":
                final = event
        if final is None:
            return
        usage = final.get("usage") or {}
        for source, target in [("input_tokens", "n_input_tokens"), ("output_tokens", "n_output_tokens"), ("cache_read_input_tokens", "n_cache_tokens")]:
            value = usage.get(source)
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                setattr(context, target, value)
        cost = final.get("total_cost_usd")
        if final.get("cost_status") != "unknown" and isinstance(cost, (int, float)) and not isinstance(cost, bool) and cost >= 0:
            context.cost_usd = cost
        context.metadata = {**(context.metadata or {}), "agent": "ur-nexus", "version": self.version(), "session_id": final.get("session_id"), "agent_error": final.get("is_error")}
