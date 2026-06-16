import 'dotenv/config';
import { readFileSync } from 'fs';
import { getNeo4jDriver, closeNeo4j } from '../src/services/neo4j.js';

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: tsx scripts/run-cypher.ts <path-to.cypher>');
    process.exit(1);
  }

  const cypher = readFileSync(filePath, 'utf-8');
  // Split on semicolons, trim, drop empty lines
  const statements = cypher
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('//'));

  const driver = getNeo4jDriver();
  const session = driver.session({
    database: process.env.NEO4J_DATABASE ?? 'neo4j',
  });

  try {
    for (const stmt of statements) {
      console.log(`[Neo4j] Running: ${stmt.slice(0, 80)}...`);
      await session.run(stmt);
    }
    console.log('[Neo4j] Schema initialised successfully.');
  } catch (err) {
    console.error('[Neo4j] Init failed:', err);
    process.exit(1);
  } finally {
    await session.close();
    await closeNeo4j();
  }
}

main();
