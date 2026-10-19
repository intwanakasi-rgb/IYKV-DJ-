const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('scratch processor renders forward and reverse PCM, holds still, and stops',()=>{
 let Processor;
 class Base {constructor(){this.port={postMessage(){}};}}
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../scratch-worklet.js'),'utf8'),{AudioWorkletProcessor:Base,sampleRate:8000,registerProcessor:(name,cls)=>{Processor=cls;}});
 const processor=new Processor(), pcm=new Float32Array(8000);for(let n=0;n<pcm.length;n++)pcm[n]=n/8000;
 processor.port.onmessage({data:{type:'load',channels:[pcm],sampleRate:8000,position:.5}});
 const render=()=>{const out=[new Float32Array(128),new Float32Array(128)];processor.process([], [out]);return out;};
 assert.equal(render()[0][0],0);
 processor.port.onmessage({data:{type:'move',speed:1}});let out=render();assert.ok(out[0][127]>out[0][0]);assert.equal(out[0][0],out[1][0]);
 processor.port.onmessage({data:{type:'move',speed:-1}});out=render();assert.ok(out[0][127]<out[0][0]);
 processor.port.onmessage({data:{type:'stop'}});assert.equal(processor.process([],[[new Float32Array(128)]]),false);
});
