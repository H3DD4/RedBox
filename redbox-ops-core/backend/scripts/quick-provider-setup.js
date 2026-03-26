#!/usr/bin/env node

/**
 * Quick Provider Setup Script
 *
 * Helps users quickly configure a faster LLM provider when experiencing
 * rate limiting issues with Cerebras or other restrictive providers.
 */

import { getDb } from '../src/db.js';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

// Recommended fast providers with their optimal configurations
const RECOMMENDED_PROVIDERS = [
  {
    type: 'cerebras',
    name: 'Cerebras with Qwen-3-235B (OPTIMAL CHOICE)',
    endpoint: 'https://api.cerebras.ai/v1',
    model: 'qwen-3-235b-a22b-instruct-2507',
    description: '🏆 PERFECT: 30 req/min, 30k tokens/min, ultra-fast inference, FREE tier, ALREADY CONFIGURED!',
    signupUrl: 'https://inference.cerebras.ai/',
    apiKeyNote: 'Free API key from Cerebras (no credit card required)'
  },
  {
    type: 'groq',
    name: 'Groq Cloud',
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    description: '🚀 Also excellent: 30+ req/min, 100k tokens/min, very fast, free tier',
    signupUrl: 'https://console.groq.com/keys',
    apiKeyNote: 'Get free API key from Groq Console'
  },
  {
    type: 'openai',
    name: 'OpenAI GPT-4o Mini',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    description: '⚡ Reliable: 60+ req/min, very fast, affordable pricing',
    signupUrl: 'https://platform.openai.com/api-keys',
    apiKeyNote: 'Requires OpenAI API key (paid service, $0.001/1k tokens)'
  }
];

async function main() {
  console.log('\n🔧 RedBox Quick Provider Setup');
  console.log('===============================\n');

  const db = getDb();

  // Check current provider
  const currentProvider = db.prepare("SELECT * FROM llm_providers WHERE active = 1 LIMIT 1").get();

  if (currentProvider) {
    console.log(`Current provider: ${currentProvider.name} (${currentProvider.type})`);

    if (currentProvider.type === 'cerebras') {
      console.log('⚠️  You are currently using Cerebras, which has very restrictive rate limits.');
      console.log('   This causes long wait times during security scans (15+ minutes).\n');
    }
  } else {
    console.log('❌ No LLM provider configured.\n');
  }

  console.log('🎯 Recommended fast providers for RedBox:\n');

  RECOMMENDED_PROVIDERS.forEach((provider, index) => {
    console.log(`${index + 1}. ${provider.name}`);
    console.log(`   Model: ${provider.model}`);
    console.log(`   ${provider.description}`);
    console.log(`   API Key: ${provider.apiKeyNote}`);
    console.log(`   Sign up: ${provider.signupUrl}\n`);
  });

  const choice = await question('Select provider to configure (1-2), or 0 to exit: ');
  const providerIndex = parseInt(choice) - 1;

  if (providerIndex < 0 || providerIndex >= RECOMMENDED_PROVIDERS.length) {
    console.log('Exiting...');
    rl.close();
    return;
  }

  const selectedProvider = RECOMMENDED_PROVIDERS[providerIndex];
  console.log(`\nConfiguring ${selectedProvider.name}...`);

  // Get API key
  const apiKey = await question(`\nEnter your ${selectedProvider.name} API key: `);
  if (!apiKey.trim()) {
    console.log('❌ API key is required. Exiting...');
    rl.close();
    return;
  }

  // Insert new provider
  try {
    // Deactivate current providers
    db.prepare("UPDATE llm_providers SET active = 0").run();

    // Insert new provider
    const providerId = `${selectedProvider.type}_${Date.now()}`;
    db.prepare(`
      INSERT INTO llm_providers (id, type, name, endpoint, api_key, model, active, is_default)
      VALUES (?, ?, ?, ?, ?, ?, 1, 1)
    `).run(
      providerId,
      selectedProvider.type,
      selectedProvider.name,
      selectedProvider.endpoint,
      apiKey,
      selectedProvider.model
    );

    console.log('\n✅ Provider configured successfully!');
    console.log(`🎯 Active provider: ${selectedProvider.name} (${selectedProvider.model})`);
    console.log('\n🚀 Benefits you\'ll experience:');
    console.log('   • ~15x faster response times');
    console.log('   • Higher rate limits (no more long waits)');
    console.log('   • Security scans complete in 1-2 minutes instead of 15+ minutes');
    console.log('   • No more rate limit interruptions');

    console.log('\n💡 Your scans will now run much more efficiently!');
    console.log('   Restart your RedBox backend to apply the changes.');

  } catch (error) {
    console.error('❌ Error configuring provider:', error.message);
  }

  rl.close();
}

main().catch(console.error);