import fs from 'node:fs';
import path from 'node:path';
import { assert, text } from './store.mjs';

const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
const slash = value => value.split(path.sep).join('/');
function relativePath(value = '') {
  assert(typeof value === 'string' && value.length <= 3000, '文件路径无效。');
  if (!value || value === '.') return '';
  assert(!path.isAbsolute(value) && !/[\\\x00:]/.test(value), '请选择项目内的相对路径。');
  const parts = value.split('/');
  assert(parts.every(part => part && part !== '..' && !part.startsWith('.') && !/[<>|"*?]/.test(part) && !/[. ]$/.test(part)), '不能访问隐藏目录或项目外的路径。');
  return parts.join(path.sep);
}
const visible = name => !name.startsWith('.') && !['node_modules'].includes(name);

export class ProjectFiles {
  constructor(store) { this.store = store; }
  resolve(projectId, value = '', area = 'project') {
    const project = this.store.project(projectId);
    assert(['project', 'research'].includes(area), '文件区域无效。');
    const base = area === 'research' ? this.store.folder(projectId) : project.directory;
    assert(fs.existsSync(base), '项目文件夹不存在，请检查磁盘或目录。', 404);
    const root = fs.realpathSync(base);
    const relative = relativePath(value);
    const candidate = path.resolve(root, relative);
    assert(within(root, candidate), '路径超出项目目录。', 403);
    assert(fs.existsSync(candidate), '文件或目录已不存在。', 404);
    const target = fs.realpathSync(candidate);
    assert(within(root, target), '此链接指向项目外部，不能从这里访问。', 403);
    return { root, target, relative: slash(relative), project };
  }
  list(projectId, value = '', area = 'project') {
    const {root, target, relative} = this.resolve(projectId, value, area);
    assert(fs.statSync(target).isDirectory(), '请选择文件夹。');
    let omitted = 0;
    const entries = fs.readdirSync(target, {withFileTypes:true}).filter(e => visible(e.name)).flatMap(entry => {
      try {
        const file = path.join(target, entry.name), real = fs.realpathSync(file);
        if (!within(root, real)) { omitted++; return []; }
        const stat = fs.statSync(real);
        if (!stat.isFile() && !stat.isDirectory()) return [];
        return [{name:entry.name, path:[relative,entry.name].filter(Boolean).join('/'), type:stat.isDirectory()?'directory':'file', bytes:stat.size}];
      } catch { omitted++; return []; }
    }).sort((a,b) => (a.type===b.type?0:a.type==='directory'?-1:1) || a.name.localeCompare(b.name,'zh-CN'));
    return {projectId, area, path:relative, directory:target, parent:relative?relative.split('/').slice(0,-1).join('/'):null,
      entries:entries.slice(0,400), truncated:entries.length>400, omitted};
  }
  read(projectId, value, area = 'project') {
    const {target,relative} = this.resolve(projectId,value,area), stat=fs.statSync(target);
    assert(stat.isFile(), '这不是文件。');
    assert(stat.size<=512*1024, '文件超过 512 KB，请在本机编辑器中查看。', 413);
    const bytes=fs.readFileSync(target);
    assert(!bytes.includes(0), '此文件不是文本，请在本机对应软件中打开。', 415);
    return {projectId,area,path:relative,name:path.basename(target),directory:target,content:bytes.toString('utf8')};
  }
  mkdir({workspace,projectId,parent='',name}) {
    assert(workspace===this.store.workspace,'工作区已切换，请刷新后重试。',409);
    const clean=text(name,100);
    assert(!/[\/\\]/.test(clean) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(clean), '请输入一个有效的子文件夹名称。');
    relativePath(clean);
    const {target,relative}=this.resolve(projectId,parent);
    assert(fs.statSync(target).isDirectory(),'父目录不是文件夹。');
    const dest=path.join(target,clean);
    assert(!fs.existsSync(dest),'此名称已经存在。',409);
    fs.mkdirSync(dest);
    return this.list(projectId,[relative,clean].filter(Boolean).join('/'));
  }
}
