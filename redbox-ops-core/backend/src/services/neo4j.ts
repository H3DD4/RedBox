import neo4j, { type Driver, type Session } from 'neo4j-driver';

let driver: Driver | null = null;

export function getNeo4jDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      process.env.NEO4J_URI ?? 'bolt://localhost:7687',
      neo4j.auth.basic(
        process.env.NEO4J_USER ?? 'neo4j',
        process.env.NEO4J_PASSWORD ?? ''
      )
    );
  }
  return driver;
}

export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

export async function runQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const session: Session = getNeo4jDriver().session({
    database: process.env.NEO4J_DATABASE ?? 'pentesting',
  });
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject() as T);
  } catch (err) {
    console.error('[Graph] Query failed:', err);
    return [];
  } finally {
    await session.close();
  }
}

process.on('SIGTERM', () => { closeNeo4j().catch(console.error); });
process.on('SIGINT',  () => { closeNeo4j().catch(console.error); });
