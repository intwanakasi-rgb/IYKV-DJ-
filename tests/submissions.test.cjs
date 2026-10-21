const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createSubmissionServer}=require('../server/submissions.cjs');
test('submission moderation protects files, validates uploads, deduplicates, closes and deletes sessions',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decklab-inbox-')),token='t'.repeat(40);
 const server=createSubmissionServer({dir,token,maxTracks:2,origins:['https://decklab.test']});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+server.address().port;
 const host=(p,method='GET')=>fetch(root+p,{method,headers:{Authorization:'Bearer '+token}});
 try{
  assert.equal((await fetch(root+'/sessions')).status,401);
  assert.equal((await fetch(root+'/sessions',{headers:{Origin:'https://evil.test',Authorization:'Bearer '+token}})).status,403);
  const session=await (await host('/sessions','POST')).json();assert.ok(session.id);
  assert.equal((await fetch(root+'/s/'+session.id)).status,200);
  const wav=Buffer.alloc(100);wav.write('RIFF');wav.write('WAVE',8);
  const upload=(body=wav)=>fetch(root+'/upload/'+session.id+'?artist=Test&title=Track&permission=yes',{method:'POST',body,headers:{Origin:root}});
  assert.equal((await upload(Buffer.from('not audio'))).status,400);
  assert.equal((await upload()).status,201);
  assert.equal((await upload()).status,409);
  const sessions=await (await host('/sessions')).json(),track=sessions[0].tracks[0];assert.equal(track.status,'pending');assert.equal(track.hash,undefined);
  const base='/sessions/'+session.id+'/'+track.id;
  assert.equal((await fetch(root+base+'/audio')).status,401);
  assert.equal((await host(base+'/audio')).status,200);
  assert.equal((await (await host(base+'/approve','POST')).json()).status,'approved');
  assert.equal((await (await host(base+'/reject','POST')).json()).status,'rejected');
  assert.equal((await host(base+'/audio')).status,404);assert.equal((await host(base+'/approve','POST')).status,409);
  await host('/sessions/'+session.id+'/close','POST');assert.equal((await upload()).status,404);
  await host('/sessions/'+session.id,'DELETE');assert.equal((await fetch(root+'/s/'+session.id)).status,404);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('server requires a strong host token',()=>assert.throws(()=>createSubmissionServer({token:'short'}),/32/));

test('session capacity, size and expiry are enforced; pending files survive restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decklab-limits-')),token='a'.repeat(40);
 let server=createSubmissionServer({dir,token,maxTracks:1,maxBytes:100,ttl:60000});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let root='http://127.0.0.1:'+server.address().port;
 const host=(p,method='GET')=>fetch(root+p,{method,headers:{Authorization:'Bearer '+token}});
 try{
  const session=await(await host('/sessions','POST')).json();
  const endpoint='/upload/'+session.id+'?artist=A&title=T&permission=yes';const wav=Buffer.alloc(100);wav.write('RIFF');wav.write('WAVE',8);
  assert.equal((await fetch(root+endpoint,{method:'POST',body:Buffer.alloc(101)})).status,413);
  assert.equal((await fetch(root+endpoint,{method:'POST',body:wav})).status,201);
  assert.equal((await fetch(root+endpoint,{method:'POST',body:wav})).status,409);
  await new Promise(r=>server.close(r));
  server=createSubmissionServer({dir,token});await new Promise(r=>server.listen(0,'127.0.0.1',r));root='http://127.0.0.1:'+server.address().port;
  const list=await(await host('/sessions')).json();assert.equal(list[0].tracks.length,1);assert.equal(list[0].tracks[0].status,'pending');
  await new Promise(r=>server.close(r));
  const db=JSON.parse(fs.readFileSync(path.join(dir,'inbox.json')));db.sessions[0].expiresAt=0;fs.writeFileSync(path.join(dir,'inbox.json'),JSON.stringify(db));
  server=createSubmissionServer({dir,token});await new Promise(r=>server.listen(0,'127.0.0.1',r));root='http://127.0.0.1:'+server.address().port;
  assert.deepEqual(await(await host('/sessions')).json(),[]);assert.equal(fs.existsSync(path.join(dir,list[0].tracks[0].id)),false);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
