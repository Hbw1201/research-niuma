import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const pkg = JSON.parse(fs.readFileSync('package.json'));
const archive = `relay-lab-${pkg.version}.tgz`;
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
const allowed = file => /^package\/(?:bin|src|public|desktop)\/[\w./-]+$/.test(file) || /^package\/(?:package.json|README.md|RESEARCH-WORKFLOW.md|LICENSE)$/.test(file);
for (const file of entries) if (!allowed(file) || file.includes('..')) throw new Error('Unexpected CLI archive entry: ' + file);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'niuma-cli-'));
try {
  execFileSync('tar', ['-xzf', path.resolve(archive), '-C', temp]);
  for (const entry of entries) {
    const relative = entry.slice('package/'.length);
    const file = path.join(temp, entry);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Linked CLI archive entry.');
    if (!fs.readFileSync(file).equals(fs.readFileSync(relative))) throw new Error('CLI content mismatch: ' + relative);
  }
  const help = execFileSync(process.execPath, [path.join(temp, 'package/bin/relay-lab.mjs'), '--help'], { encoding: 'utf8' });
  if (!help.includes('v' + pkg.version)) throw new Error('Packaged CLI version mismatch.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log(JSON.stringify({ cliPackage: archive, files: entries.length, sourceMatches: true }));
