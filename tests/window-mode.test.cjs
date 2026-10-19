const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('desktop opens fullscreen and supports F11 toggle and Escape exit', async () => {
  let options, inputHandler, fullscreen = true;
  class Window {
    constructor(value) {
      options = value;
      this.webContents = {on(name, callback) {if (name === 'before-input-event') inputHandler = callback;}, setWindowOpenHandler() {}};
    }
    loadFile() {}
    isFullScreen() {return fullscreen;}
    setFullScreen(value) {fullscreen = value;}
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8'), {
    __dirname:path.join(__dirname,'../desktop'), process:{platform:'win32'},
    require(name) {
      if (name !== 'electron') return require(name);
      return {app:{setName(){},commandLine:{appendSwitch(){}},on(){},whenReady:()=>Promise.resolve()},
        BrowserWindow:Window, shell:{},session:{defaultSession:{setPermissionRequestHandler(){},setPermissionCheckHandler(){}}}};
    },
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(options.fullscreen,true);
  assert.equal(options.autoHideMenuBar,true);
  let prevented=0;
  const event={preventDefault(){prevented++;}};
  inputHandler(event,{type:'keyDown',key:'Escape'}); assert.equal(fullscreen,false);
  inputHandler(event,{type:'keyDown',key:'F11'}); assert.equal(fullscreen,true);
  inputHandler(event,{type:'keyUp',key:'F11'}); assert.equal(fullscreen,true);
  inputHandler(event,{type:'keyDown',key:'F11'}); assert.equal(fullscreen,false);
  assert.equal(prevented,3);
});
