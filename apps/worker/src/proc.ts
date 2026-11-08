import { spawn } from "node:child_process";

/** Run a command to completion, resolving stdout; rejects with stderr tail on failure. */
export function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${signal ?? code}: ${lastLine(err)}`));
    });
  });
}

export function lastLine(s: string) {
  return s.trim().split("\n").filter(Boolean).pop()?.slice(0, 300) ?? "";
}
