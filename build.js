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

  const files = [
    { name: 'scanner.js', prefix: 'ks_scn_' },
    { name: 'app.js', prefix: 'ks_app_' }
  ];

  for (const { name: file, prefix } of files) {
    const srcPath = path.join(SRC_DIR, file);
    const destPath = path.join(ROOT_DIR, file);

    if (!fs.existsSync(srcPath)) {
      console.error(`❌ Error: Source file not found: ${srcPath}`);
      process.exit(1);
    }

    const originalSize = fs.statSync(srcPath).size;
    console.log(`\n📦 Obfuscating ${file} (${(originalSize / 1024).toFixed(1)} KB)...`);

    // Run javascript-obfuscator CLI with unique per-file identifier prefix to prevent top-level const collisions
    const cmd = `javascript-obfuscator "${srcPath}" --output "${destPath}" --config "${CONFIG_FILE}" --identifiers-prefix "${prefix}"`;
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

  // Combined global-scope collision check (scanner.js + app.js share the same window scope)
  try {
    const combinedCheckPath = path.join(ROOT_DIR, '.combined_syntax_check.tmp.js');
    const scnContent = fs.readFileSync(path.join(ROOT_DIR, 'scanner.js'), 'utf8');
    const appContent = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');
    fs.writeFileSync(combinedCheckPath, `${scnContent}\n;\n${appContent}`, 'utf8');
    execSync(`node -c "${combinedCheckPath}"`);
    fs.unlinkSync(combinedCheckPath);
    console.log('\n✓ Combined global-scope check passed (zero top-level identifier collisions)');
  } catch (combErr) {
    console.error('❌ Combined global-scope collision error!', combErr.message);
    process.exit(1);
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
