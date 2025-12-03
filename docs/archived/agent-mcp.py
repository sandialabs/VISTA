# server.py
from fastmcp import FastMCP
from typing import Literal, List, Optional
import subprocess, json, os

mcp = FastMCP("AgentBridge")

def _run(cmd: List[str]) -> str:
    p = subprocess.run(cmd, capture_output=True, text=True)
    out = (p.stdout or "").strip() or (p.stderr or "").strip()
    return out if p.returncode == 0 else f"ERROR({p.returncode}): {out}"

@mcp.tool
def invoke_agent(
    agent: Literal["claude","gemini","codex"],
    prompt: str,
    args: Optional[List[str]] = None,
    json_out: bool = True,
    model: Optional[str] = None,
    yolo: bool = True  # full-permission by default
) -> str:
    """
    Invoke a local coding agent CLI.
    agent: which CLI to call
    prompt: instruction text
    args: extra flags
    json_out: request structured output if supported
    model: optional model hint
    yolo: skip interactive approvals where supported
    """
    args = args or []
    if agent == "claude":
        cmd = ["claude","-p",prompt]
        if yolo: cmd += ["--dangerously-skip-permissions"]
        if json_out: cmd += ["--output-format","json"]
        if model: cmd += ["--model",model]
    elif agent == "gemini":
        cmd = ["gemini","-p",prompt]
        if yolo: cmd += ["--yolo"]
        if json_out: cmd += ["--output-format","json"]
        if model: cmd += ["-m",model]
    else:  # codex
        cmd = ["codex","exec",prompt]  # non-interactive; no approvals flow
        if model: cmd += ["-m",model]
        if json_out: cmd += ["--json"]  # if your codex build supports it
    cmd += args
    out = _run(cmd)
    if json_out:
        try: return json.dumps(json.loads(out), ensure_ascii=False)
        except: pass
    return out

if __name__ == "__main__":
    mcp.run()
