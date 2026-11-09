/**
 * Kuberan Scanner - Automated Production Build & Code Obfuscation Pipeline
 * Scrambles and locks client-side JavaScript to authorized domains.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
const SRC_DIR = path.join(ROOT_DIR, 'src');
const CONFIG_FILE = path.join(ROOT_DIR, 'obfuscator.config.json');

const BANNER = `/**
 * Copyright (c) Kuberan Silks. All Rights Reserved.
 * PROPRIETARY & CONFIDENTIAL.
 * Unauthorized copying, distribution, modification, or reverse-engineering is strictly prohibited.
 * Locked to authorized domains: jee1vk.github.io, kuberansilks.com, localhost.
 */
`;

function run() {
  console.log('🔒 Starting Kuberan Scanner Security Build Pipeline...');

  if (!fs.existsSync(SRC_DIR)) {
    console.error('❌ Error: src/ directory not found!');
    process.exit(1);
  }

  const files = ['scanner.js', 'app.js'];

  for (const file of files) {
    const srcPath = path.join(SRC_DIR, file);
    const destPath = path.join(ROOT_DIR, file);

    if (!fs.existsSync(srcPath)) {
      console.error(`❌ Error: Source file not found: ${srcPath}`);
      process.exit(1);
    }

    const originalSize = fs.statSync(srcPath).size;
    console.log(`\n📦 Obfuscating ${file} (${(originalSize / 1024).toFixed(1)} KB)...`);

    // Run javascript-obfuscator CLI
    const cmd = `javascript-obfuscator "${srcPath}" --output "${destPath}" --config "${CONFIG_FILE}"`;
    try {
      execSync(cmd, { stdio: 'inherit' });
    } catch (err) {
      console.error(`❌ Obfuscation failed for ${file}:`, err.message);
      process.exit(1);
    }

    // Prepend proprietary banner
    const obfContent = fs.readFileSync(destPath, 'utf8');
    fs.writeFileSync(destPath, BANNER + obfContent, 'utf8');

    // Syntax validation check
    try {
      execSync(`node -c "${destPath}"`);
      const newSize = fs.statSync(destPath).size;
      console.log(`✓ ${file} compiled successfully! Final size: ${(newSize / 1024).toFixed(1)} KB`);
    } catch (syntaxErr) {
      console.error(`❌ Syntax error in compiled ${file}!`, syntaxErr.message);
      process.exit(1);
    }
  }

  console.log('\n🛡️ Build completed successfully!');
  console.log('✅ Applied Security Layers:');
  console.log('   - Domain Lock: Authorized for jee1vk.github.io, kuberansilks.com, localhost');
  console.log('   - Domain Redirect: Unauthorized hosts redirect to https://kuberansilks.com/');
  console.log('   - Self-Defending: Script self-destructs if pretty-printed or formatted');
  console.log('   - Control Flow Flattening: Logic converted into state machine switches');
  console.log('   - String Array Encryption: Base64 and chunk-splitting applied to strings');
}

run();
