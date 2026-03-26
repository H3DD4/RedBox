#!/usr/bin/env node

/**
 * Real-time Scan Monitor
 *
 * Monitors the backend logs to show scan progress and identify bottlenecks
 */

import { spawn } from 'child_process';
import readline from 'readline';

console.log('🔍 RedBox Scan Monitor - Real-time Performance Analysis\n');

// Colors for better readability
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

let scanStats = {
  iterations: 0,
  rateLimitWaits: 0,
  totalWaitTime: 0,
  errors: 0,
  findings: 0,
  startTime: Date.now()
};

console.log('Monitoring backend logs for scan activity...');
console.log('• Look for iteration progress');
console.log('• Track rate limiting behavior');
console.log('• Monitor for errors or bottlenecks\n');

// Monitor backend logs (assuming they're going to console)
const logProcess = spawn('npx', ['tsx', 'watch', 'src/index.ts'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe']
});

const rl = readline.createInterface({
  input: logProcess.stdout
});

const rlErr = readline.createInterface({
  input: logProcess.stderr
});

rl.on('line', (line) => {
  analyzeLogLine(line);
});

rlErr.on('line', (line) => {
  analyzeLogLine(line);
});

function analyzeLogLine(line) {
  const timestamp = new Date().toLocaleTimeString();

  // Track iterations
  if (line.includes('Analyzing... (') && line.includes('/30)')) {
    const match = line.match(/\((\d+)\/30\)/);
    if (match) {
      scanStats.iterations = parseInt(match[1]);
      const progress = Math.round((scanStats.iterations / 30) * 100);
      console.log(`${colors.cyan}[${timestamp}] 🔄 Progress: ${scanStats.iterations}/30 (${progress}%)${colors.reset}`);
    }
  }

  // Track rate limiting
  if (line.includes('[RateLimiter]')) {
    if (line.includes('waiting')) {
      const waitMatch = line.match(/waiting (\d+)s/);
      if (waitMatch) {
        const waitTime = parseInt(waitMatch[1]);
        scanStats.rateLimitWaits++;
        scanStats.totalWaitTime += waitTime;
        console.log(`${colors.yellow}[${timestamp}] ⏳ Rate limit wait: ${waitTime}s (Total waits: ${scanStats.rateLimitWaits})${colors.reset}`);
      }
    }

    if (line.includes('Current usage:')) {
      console.log(`${colors.blue}[${timestamp}] 📊 ${line.split('] ')[1]}${colors.reset}`);
    }
  }

  // Track LLM calls
  if (line.includes('[LLM]') && line.includes('tokens')) {
    console.log(`${colors.green}[${timestamp}] 🤖 ${line.split('] ')[1]}${colors.reset}`);
  }

  // Track errors
  if (line.includes('error') || line.includes('Error') || line.includes('RATE_LIMIT')) {
    scanStats.errors++;
    console.log(`${colors.red}[${timestamp}] ❌ Error detected: ${line}${colors.reset}`);
  }

  // Track findings
  if (line.includes('finding') || line.includes('FLAG')) {
    scanStats.findings++;
    console.log(`${colors.green}[${timestamp}] 🎯 Finding: ${line}${colors.reset}`);
  }

  // Show performance summary every 10 iterations
  if (scanStats.iterations > 0 && scanStats.iterations % 10 === 0) {
    showPerformanceSummary();
  }
}

function showPerformanceSummary() {
  const elapsed = (Date.now() - scanStats.startTime) / 1000;
  const avgTimePerIteration = elapsed / scanStats.iterations;
  const estimatedTotal = avgTimePerIteration * 30;
  const estimatedRemaining = estimatedTotal - elapsed;

  console.log(`\n${colors.cyan}📈 PERFORMANCE SUMMARY${colors.reset}`);
  console.log(`• Elapsed: ${Math.round(elapsed)}s`);
  console.log(`• Avg per iteration: ${Math.round(avgTimePerIteration)}s`);
  console.log(`• Rate limit waits: ${scanStats.rateLimitWaits} (${scanStats.totalWaitTime}s total)`);
  console.log(`• Estimated completion: ${Math.round(estimatedRemaining)}s remaining`);
  console.log(`• Findings: ${scanStats.findings} | Errors: ${scanStats.errors}\n`);
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n🏁 Monitoring stopped');
  showPerformanceSummary();
  process.exit(0);
});

console.log('Press Ctrl+C to stop monitoring\n');