'use strict';

// Starts Gamebud. If Electron's binary is missing (a skipped or failed install
// script, which is common on Windows), this downloads it and tries again.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const electronDir = path.join(root, 'node_modules', 'electron');

function findElectron() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(electronDir)) delete require.cache[key];
  }
  try {
    const exe = require(electronDir);
    return typeof exe === 'string' && fs.existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

function fail(lines) {
  console.error('\n' + lines.join('\n') + '\n');
  process.exit(1);
}

let exe = findElectron();

if (!exe) {
  if (!fs.existsSync(path.join(electronDir, 'install.js'))) {
    fail(['Electron is not installed yet.', 'Run:  npm install']);
  }
  console.log('Electron is not fully installed. Downloading it now (about 100 MB)...\n');
  fs.rmSync(path.join(electronDir, 'dist'), { recursive: true, force: true });
  fs.rmSync(path.join(electronDir, 'path.txt'), { force: true });
  const res = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], {
    cwd: electronDir,
    stdio: 'inherit',
    env: { ...process.env, npm_config_ignore_scripts: 'false' },
  });
  exe = res.status === 0 ? findElectron() : null;
  if (!exe) {
    fail([
      'Could not download Electron. The error above says why.',
      'Common fixes:',
      '  - Check your internet connection, VPN, proxy or antivirus, then run this again.',
      '  - Move this folder out of Downloads/OneDrive (for example to C:\\dev\\gamebud).',
      '  - If your network blocks GitHub downloads, set a mirror and retry:',
      '      PowerShell:  $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; npm start',
    ]);
  }
  console.log('\nElectron installed.\n');
}

// Some editors set this, which makes Electron behave like plain Node.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(exe, [root, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
