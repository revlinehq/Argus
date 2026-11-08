import type { QueryCtx, MutationCtx } from "./_generated/server";

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  return identity.subject;
}

export function checkWorkerSecret(secret: string) {
  const expected = process.env.WORKER_SECRET;
  if (!expected || secret !== expected) throw new Error("Bad worker secret");
}
