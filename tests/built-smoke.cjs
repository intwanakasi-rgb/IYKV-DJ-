const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
function wav(seconds = 8, frequency = 220, channels = 1) {
  const rate = 16000, length = rate * seconds;
  const buffer = Buffer.alloc(44 + length * 2 * channels);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2 * channels, 28); buffer.writeUInt16LE(2 * channels, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(length * 2 * channels, 40);
  for (let n = 0; n < length; n++) {
    const time = n / rate;
    const envelope = (time % .5) < .04 ? .7 : .08;
    for (let channel=0;channel<channels;channel++) buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * time) * envelope * 32767 * (channel===0 ? 1 : .1)),44+(n*channels+channel)*2);
  }
  return buffer;
}

(async()=>{
 const root=path.resolve(__dirname,'../dist/web');
 const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']});
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.setInputFiles('#fileInput',{name:'Production.wav',mimeType:'audio/wav',buffer:wav()});
  await page.locator('.track-row').getByRole('button',{name:'A',exact:true}).click();
  await page.waitForFunction(()=>/[0-9]/.test(document.getElementById('bpmA').textContent),null,{timeout:30000});
  assert.equal(await page.locator('.channel-strips > .master-meter .stereo-rail').count(),2);
  const dimensions=await page.evaluate(()=>({height:document.documentElement.scrollHeight,viewport:innerHeight,meter:document.querySelector('.master-meter').getBoundingClientRect().toJSON(),channel:document.getElementById('channelA').getBoundingClientRect().toJSON()}));
  assert.ok(dimensions.meter.y<dimensions.channel.bottom && dimensions.meter.bottom>dimensions.channel.y);
  assert.ok(dimensions.height<=dimensions.viewport+2,JSON.stringify(dimensions));
  if(process.env.DECKLAB_SCREENSHOT_DIR){fs.mkdirSync(process.env.DECKLAB_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.DECKLAB_SCREENSHOT_DIR,'production.png')});}
  console.log('Built web: automatic BPM/worker succeeds; central L/R aligned; 1366×768 fits without page scrolling.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
