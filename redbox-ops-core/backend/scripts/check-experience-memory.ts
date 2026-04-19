import { getDb } from "../src/db.js";

function main(): void {
  const db = getDb();

  const tableExists = !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='experiences'")
    .get();

  const totalExperiences = tableExists
    ? (db.prepare("SELECT COUNT(*) as c FROM experiences").get() as { c: number }).c
    : 0;

  const latestRun = db
    .prepare("SELECT id, status, target, created_at, completed_at, findings FROM runs ORDER BY created_at DESC LIMIT 1")
    .get() as
    | {
        id: string;
        status: string;
        target: string;
        created_at: string;
        completed_at: string | null;
        findings: string;
      }
    | undefined;

  let latestRunExperienceCount = 0;
  let latestRunExperiences: Array<Record<string, unknown>> = [];
  let latestRunFindingsCount = 0;
  let latestRunHasFlag = false;

  if (latestRun && tableExists) {
    try {
      const findings = JSON.parse(latestRun.findings || "[]") as Array<{ title?: string; evidence?: string }>;
      latestRunFindingsCount = findings.length;
      latestRunHasFlag = findings.some(
        (f) =>
          (f.title || "").toLowerCase().includes("flag") ||
          (f.evidence || "").toLowerCase().includes("flag")
      );
    } catch {
      latestRunFindingsCount = 0;
      latestRunHasFlag = false;
    }

    latestRunExperienceCount = (
      db.prepare("SELECT COUNT(*) as c FROM experiences WHERE run_id = ?").get(latestRun.id) as {
        c: number;
      }
    ).c;

    latestRunExperiences = db
      .prepare(
        "SELECT id, run_id, test_type, phase, tool, output_signature, validation_status, created_at FROM experiences WHERE run_id = ? ORDER BY created_at DESC LIMIT 10"
      )
      .all(latestRun.id) as Array<Record<string, unknown>>;
  }

  console.log(
    JSON.stringify(
      {
        tableExists,
        totalExperiences,
        latestRun,
        latestRunFindingsCount,
        latestRunHasFlag,
        latestRunExperienceCount,
        latestRunExperiences,
      },
      null,
      2
    )
  );
}

main();
process.exit(0);
