import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const pkg = JSON.parse(fs.readFileSync('package.json'));
if (process.env.GITHUB_REF_NAME !== 'v' + pkg.version) throw new Error('Release tag differs from package version.');
const expected = [
  `Relay-Lab-Setup-${pkg.version}-x64.exe`,
  `Relay-Lab-${pkg.version}-macos-arm64.dmg`,
  `Relay-Lab-${pkg.version}-macos-x64.dmg`,
  `Relay-Lab-${pkg.version}-linux-x64.AppImage`,
  `Relay-Lab-${pkg.version}-linux-x64.deb`,
  `relay-lab-${pkg.version}.tgz`,
];
const downloaded = new Map();
function inventory(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Unexpected artifact link.');
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) inventory(file);
    else { if (downloaded.has(entry.name)) throw new Error('Duplicate artifact: ' + entry.name); downloaded.set(entry.name, file); }
  }
}
inventory('artifacts');
const audits = ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'].map(target => {
  const report = JSON.parse(fs.readFileSync(downloaded.get(`audit-${target}.json`)));
  if (`${report.platform}-${report.arch}` !== target || report.commit !== process.env.GITHUB_SHA || report.version !== pkg.version || !['sourceMatches', 'bundledCli', 'freshLocalService', 'noInitialProjects'].every(key => report.checks[key] === true)) throw new Error('Build audit failed for ' + target);
  return report;
});
fs.mkdirSync('release-assets', { recursive: true });
const assets = [];
for (const name of expected) {
  // electron-builder uses package-format architecture names on Linux.
  const nativeName = name.endsWith('.AppImage') ? name.replace('-x64.', '-x86_64.')
    : name.endsWith('.deb') ? name.replace('-x64.', '-amd64.') : name;
  const file = downloaded.get(name) ?? downloaded.get(nativeName);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error('Missing release asset: ' + name);
  fs.copyFileSync(file, path.join('release-assets', name));
  assets.push({ name, bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
}
const manifest = { version: pkg.version, commit: process.env.GITHUB_SHA, workflowRun: process.env.GITHUB_RUN_ID, assets, builds: audits };
const manifestFile = path.join('release-assets', 'BUILD-INFO.json');
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
assets.push({ name: 'BUILD-INFO.json', sha256: crypto.createHash('sha256').update(fs.readFileSync(manifestFile)).digest('hex') });
fs.writeFileSync(path.join('release-assets', 'SHA256SUMS.txt'), assets.map(a => `${a.sha256}  ${a.name}`).join('\n') + '\n');
console.log(JSON.stringify({ assets: expected, auditedBuilds: audits.length, commit: manifest.commit }));
