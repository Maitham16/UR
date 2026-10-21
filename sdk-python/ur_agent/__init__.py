"""Supported UR SDK wire revision 1. Python 3.10+, standard library only."""
from __future__ import annotations
import codecs
import json
import os
import queue
import subprocess
import threading
import uuid
import urllib.request
import urllib.parse
from dataclasses import dataclass
from typing import Any, Callable, Iterator

PROTOCOL_VERSION = 1

@dataclass
class QueryResult:
    ok: bool
    text: str
    raw: str
    exit_code: int
    stderr: str
    session_id: str | None
    canceled: bool
    error: str | None = None
    result: dict | None = None

class Run:
    """One native CLI turn. Iterate events, approve request IDs, cancel, or wait."""
    def __init__(self, prompt: str, *, cwd=None, model=None, max_turns=None,
                 resume_session_id=None, executable=None, executable_args=None,
                 env=None, timeout=1800, skip_permissions=False, on_permission=None,
                 max_output_bytes=64 * 1024 * 1024, max_queued_events=4096):
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("prompt must be nonempty text")
        if timeout <= 0 or max_output_bytes <= 0 or max_queued_events <= 0:
            raise ValueError("timeout and buffering limits must be positive")
        args = [executable or os.environ.get("UR_EXECUTABLE", "ur"), *(executable_args or []),
                "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-prompt-tool", "stdio"]
        if model: args += ["--model", model]
        if max_turns is not None:
            if not isinstance(max_turns, int) or max_turns <= 0: raise ValueError("max_turns must be a positive integer")
            args += ["--max-turns", str(max_turns)]
        if resume_session_id: args += ["--resume", resume_session_id]
        if skip_permissions: args += ["--dangerously-skip-permissions"]
        self.session_id = resume_session_id
        self._events = queue.Queue(max_queued_events)
        self._done = threading.Event()
        self._pending = {}
        self._lock = threading.Lock()
        self._claimed = False
        self._canceled = False
        self._failure = None
        self._result = None
        self._stderr = ""
        self._raw = []
        self._final = None
        self._process = None
        self._kill_timer = None
        self._timeout = threading.Timer(timeout, self._timed_out)
        self._timeout.daemon = True
        try:
            self._process = subprocess.Popen(args, cwd=cwd, env={**os.environ, **(env or {})},
                                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except OSError as error:
            self._failure = str(error)
            self._finish(1)
            return
        def read_stderr():
            decoder = codecs.getincrementaldecoder("utf-8")("replace")
            while chunk := self._process.stderr.read1(65536):
                self._stderr = (self._stderr + decoder.decode(chunk))[-65536:]
            self._stderr = (self._stderr + decoder.decode(b"", final=True))[-65536:]
        stderr_thread = threading.Thread(target=read_stderr, daemon=True)
        stderr_thread.start()
        def read_stdout():
            decoder = codecs.getincrementaldecoder("utf-8")("strict")
            pending_text, size, sequence = "", 0, 0
            def accept(line):
                nonlocal sequence
                if not line.strip(): return
                event = json.loads(line)
                if not isinstance(event, dict) or not isinstance(event.get("type"), str): raise ValueError("Malformed stream-json event")
                if isinstance(event.get("session_id"), str): self.session_id = event["session_id"]
                if event["type"] == "result":
                    if self._final is not None: raise ValueError("UR emitted multiple result frames")
                    self._final = event
                    if self._process.stdin and not self._process.stdin.closed: self._process.stdin.close()
                if event["type"] == "control_cancel_request": self._pending.pop(event.get("request_id"), None)
                if event["type"] == "control_request" and event.get("request", {}).get("subtype") == "can_use_tool":
                    request_id = event["request_id"]
                    original_input = event["request"].get("input", {})
                    if not isinstance(original_input, dict): raise ValueError("Permission input must be an object")
                    self._pending[request_id] = json.loads(json.dumps(original_input))
                    if on_permission:
                        request = event["request"]
                        def answer(request_id=request_id, request=request, raw=event):
                            try: decision = on_permission({"request_id": request_id, "tool_name": request.get("tool_name", ""), "input": request.get("input", {}), "raw": raw})
                            except Exception as error: decision = {"behavior": "deny", "message": "Permission callback failed: " + str(error)}
                            if request_id in self._pending and not self._done.is_set() and not self._canceled:
                                try: self.approve(request_id, decision)
                                except Exception as error:
                                    if not self._done.is_set() and not self._canceled:
                                        self._failure = str(error)
                                        self._terminate()
                        threading.Thread(target=answer, daemon=True).start()
                sequence += 1
                self._events.put_nowait({"protocolVersion": PROTOCOL_VERSION, "sequence": sequence, "sessionId": self.session_id, "transport": "local", "event": event})
            try:
                while chunk := self._process.stdout.read1(65536):
                    size += len(chunk)
                    if size > max_output_bytes: raise ValueError("UR output exceeded max_output_bytes")
                    text = decoder.decode(chunk)
                    self._raw.append(text)
                    pending_text += text
                    while "\n" in pending_text:
                        line, pending_text = pending_text.split("\n", 1)
                        accept(line)
                    if len(pending_text.encode("utf-8")) > 16 * 1024 * 1024: raise ValueError("Stream JSON line exceeds 16 MiB")
                tail = decoder.decode(b"", final=True)
                self._raw.append(tail)
                accept(pending_text + tail)
            except Exception as error:
                self._failure = "Event queue exceeded max_queued_events" if isinstance(error, queue.Full) else str(error)
                self._terminate()
            code = self._process.wait()
            stderr_thread.join()
            self._finish(code)
        self._timeout.start()
        threading.Thread(target=read_stdout, daemon=True).start()
        try:
            with self._lock:
                for message in [{"type": "control_request", "request_id": str(uuid.uuid4()), "request": {"subtype": "initialize"}}, {"type": "user", "session_id": "", "message": {"role": "user", "content": prompt}, "parent_tool_use_id": None}]:
                    self._process.stdin.write((json.dumps(message) + "\n").encode("utf-8"))
                self._process.stdin.flush()
        except Exception as error:
            self._failure = str(error)
            self._terminate()

    def _terminate(self):
        if self._process and self._process.poll() is None:
            self._process.terminate()
            if self._kill_timer is None:
                def kill():
                    if self._process.poll() is None: self._process.kill()
                self._kill_timer = threading.Timer(2, kill)
                self._kill_timer.daemon = True
                self._kill_timer.start()
    def _timed_out(self):
        self._failure = "UR exceeded configured timeout"
        self._terminate()
    def _finish(self, code):
        self._timeout.cancel()
        if self._kill_timer: self._kill_timer.cancel()
        self._pending.clear()
        error = self._failure
        if not error:
            if self._canceled: error = "Run canceled"
            elif code != 0: error = "UR exited with code " + str(code)
            elif self._final is None: error = "UR exited without a result frame"
            elif self._final.get("is_error") or str(self._final.get("subtype", "")).startswith("error"): error = "UR reported an error result"
        text = self._final.get("result", self._final.get("text", "")) if self._final else ""
        self._result = QueryResult(not error, text if isinstance(text, str) else json.dumps(text), "".join(self._raw), code, self._stderr, self.session_id, self._canceled, error, self._final)
        self._done.set()
    def approve(self, request_id: str, decision: dict):
        with self._lock:
            if request_id not in self._pending or self._done.is_set() or self._canceled: raise ValueError("Permission request is no longer pending")
            if decision.get("behavior") not in ("allow", "deny"): raise ValueError("Permission decision must be allow or deny")
            response = dict(decision)
            if decision["behavior"] == "allow":
                response.setdefault("updatedInput", self._pending[request_id])
                if not isinstance(response["updatedInput"], dict): raise ValueError("updatedInput must be an object")
            else:
                response.setdefault("message", "Permission denied by SDK caller")
                if not isinstance(response["message"], str): raise ValueError("Permission denial message must be text")
            wire = {"type": "control_response", "response": {"request_id": request_id, "subtype": "success", "response": response}}
            self._process.stdin.write((json.dumps(wire) + "\n").encode("utf-8"))
            self._process.stdin.flush()
            del self._pending[request_id]
    def cancel(self):
        if not self._done.is_set():
            self._canceled = True
            self._terminate()
    def __iter__(self) -> Iterator[dict]:
        if self._claimed: raise RuntimeError("A run event stream supports one consumer")
        self._claimed = True
        try:
            while not self._done.is_set() or not self._events.empty():
                try: yield self._events.get(timeout=0.1)
                except queue.Empty: continue
        finally:
            if not self._done.is_set(): self.cancel()
    def wait(self) -> QueryResult:
        if not self._claimed:
            for _ in self: pass
        self._done.wait()
        return self._result
    def __enter__(self): return self
    def __exit__(self, *_):
        self.cancel()
        self._done.wait(3)

class UrClient:
    def __init__(self, **defaults): self.defaults = defaults
    def stream(self, prompt, **options): return Run(prompt, **{**self.defaults, **options})
    def resume(self, session_id, prompt, **options): return self.stream(prompt, resume_session_id=session_id, **options)
    def query(self, prompt, **options):
        merged = {**self.defaults, **options}
        merged.setdefault("on_permission", lambda _: {"behavior": "deny", "message": "No SDK permission callback was provided"})
        return Run(prompt, **merged).wait()
    def query_json(self, prompt, **options):
        result = self.query(prompt, **options)
        if not result.ok: return None
        try: return json.loads(result.text)
        except (ValueError, TypeError): return None

def query(prompt, **options): return UrClient().query(prompt, **options)
def stream(prompt, **options): return Run(prompt, **options)

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("ACP redirects are not permitted")

class RemoteClient:
    """Authenticated canonical ACP HTTP transport, no new server or cloud dependency."""
    def __init__(self, endpoint: str, token: str, *, timeout=30):
        parsed = urllib.parse.urlsplit(endpoint)
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password: raise ValueError("ACP endpoint must be HTTP(S) without embedded credentials")
        if not token.strip(): raise ValueError("ACP token is required")
        self.endpoint = endpoint if parsed.path not in ("", "/") else endpoint.rstrip("/") + "/acp"
        self.token, self.timeout, self._id = token, timeout, 0
        self._opener = urllib.request.build_opener(_NoRedirect)
    def request(self, method, params=None):
        self._id += 1
        request_id = self._id
        request = urllib.request.Request(self.endpoint, data=json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}).encode(), headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}, method="POST")
        with self._opener.open(request, timeout=self.timeout) as response:
            raw = response.read(16 * 1024 * 1024 + 1)
        if len(raw) > 16 * 1024 * 1024: raise ValueError("ACP response exceeded 16 MiB")
        envelope = json.loads(raw)
        if envelope.get("jsonrpc") != "2.0" or envelope.get("id") != request_id: raise ValueError("ACP response identity does not match request")
        if envelope.get("error"): raise RuntimeError("ACP " + method + ": " + str(envelope["error"].get("message", "request failed")))
        if "result" not in envelope: raise ValueError("ACP response has no result")
        return envelope["result"]
    def initialize(self): return self.request("initialize")
    def new_session(self, cwd=None): return self.request("session/new", {"cwd": cwd} if cwd else {})
    def close(self, session_id): return self.request("session/close", {"sessionId": session_id})
    def stream(self, prompt, *, session_id=None, cwd=None, after=None, request_id=None):
        session = self.request("session/resume", {"sessionId": session_id}) if session_id else self.new_session(cwd)
        params = {"sessionId": session["sessionId"], "prompt": prompt, "stream": True}
        if request_id: params["requestId"] = request_id
        self.request("session/prompt", params)
        return RemoteRun(self, session["sessionId"], session.get("lastSequence", 0) if after is None else after)
    def resume(self, session_id, after=0):
        self.request("session/resume", {"sessionId": session_id})
        return RemoteRun(self, session_id, after)

class RemoteRun:
    def __init__(self, client, session_id, after):
        if not isinstance(after, int) or after < 0: raise ValueError("after must be a nonnegative event cursor")
        self.client, self.session_id, self.last_sequence = client, session_id, after
        self._done, self._claimed, self._pending = False, False, set()
        self.result = None
    def _finish(self, error=None, stop_reason=None, canceled=False):
        self._done = True
        self._pending.clear()
        self.result = {"ok": not error and not canceled and stop_reason not in ("cancelled", "canceled"), "sessionId": self.session_id, "lastSequence": self.last_sequence, "error": error, "stopReason": stop_reason, "canceled": canceled}
    def __iter__(self):
        if self._claimed: raise RuntimeError("A run event stream supports one consumer")
        self._claimed = True
        try:
            while not self._done:
                page = self.client.request("session/events", {"sessionId": self.session_id, "after": self.last_sequence, "waitMs": 25000})
                if page.get("protocolVersion") != PROTOCOL_VERSION or not isinstance(page.get("events"), list): raise ValueError("Unsupported ACP event protocol revision")
                for item in page["events"]:
                    if item.get("protocolVersion") != PROTOCOL_VERSION or item.get("sessionId") != self.session_id or item.get("sequence") != self.last_sequence + 1 or not isinstance(item.get("event", {}).get("type"), str): raise ValueError("ACP event stream has a missing, repeated, or mismatched event")
                    self.last_sequence = item["sequence"]
                    if item["event"]["type"] == "permission": self._pending.add(item["event"]["requestId"])
                    yield {**item, "transport": "acp"}
                if page.get("nextCursor") != self.last_sequence: raise ValueError("ACP cursor skipped unobserved events")
                if page.get("error"): raise RuntimeError(page["error"])
                if page.get("done"):
                    stop_reason = page.get("result", {}).get("stopReason")
                    if not stop_reason: raise ValueError("ACP run finished without a result")
                    self._finish(stop_reason=stop_reason)
        except Exception as error: self._finish(error=str(error))
        finally:
            if not self._done: self.disconnect()
    def approve(self, request_id, decision):
        if self._done or request_id not in self._pending: raise ValueError("Permission request is no longer pending")
        if decision.get("behavior") == "allow" and decision.get("updatedInput"): raise ValueError("ACP approvals do not rewrite tool input")
        result = self.client.request("session/approve", {"sessionId": self.session_id, "requestId": request_id, "decision": decision})
        if not result.get("accepted"): raise ValueError("ACP permission decision was not accepted")
        self._pending.remove(request_id)
    def cancel(self):
        if self._done: return
        response = self.client.request("session/cancel", {"sessionId": self.session_id})
        if not response.get("canceled"): raise RuntimeError("ACP did not cancel the running session")
        self._finish(error="Remote run canceled", canceled=True)
    def disconnect(self): self._finish(error="Remote observer disconnected; remote work may still be running")
    def wait(self):
        if not self._claimed:
            for _ in self: pass
        return self.result
