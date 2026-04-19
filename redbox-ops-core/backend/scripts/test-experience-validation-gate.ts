import { getDb } from '../src/db.js';

function run() {
  const db = getDb();

  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='experiences'")
    .get() as { name: string } | undefined;

  if (!tableExists) {
    console.log(JSON.stringify({ ok: false, reason: 'experiences table missing' }, null, 2));
    return;
  }

  const rows = db
    .prepare(`
      SELECT id, run_id, tool, output_signature, validation_status, created_at
      FROM experiences
      ORDER BY created_at DESC
      LIMIT 100
    `)
    .all() as Array<{
      id: string;
      run_id: string;
      tool: string;
      output_signature: string;
      validation_status: string;
      created_at: string;
    }>;

  const noisy = rows.filter((r) => {
    const sig = (r.output_signature || '').toLowerCase();
    return (
      sig.length < 8 ||
      sig.includes('placeholder') ||
      sig.includes('example') ||
      sig.includes('dummy') ||
      sig.includes('actual_flag') ||
      sig.includes('your_flag') ||
      sig.includes('replace_this') ||
      sig.startsWith('open_ports') ||
      sig.startsWith('paths:') ||
      sig.startsWith('interesting:')
    );
  });

  const flags = rows.filter((r) => (r.output_signature || '').startsWith('FLAG: '));

  console.log(
    JSON.stringify(
      {
        ok: noisy.length === 0,
        totalExperiences: rows.length,
        flagExperiences: flags.length,
        noisyCount: noisy.length,
        noisySample: noisy.slice(0, 10),
      },
      null,
      2
    )
  );
}

run();
