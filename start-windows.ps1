param([string]$Workspace = (Join-Path $PSScriptRoot 'workspace'), [int]$Port = 4318)
$ErrorActionPreference = 'Stop'
$runtime = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($runtime) { $runtime.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (!(Test-Path -LiteralPath $nodePath)) { throw '请安装 Node.js 22 或更新版本，或使用打包好的桌面版。' }
& $nodePath (Join-Path $PSScriptRoot 'bin\relay-lab.mjs') start --workspace $Workspace --port $Port --open
