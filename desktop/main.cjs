const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
let service, window, quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.whenReady().then(async()=>{
    const pref = path.join(app.getPath('userData'),'workspace.json');
    let workspace=process.env.RELAY_WORKSPACE||path.join(app.getPath('documents'),'Relay Lab');
    if(!process.env.RELAY_WORKSPACE)try{workspace=JSON.parse(fs.readFileSync(pref,'utf8')).workspace;}catch{}
    const {startServer}=await import(pathToFileURL(path.join(__dirname,'../src/server.mjs')).href);
    const launch=async()=>{
      service=await startServer({workspace,port:0});
      window=new BrowserWindow({width:1440,height:940,minWidth:960,minHeight:640,title:'科研牛马局 · CC × CX',backgroundColor:'#f8f9f6',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
      window.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))shell.openExternal(url);return{action:'deny'};});
      window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==service.url)event.preventDefault();});
      await window.loadURL(service.url);
    };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform==='darwin'?[{role:'appMenu'}]:[]),
      {label:'工作台',submenu:[{label:'打开工作区文件夹',click:()=>shell.openPath(service.store.workspace)},{label:'切换工作区…',click:async()=>{
        if(service.runner.children.size)return dialog.showMessageBox(window,{message:'请先停止当前运行任务，再切换工作区。'});
        const selected=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory']});if(selected.canceled)return;
        workspace=selected.filePaths[0];fs.writeFileSync(pref,JSON.stringify({workspace}));app.relaunch();app.quit();
      }},{type:'separator'},{role:'quit'}]},
      {role:'editMenu'},{label:'视图',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}
    ]));
    await launch();
    app.on('before-quit',()=>{try{fs.writeFileSync(pref,JSON.stringify({workspace:service.store.workspace}));}catch{}});
  }).catch(e=>{dialog.showErrorBox('Relay Lab 启动失败',e.message);app.quit();});
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',event=>{if(service&&!quitting){event.preventDefault();quitting=true;service.close().finally(()=>app.quit());}});
}
