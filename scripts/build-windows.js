'use strict';

// Builds a ready-to-run Windows package: dist/Gamebud-win-x64.zip
// Unzip it and double-click Gamebud.exe. No Node, npm, or Electron install needed.
//
//   node scripts/build-windows.js                  downloads Electron for Windows
//   node scripts/build-windows.js --zip file.zip   uses an already-downloaded Electron zip
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const stage = path.join(dist, 'Gamebud-win-x64');
const out = path.join(dist, 'Gamebud-win-x64.zip');
const version = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;

async function electronZip() {
  const i = process.argv.indexOf('--zip');
  if (i > 0) return path.resolve(process.argv[i + 1]);
  const file = path.join(dist, `electron-v${version}-win32-x64.zip`);
  if (fs.existsSync(file)) return file;
  const url = `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-win32-x64.zip`;
  console.log('Downloading', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

(async () => {
  fs.mkdirSync(dist, { recursive: true });
  const zip = await electronZip();

  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(out, { force: true });
  fs.mkdirSync(stage, { recursive: true });
  execFileSync('unzip', ['-q', zip, '-d', stage]);

  // Rename the executable and swap Electron's demo app for ours.
  fs.renameSync(path.join(stage, 'electron.exe'), path.join(stage, 'Gamebud.exe'));
  fs.rmSync(path.join(stage, 'resources', 'default_app.asar'), { force: true });
  const app = path.join(stage, 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  const pkg = require(path.join(root, 'package.json'));
  fs.writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main }, null, 2),
  );
  fs.cpSync(path.join(root, 'src'), path.join(app, 'src'), { recursive: true });

  fs.writeFileSync(
    path.join(stage, 'README.txt'),
    [
      'Gamebud',
      '=======',
      '',
      'Double-click Gamebud.exe to start. Nothing to install.',
      '',
      'Gemini API key: press Ctrl+Shift+K inside the app to open the hidden',
      'developer panel and paste your key.',
      '',
      'If Windows SmartScreen warns about an unknown publisher, choose',
      '"More info", then "Run anyway". The app is not code-signed.',
      '',
    ].join('\r\n'),
  );

  execFileSync('zip', ['-q', '-r', '-9', out, 'Gamebud-win-x64'], { cwd: dist });
  const mb = (fs.statSync(out).size / 1048576).toFixed(1);
  console.log(`Built ${path.relative(root, out)} (${mb} MB, Electron ${version})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
