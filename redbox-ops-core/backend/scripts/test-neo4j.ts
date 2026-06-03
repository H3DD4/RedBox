import 'dotenv/config';
import { getGraphContextWithTimeout, writeServiceDiscovery, writeDeadEnd } from '../src/services/graph-service.js';
import { closeNeo4j } from '../src/services/neo4j.js';

async function testNeo4j() {
  console.log('Testing Neo4j connection...');
  try {
    // 1. Write some mock data
    await writeServiceDiscovery('run-123', '127.0.0.1', 80, 'tcp', 'nginx', 'Welcome');
    await writeDeadEnd('run-123', '127.0.0.1', 'nmap', '/test', 'Mock dead end');
    
    // 2. Read it back
    const context = await getGraphContextWithTimeout('127.0.0.1');
    console.log('Graph Context:', JSON.stringify(context, null, 2));
    
    console.log('✅ Neo4j connection and graph operations are working fine!');
  } catch (err) {
    console.error('❌ Error testing Neo4j:', err);
  } finally {
    await closeNeo4j();
  }
}

testNeo4j();
