const fs = require('node:fs');
const path = require('node:path');
module.exports = async context => {
  const out=context.appOutDir;
  if(context.electronPlatformName==='win32') {
    fs.writeFileSync(path.join(out,'relay-lab.cmd'),'@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0Relay Lab.exe" "%~dp0resources\\app.asar\\bin\\relay-lab.mjs" %*\r\n');
  } else if(context.electronPlatformName==='linux') {
    fs.writeFileSync(path.join(out,'relay-lab-cli'),'#!/usr/bin/env sh\nROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec env ELECTRON_RUN_AS_NODE=1 "$ROOT/relay-lab" "$ROOT/resources/app.asar/bin/relay-lab.mjs" "$@"\n',{mode:0o755});
  } else if(context.electronPlatformName==='darwin') {
    const dir=path.join(out,'Relay Lab.app','Contents','MacOS');
    fs.writeFileSync(path.join(dir,'relay-lab-cli'),'#!/usr/bin/env sh\nROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec env ELECTRON_RUN_AS_NODE=1 "$ROOT/Relay Lab" "$ROOT/../Resources/app.asar/bin/relay-lab.mjs" "$@"\n',{mode:0o755});
  }
};
