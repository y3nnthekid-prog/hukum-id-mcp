import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * Pagar biaya kedua untuk Tanya Pasla, di sisi mesin.
 *
 * Web sudah membatasi kuota per orang dan anggaran bersama. Buku ini menjaga
 * mesin sendiri: plafon harian dan bulanan (zona WIB), giliran berjalan
 * bersamaan, tiket sekali pakai, dan jeda saat Azure membatasi. Setiap giliran
 * menahan perkiraan maksimum sebelum panggilan, lalu diselesaikan dengan biaya
 * token sebenarnya. Giliran yang terputus tetap menahan perkiraan maksimum.
 */
export type TanyaLedger = ReturnType<typeof createTanyaLedger>;

const WIB_SECONDS = 7 * 3600;
export function hariWib(epochSeconds: number) {
  return new Date((epochSeconds + WIB_SECONDS) * 1000).toISOString().slice(0, 10);
}

export function createTanyaLedger(
  file: string,
  limits: { dayMicro: number; monthMicro: number; concurrent: number },
  clock = () => Math.floor(Date.now() / 1000),
) {
  for (const value of [limits.dayMicro, limits.monthMicro, limits.concurrent]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("TANYA_LEDGER_CONFIG");
  }
  const db = new DatabaseSync(file, { allowExtension: false });
  if (file !== ":memory:") chmodSync(file, 0o600);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS holds(jti TEXT PRIMARY KEY, day TEXT NOT NULL, reserved INTEGER NOT NULL, settled INTEGER, active_until INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS holds_day ON holds(day);
    CREATE TABLE IF NOT EXISTS cooldown(id INTEGER PRIMARY KEY CHECK(id=1), until_time INTEGER NOT NULL);
    INSERT OR IGNORE INTO cooldown VALUES(1,0);`);

  const spent = (pattern: string) =>
    Number(db.prepare("SELECT coalesce(sum(coalesce(settled,reserved)),0) AS n FROM holds WHERE day LIKE ?").get(pattern)!.n);
  const cooldownUntil = () => Number(db.prepare("SELECT until_time FROM cooldown WHERE id=1").get()!.until_time);

  return {
    status() {
      const now = clock();
      const day = hariWib(now);
      const dayLeft = limits.dayMicro - spent(day);
      const monthLeft = limits.monthMicro - spent(day.slice(0, 7) + "%");
      const until = cooldownUntil();
      return {
        dayRemainingMicro: Math.max(0, dayLeft),
        monthRemainingMicro: Math.max(0, monthLeft),
        nextAllowedAt: until > now ? until : null,
      };
    },
    /** Pemeriksaan tanpa menulis, sebelum pencarian. Mengembalikan kode penolakan atau null. */
    precheck(reserveMicro: number): string | null {
      const now = clock();
      const day = hariWib(now);
      if (cooldownUntil() > now) return "TANYA_RATE";
      if (Number(db.prepare("SELECT count(*) AS n FROM holds WHERE active_until>?").get(now)!.n) >= limits.concurrent) return "TANYA_BUSY";
      if (spent(day) + reserveMicro > limits.dayMicro) return "TANYA_BUDGET_DAY";
      if (spent(day.slice(0, 7) + "%") + reserveMicro > limits.monthMicro) return "TANYA_BUDGET_MONTH";
      return null;
    },
    /** Menahan anggaran tepat sebelum panggilan model. Melempar bila tidak boleh. */
    admit(jti: string, reserveMicro: number, holdSeconds = 360) {
      const now = clock();
      if (!/^[\w-]{20,100}$/.test(jti) || !Number.isSafeInteger(reserveMicro) || reserveMicro < 1) throw new Error("TANYA_TICKET");
      const day = hariWib(now);
      db.exec("BEGIN IMMEDIATE");
      try {
        if (db.prepare("SELECT 1 FROM holds WHERE jti=?").get(jti)) throw new Error("TANYA_REPLAY");
        if (cooldownUntil() > now) throw new Error("TANYA_RATE");
        const active = Number(db.prepare("SELECT count(*) AS n FROM holds WHERE active_until>?").get(now)!.n);
        if (active >= limits.concurrent) throw new Error("TANYA_BUSY");
        if (spent(day) + reserveMicro > limits.dayMicro) throw new Error("TANYA_BUDGET_DAY");
        if (spent(day.slice(0, 7) + "%") + reserveMicro > limits.monthMicro) throw new Error("TANYA_BUDGET_MONTH");
        db.prepare("INSERT INTO holds VALUES(?,?,?,NULL,?)").run(jti, day, reserveMicro, now + holdSeconds);
        db.exec("COMMIT");
      } catch (cause) {
        db.exec("ROLLBACK");
        throw cause;
      }
    },
    /** Mengganti tahanan dengan biaya sebenarnya. Tidak pernah melebihi tahanan. */
    settle(jti: string, actualMicro: number) {
      if (!Number.isSafeInteger(actualMicro) || actualMicro < 0) throw new Error("TANYA_SETTLE");
      db.prepare("UPDATE holds SET settled=min(reserved,?), active_until=0 WHERE jti=? AND settled IS NULL").run(actualMicro, jti);
    },
    deferUntil(time: number) {
      const now = clock();
      if (!Number.isSafeInteger(time) || time < now || time > now + 86400) throw new Error("TANYA_WAIT");
      db.prepare("UPDATE cooldown SET until_time=max(until_time,?) WHERE id=1").run(time);
    },
    close() {
      db.close();
    },
  };
}
