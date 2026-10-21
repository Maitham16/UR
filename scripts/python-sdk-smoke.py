"""Smoke the already installed wheel under a PATH with no Bun and no dependencies."""
import importlib.metadata
import json
import os
import sys
import tempfile
from pathlib import Path
from ur_agent import UrClient

with tempfile.TemporaryDirectory(prefix="ur-wheel-smoke-") as directory:
    fixture = Path(directory) / "agent.py"
    fixture.write_text('''import json,sys
for line in sys.stdin:
 message=json.loads(line)
 if message.get("type")=="user":
  print(json.dumps({"type":"result","subtype":"success","is_error":False,"result":"WHEEL_SDK_OK","cost_status":"unknown"}),flush=True)
''', encoding="utf8")
    result = UrClient(executable=sys.executable, executable_args=[str(fixture)], env={"PATH": "/usr/bin:/bin"}, timeout=10).query("wheel proof")
    assert result.ok and result.text == "WHEEL_SDK_OK", result
    assert result.result["cost_status"] == "unknown"
    requirements = importlib.metadata.requires("ur-agent-sdk")
    assert not requirements, requirements
    print(json.dumps({"ok": True, "package": importlib.metadata.version("ur-agent-sdk"), "runtime_dependencies": requirements, "text": result.text}))
