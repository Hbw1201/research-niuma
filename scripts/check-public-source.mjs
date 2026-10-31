// Scan only Git's publishable blobs, never a user's home/configuration directory.
// Report file/rule/line metadata, never the matched value.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
const roots = new Set(['README.md', 'RESEARCH-WORKFLOW.md', 'LICENSE', 'SECURITY.md', '.gitignore', '.gitattributes', 'package.json', 'package-lock.json', 'start-unix.sh', 'start-windows.ps1']);
const source = /^(?:bin|desktop|public|src|tests|scripts)\/[\w./-]+\.(?:mjs|cjs|js|css|html|svg)$/;
const workflow = /^\.github\/workflows\/[\w-]+\.ya?ml$/;
const rules = [
  ['provider-token', /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['aws-access-id', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['credential-url', /https?:\/\/[^\s/:@]+:[^\s/@]+@/g],
  ['personal-absolute-path', /(?:[A-Za-z]:[\\/]Users[\\/](?!user(?:[\\/]|\b)|example(?:[\\/]|\b)|<)[A-Za-z0-9_.-]+|\/(?:Users|home)\/(?!user(?:\/|\b)|example(?:\/|\b)|<)[A-Za-z0-9_.-]+)/g],
  ['credential-assignment', /["']?(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN)["']?\s*[:=]\s*["'][A-Za-z0-9_./+-]{16,}["']/g],
];
const problems = [];
for (const file of files) {
  if (!roots.has(file) && !source.test(file) && !workflow.test(file)) problems.push({ file, rule: 'not-in-public-source-layout' });
  if (/(^|\/)(?:\.relay-lab|\.claude|\.codex|\.agents|\.tools|node_modules|release|workspace|workspaces|research-workspace|runs|projects)(\/|$)/.test(file)) problems.push({ file, rule: 'private-or-generated-directory' });
  const metadata = git(['ls-files', '-s', '--', file]);
  if (/^120000 /.test(metadata)) { problems.push({ file, rule: 'symlink-not-allowed' }); continue; }
  const content = git(['show', ':' + file]);
  for (const [rule, pattern] of rules) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) problems.push({ file, rule, line: content.slice(0, match.index).split('\n').length });
  }
}
if (!files.length) problems.push({ rule: 'no-tracked-files' });
console.log(JSON.stringify({ checkedFiles: files.length, problems }, null, 2));
if (problems.length) process.exitCode = 1;
