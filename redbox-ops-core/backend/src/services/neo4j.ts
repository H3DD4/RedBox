import neo4j, { type Driver, type Session } from 'neo4j-driver';

const CONNECTIVITY_TTL_MS = Number.parseInt(process.env.NEO4J_CONNECTIVITY_TTL_MS ?? '30000', 10);
const QUERY_MAX_RETRIES = Number.parseInt(process.env.NEO4J_QUERY_MAX_RETRIES ?? '2', 10);
const QUERY_RETRY_BASE_MS = Number.parseInt(process.env.NEO4J_QUERY_RETRY_BASE_MS ?? '200', 10);
const CONNECTION_TIMEOUT_MS = Number.parseInt(process.env.NEO4J_CONNECT_TIMEOUT_MS ?? '5000', 10);
const CONNECTION_ACQUISITION_TIMEOUT_MS = Number.parseInt(process.env.NEO4J_CONNECTION_ACQUISITION_TIMEOUT_MS ?? '5000', 10);
const MAX_CONN_LIFETIME_MS = Number.parseInt(process.env.NEO4J_MAX_CONNECTION_LIFETIME_MS ?? '600000', 10);
const MAX_TX_RETRY_MS = Number.parseInt(process.env.NEO4J_MAX_RETRY_TIME_MS ?? '15000', 10);

let driver: Driver | null = null;
let lastConnectivityCheckMs = 0;
let lastConnectivityOk = false;
let connectivityInFlight: Promise<boolean> | null = null;

export function getNeo4jDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      process.env.NEO4J_URI ?? 'bolt://localhost:7687',
      neo4j.auth.basic(
        process.env.NEO4J_USER ?? 'neo4j',
        process.env.NEO4J_PASSWORD ?? ''
      ),
      {
        disableLosslessIntegers: true,
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        connectionAcquisitionTimeout: CONNECTION_ACQUISITION_TIMEOUT_MS,
        maxConnectionLifetime: MAX_CONN_LIFETIME_MS,
        maxTransactionRetryTime: MAX_TX_RETRY_MS,
      }
    );
  }
  return driver;
}

export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
  lastConnectivityCheckMs = 0;
  lastConnectivityOk = false;
  connectivityInFlight = null;
}

export async function runQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const driverInstance = getNeo4jDriver();
  const database = process.env.NEO4J_DATABASE ?? 'pentesting';

  const connectivityOk = await verifyConnectivityCached(driverInstance);
  if (!connectivityOk) {
    console.warn('[Graph] Neo4j connectivity check failed; skipping query.');
    return [];
  }

  for (let attempt = 0; attempt <= QUERY_MAX_RETRIES; attempt++) {
    const session: Session = driverInstance.session({ database });
    try {
      const result = await session.run(cypher, params);
      return result.records.map((r) => r.toObject() as T);
    } catch (err) {
      const shouldRetry = isRetriableNeo4jError(err);
      const isLastAttempt = attempt >= QUERY_MAX_RETRIES;
      if (!shouldRetry || isLastAttempt) {
        console.error('[Graph] Query failed:', err);
        return [];
      }
      await delay(QUERY_RETRY_BASE_MS * (attempt + 1));
    } finally {
      await session.close();
    }
  }

  return [];
}

process.on('SIGTERM', () => { closeNeo4j().catch(console.error); });
process.on('SIGINT',  () => { closeNeo4j().catch(console.error); });

function isRetriableNeo4jError(err: unknown): boolean {
  const message = typeof (err as { message?: unknown })?.message === 'string'
    ? ((err as { message: string }).message).toLowerCase()
    : '';
  const code = getNeo4jErrorCode(err)?.toLowerCase() ?? '';

  if (code.startsWith('neo.transienterror')) return true;
  if (message.includes('service unavailable')) return true;
  if (message.includes('session expired')) return true;
  if (message.includes('connection')) return true;
  if (message.includes('timed out') || message.includes('timeout')) return true;
  if (message.includes('routing') && message.includes('failure')) return true;

  return false;
}

function getNeo4jErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const anyErr = err as { code?: unknown; neo4jCode?: unknown };
  if (typeof anyErr.code === 'string') return anyErr.code;
  if (typeof anyErr.neo4jCode === 'string') return anyErr.neo4jCode;
  return undefined;
}

async function verifyConnectivityCached(driverInstance: Driver): Promise<boolean> {
  const now = Date.now();
  if (now - lastConnectivityCheckMs < CONNECTIVITY_TTL_MS) {
    return lastConnectivityOk;
  }

  if (connectivityInFlight) return connectivityInFlight;

  connectivityInFlight = driverInstance.verifyConnectivity()
    .then(() => {
      lastConnectivityOk = true;
      lastConnectivityCheckMs = Date.now();
      return true;
    })
    .catch(() => {
      lastConnectivityOk = false;
      lastConnectivityCheckMs = Date.now();
      return false;
    })
    .finally(() => {
      connectivityInFlight = null;
    });

  return connectivityInFlight;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
