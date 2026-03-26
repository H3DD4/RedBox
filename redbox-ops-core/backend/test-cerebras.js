// Quick test for Cerebras API
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data/redbox.db');

const db = new Database(dbPath);

// Get Cerebras provider from DB
const provider = db.prepare("SELECT * FROM llm_providers WHERE type = 'cerebras' LIMIT 1").get();

if (!provider) {
  console.log("❌ No Cerebras provider configured in database.");
  console.log("   Go to Settings in RedBox and add Cerebras with your API key.");
  process.exit(1);
}

console.log("Found provider:", provider.name);
console.log("Model:", provider.model);
console.log("Endpoint:", provider.endpoint);
console.log("API Key:", provider.api_key ? "✓ Set" : "❌ Not set");

if (!provider.api_key) {
  console.log("\n❌ No API key configured for Cerebras.");
  process.exit(1);
}

// Test the API with Qwen 235B
const testModel = "qwen-3-235b-a22b-instruct-2507";
console.log("\n🧪 Testing Cerebras API with Qwen 235B...\n");

const response = await fetch(`${provider.endpoint}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${provider.api_key}`
  },
  body: JSON.stringify({
    model: testModel,
    messages: [{ role: 'user', content: 'Say "Hello" in one word only.' }],
    max_tokens: 10,
    temperature: 0.3
  })
});

if (!response.ok) {
  const error = await response.text();
  console.log(`❌ API Error (${response.status}):`, error);
  process.exit(1);
}

const data = await response.json();
console.log("✅ API Response:");
console.log("   Model:", data.model);
console.log("   Response:", data.choices?.[0]?.message?.content);
console.log("   Usage:", data.usage);
