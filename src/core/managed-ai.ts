import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
import { createAzureModel } from "../ai/azure.js";
import type { JsonModel } from "../ai/json-model.js";
import type { ManagedStepTicket } from "./step-ticket.js";

/** Operational replay/rate metadata only. No keys, accounts, questions or model output. */
export function createManagedClaims(file: string, clock = () => Math.floor(Date.now() / 1000)) {
  const db = new DatabaseSync(file, { allowExtension: false });
  if (file !== ":memory:") chmodSync(file, 0o600);
  db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS claims(jti TEXT PRIMARY KEY, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS gate(id INTEGER PRIMARY KEY CHECK(id=1), next_start INTEGER NOT NULL, active_until INTEGER NOT NULL, active_jti TEXT); INSERT OR IGNORE INTO gate VALUES(1,0,0,NULL)");
  return {
    claim(jti: string, expires: number) {
      const time = clock();
      if (!/^[\w-]{43}$/.test(jti) || !Number.isSafeInteger(expires) || expires <= time || expires > time + 120) throw new Error("MANAGED_TICKET");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM claims WHERE expires<?").run(time - 86400);
        if (db.prepare("SELECT 1 FROM claims WHERE jti=?").get(jti)) throw new Error("MANAGED_REPLAY");
        const gate = db.prepare("SELECT next_start,active_until FROM gate WHERE id=1").get()!;
        if (Number(gate.active_until) > time) throw new Error("MANAGED_BUSY");
        if (Number(gate.next_start) > time) throw new Error("MANAGED_RATE");
        db.prepare("INSERT INTO claims VALUES(?,?)").run(jti, expires);
        db.prepare("UPDATE gate SET next_start=?,active_until=?,active_jti=? WHERE id=1").run(time + 65, time + 120, jti);
        db.exec("COMMIT");
      } catch (cause) { db.exec("ROLLBACK"); throw cause; }
    },
    finish(jti: string) { db.prepare("UPDATE gate SET active_until=0,active_jti=NULL WHERE id=1 AND active_jti=?").run(jti); },
    close() { db.close(); },
  };
}

export function createManagedAzure(input: { apiKey: string; claims: ReturnType<typeof createManagedClaims>; fetchImpl?: Parameters<typeof createAzureModel>[0]["fetchImpl"] }) {
  return (ticket: ManagedStepTicket) => {
    const azure = createAzureModel({ apiKey: input.apiKey, maxUsd: 1, maxCalls: 1, maxInputTokens: ticket.maxInputTokens, profile: "low-4096", ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}) });
    let started = false;
    const model: JsonModel = { provider: azure.model.provider, model: azure.model.model, async generate(request) {
      request.signal?.throwIfAborted();
      if (started) throw new Error("MANAGED_REPLAY");
      input.claims.claim(ticket.jti, ticket.exp); started = true;
      try { return await azure.model.generate(request); } finally { input.claims.finish(ticket.jti); }
    } };
    return { model, summary: azure.summary };
  };
}
