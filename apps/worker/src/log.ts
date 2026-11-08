/** Tiny prefixed logger: `const log = logger("capture:abc")`. */
export function logger(prefix: string) {
  const tag = `[${prefix}]`;
  const ts = () => new Date().toISOString().slice(11, 19);
  return {
    info: (...a: unknown[]) => console.log(ts(), tag, ...a),
    warn: (...a: unknown[]) => console.warn(ts(), tag, "WARN", ...a),
    error: (...a: unknown[]) => console.error(ts(), tag, "ERROR", ...a),
  };
}

export type Logger = ReturnType<typeof logger>;

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
