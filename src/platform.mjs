import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const userHome = () => process.env.RELAY_USER_HOME || os.homedir();
export const agentHome = provider => provider === 'cc'
  ? process.env.CLAUDE_CONFIG_DIR || path.join(userHome(), '.claude')
  : process.env.CODEX_HOME || path.join(userHome(), '.codex');

export async function capture(file, args = [], options = {}) {
  const result = await execFileAsync(file, args, { windowsHide: true, timeout: 12000, maxBuffer: 2 * 1024 * 1024, ...options });
  return result.stdout.trim();
}

function candidates(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const home = userHome();
  dirs.push(path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin');
  if (process.platform === 'win32') {
    dirs.push(path.join(home, 'AppData', 'Roaming', 'npm'));
    const bin = path.join(home, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin');
    try { dirs.push(...fs.readdirSync(bin).reverse().map(x => path.join(bin, x))); } catch {}
  } else {
    for (const root of [path.join(home, '.nvm', 'versions', 'node'), path.join(home, '.local', 'share', 'fnm', 'node-versions')]) {
      try { for (const version of fs.readdirSync(root).reverse()) dirs.push(path.join(root, version, root.includes('fnm') ? 'installation/bin' : 'bin')); } catch {}
    }
  }
  const ext = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  return [...new Set(dirs)].flatMap(d => ext.map(e => path.join(d, name + e)));
}

// Resolve npm launchers to their JS entry. Never interpolate prompts into a shell.
export function invocation(executable, args = []) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const base = path.dirname(executable);
    const entry = /claude/i.test(path.basename(executable))
      ? path.join(base, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
      : path.join(base, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (!fs.existsSync(entry)) throw new Error('此启动脚本无法安全解析，请指定 CLI 的 .exe 或 .js 程序路径。');
    return { command: process.env.RELAY_NODE_PATH || process.execPath, args: [entry, ...args], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } };
  }
  if (/\.[cm]?js$/i.test(executable)) return { command: process.env.RELAY_NODE_PATH || process.execPath, args: [executable, ...args], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } };
  return { command: executable, args, env: { ...process.env } };
}

export async function findCli(provider, override = '') {
  const name = provider === 'cc' ? 'claude' : 'codex';
  const found = override ? path.resolve(override) : candidates(name).find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (!found || !fs.existsSync(found)) return { provider, name, available: false, path: override || '', error: '未找到程序；请在设置中指定路径，或在已安装 CLI 的终端启动。' };
  try {
    const call = invocation(found, ['--version']);
    const version = await capture(call.command, call.args, { env: call.env });
    return { provider, name, path: found, available: true, version: version.slice(0, 200) };
  } catch (e) { return { provider, name, path: found, available: false, error: e.message.slice(0, 500) }; }
}

export function classifyProcess(name, command = '') {
  if (/^claude(?:\.exe)?$/i.test(name)) return 'cc';
  if (/^codex(?:\.exe)?$/i.test(name)) return 'cx';
  if (/^node(?:\.exe)?$/i.test(name)) {
    if (/@anthropic-ai[\\/]claude-code[\\/].*cli\.[cm]?js/i.test(command)) return 'cc';
    if (/@openai[\\/]codex[\\/].*codex\.[cm]?js/i.test(command)) return 'cx';
  }
  return null;
}

export async function scanProcesses() {
  try {
    let processes;
    if (process.platform === 'win32') {
      // Command lines are classified within PowerShell; never return prompts or secrets.
      const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $rows=@(Get-CimInstance Win32_Process | ForEach-Object { $p=$_; $kind=$null; if($p.Name -eq 'claude.exe'){$kind='cc'} elseif($p.Name -eq 'codex.exe'){$kind='cx'} elseif($p.Name -eq 'node.exe'){if($p.CommandLine -match '@anthropic-ai[\\\\/]claude-code[\\\\/].*cli\\.[cm]?js'){$kind='cc'} elseif($p.CommandLine -match '@openai[\\\\/]codex[\\\\/].*codex\\.[cm]?js'){$kind='cx'}}; if($kind){$mode='external'; if($p.CommandLine -match '(?:^|\\s)app-server(?:\\s|$)'){$mode='service'}; [pscustomobject]@{pid=$p.ProcessId;parentPid=$p.ParentProcessId;name=$p.Name;provider=$kind;mode=$mode}} }); ConvertTo-Json -InputObject $rows -Compress`;
      processes = JSON.parse(await capture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]) || '[]');
    } else {
      const raw = await capture('ps', ['-axo', 'pid=,ppid=,comm=,args=']);
      processes = raw.split('\n').flatMap(line => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
        if (!match) return [];
        const provider = classifyProcess(path.basename(match[3]), match[4]);
        return provider ? [{ pid: +match[1], parentPid: +match[2], name: path.basename(match[3]), provider, mode: /\bapp-server\b/.test(match[4]) ? 'service' : 'external' }] : [];
      });
    }
    return { processes: Array.isArray(processes) ? processes : [processes], warning: null };
  } catch { return { processes: [], warning: '系统未允许读取进程列表；仍可识别 CLI 安装和本地会话记录。' }; }
}

async function readTail(file, bytes = 256 * 1024) {
  const handle = await fs.promises.open(file, 'r');
  try { const { size } = await handle.stat(); const b = Buffer.alloc(Math.min(size, bytes)); await handle.read(b, 0, b.length, Math.max(0, size - b.length)); return b.toString('utf8'); } finally { await handle.close(); }
}

export async function scanSessions(provider, home = agentHome(provider)) {
  const sessions = new Map();
  if (provider === 'cx') {
    try { for (const line of (await readTail(path.join(home, 'session_index.jsonl'), 2 * 1024 * 1024)).split('\n')) {
      try { const x = JSON.parse(line); if (x.id) sessions.set(x.id, { id: x.id, provider, title: x.thread_name || x.id, updatedAt: x.updated_at, source: 'history', status: 'unknown' }); } catch {}
    } } catch {}
  } else {
    const root = path.join(home, 'projects');
    try {
      const dirs = await fs.promises.readdir(root, { withFileTypes: true });
      for (const dir of dirs.filter(x => x.isDirectory()).slice(-200)) {
        const project = path.join(root, dir.name);
        try {
          const index = JSON.parse(await fs.promises.readFile(path.join(project, 'sessions-index.json'), 'utf8'));
          for (const x of index.entries || []) if (x.sessionId) sessions.set(x.sessionId, { id: x.sessionId, provider, title: x.summary || x.firstPrompt || x.sessionId, cwd: x.projectPath || '', updatedAt: x.modified, source: 'history', status: 'unknown' });
        } catch {}
        const files = (await fs.promises.readdir(project, { withFileTypes: true })).filter(x => x.isFile() && /^[a-f0-9-]+\.jsonl$/i.test(x.name)).slice(-100);
        for (const f of files) {
          const id = f.name.slice(0, -6); if (sessions.has(id)) continue;
          try {
            const file = path.join(project, f.name), stat = await fs.promises.stat(file);
            const tail = await readTail(file, 16384);
            let cwd = '', title = id;
            for (const line of tail.split('\n')) { try { const x = JSON.parse(line); cwd ||= x.cwd || ''; if (x.type === 'summary') title = x.summary; } catch {} }
            sessions.set(id, { id, provider, title, cwd, updatedAt: stat.mtime.toISOString(), source: 'history', status: 'unknown' });
          } catch {}
        }
      }
    } catch {}
  }
  return [...sessions.values()].sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 100);
}

export async function discover(settings = {}) {
  const [cc, cx, proc, ccSessions, cxSessions] = await Promise.all([
    findCli('cc', settings.ccPath), findCli('cx', settings.cxPath), scanProcesses(), scanSessions('cc'), scanSessions('cx')
  ]);
  return { scannedAt: new Date().toISOString(), platform: process.platform, home: userHome(), clis: { cc, cx }, processes: proc.processes, sessions: [...ccSessions, ...cxSessions], warnings: proc.warning ? [proc.warning] : [] };
}

export function stopChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
}
