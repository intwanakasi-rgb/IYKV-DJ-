// Single-host, single-process submission inbox. Put behind HTTPS for public use.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

function createSubmissionServer({dir, token, origins = [], maxBytes = 50 * 1024 * 1024, maxTracks = 50, ttl = 24 * 3600 * 1000} = {}) {
  if (!token || token.length < 32) throw Error('DECKLAB_HOST_TOKEN must contain at least 32 characters');
  fs.mkdirSync(dir, {recursive:true, mode:0o700});
  const dbPath = path.join(dir, 'inbox.json');
  let db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf8')) : {sessions:[]};
  const save = () => { fs.writeFileSync(dbPath + '.tmp', JSON.stringify(db), {mode:0o600}); fs.renameSync(dbPath + '.tmp', dbPath); };
  const pending = new Map(), rates = new Map();
  const prune = () => {
    const expired = db.sessions.filter(s => s.expiresAt <= Date.now());
    for (const s of expired) for (const t of s.tracks) fs.rmSync(path.join(dir,t.id), {force:true});
    db.sessions = db.sessions.filter(s => s.expiresAt > Date.now());
    if (expired.length) save();
    for (const [key,r] of rates) if (r.until <= Date.now()) rates.delete(key);
  };
  // Remove interrupted uploads on startup; completed files are never public static files.
  for (const name of fs.readdirSync(dir)) if (name.endsWith('.part')) fs.rmSync(path.join(dir,name), {force:true});
  const timer = setInterval(prune, 60000); timer.unref();
  const publicView = s => ({id:s.id, open:s.open, expiresAt:s.expiresAt, tracks:s.tracks.map(({hash,...t})=>t)});
  const server = http.createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    const reply = (code,body) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };
    try {
      prune();
      const origin = req.headers.origin;
      const sameHostUpload = req.url.startsWith('/upload/') && origin && new URL(origin).host === req.headers.host;
      if (origin && !sameHostUpload && !origins.includes(origin)) return reply(403,{error:'Origin is not allowed'});
      if (origin) { res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin'); }
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers','authorization,content-type'); res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS'); res.writeHead(204); return res.end(); }
      const url = new URL(req.url,'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && parts.length === 2 && parts[0] === 's') {
        const session = db.sessions.find(s => s.id === parts[1]);
        if (!session) return reply(404,{error:'Session expired or unavailable'});
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
        return res.end(fs.readFileSync(path.join(__dirname,'submit.html')));
      }
      if (req.method === 'GET' && url.pathname === '/submit.js') { res.writeHead(200,{'Content-Type':'text/javascript'}); return res.end(fs.readFileSync(path.join(__dirname,'submit.js'))); }
      if (req.method === 'POST' && parts[0] === 'upload' && parts.length === 2) {
        const session = db.sessions.find(s => s.id === parts[1]);
        if (!session || !session.open) return reply(404,{error:'Submissions are closed or this link expired'});
        const key = req.socket.remoteAddress;
        const rate = rates.get(key) || {count:0,until:Date.now()+60000};
        if (++rate.count > 10) return reply(429,{error:'Please wait a minute before submitting again'});
        rates.set(key,rate);
        if (session.tracks.length + (pending.get(session.id) || 0) >= maxTracks) return reply(409,{error:'This session is full'});
        const artist = (url.searchParams.get('artist') || '').trim(), title = (url.searchParams.get('title') || '').trim();
        if (!artist || artist.length > 100 || !title || title.length > 150 || url.searchParams.get('permission') !== 'yes') return reply(400,{error:'Artist, title and playback permission are required'});
        if (Number(req.headers['content-length']) > maxBytes) return reply(413,{error:'File exceeds the upload limit'});
        const id = crypto.randomUUID(), tmp = path.join(dir,id+'.part'); let size = 0, head = Buffer.alloc(0); const hash = crypto.createHash('sha256');
        pending.set(session.id,(pending.get(session.id)||0)+1);
        try {
          const check = new Transform({transform(chunk,encoding,done) {
            size += chunk.length;
            if (size > maxBytes) return done(Error('File exceeds the upload limit'));
            if (head.length < 16) head = Buffer.concat([head,chunk]).subarray(0,16);
            hash.update(chunk); done(null,chunk);
          }});
          await pipeline(req,check,fs.createWriteStream(tmp,{flags:'wx',mode:0o600}));
          const type = head.toString('ascii',0,4) === 'RIFF' && head.toString('ascii',8,12) === 'WAVE' ? 'audio/wav' : head.toString('ascii',0,4) === 'fLaC' ? 'audio/flac' : head.toString('ascii',0,4) === 'OggS' ? 'audio/ogg' : head.toString('ascii',0,3) === 'ID3' || (head[0] === 255 && (head[1]&224) === 224) ? 'audio/mpeg' : null;
          if (!type || size < 44) return reply(400,{error:'Upload an MP3, WAV, FLAC or OGG audio file'});
          if (!session.open || session.expiresAt <= Date.now() || !db.sessions.includes(session)) return reply(409,{error:'Session closed during upload'});
          const digest = hash.digest('hex');
          if (session.tracks.some(t => t.hash === digest)) return reply(409,{error:'This audio has already been submitted'});
          fs.renameSync(tmp,path.join(dir,id));
          session.tracks.push({id,artist,title,type,size,hash:digest,status:'pending',permissionAt:Date.now(),createdAt:Date.now(),explicit:url.searchParams.get('explicit') === 'yes'});save();
          return reply(201,{message:'Submitted for host review. Playback is not guaranteed.'});
        } finally { pending.set(session.id,Math.max(0,(pending.get(session.id)||1)-1));fs.rmSync(tmp,{force:true}); }
      }
      const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from('Bearer '+token);
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied,expected)) return reply(401,{error:'Host authentication required'});
      if (url.pathname === '/sessions' && req.method === 'GET') return reply(200,db.sessions.map(publicView));
      if (url.pathname === '/sessions' && req.method === 'POST') {
        if (db.sessions.length >= 4) return reply(409,{error:'Close and delete an old session first (maximum four)'});
        const session = {id:crypto.randomBytes(24).toString('hex'),open:true,expiresAt:Date.now()+ttl,tracks:[]};db.sessions.push(session);save();return reply(201,publicView(session));
      }
      const session = db.sessions.find(s => s.id === parts[1]);
      if (parts[0] !== 'sessions' || !session) return reply(404,{error:'Session unavailable'});
      if (parts.length === 2 && req.method === 'DELETE') {session.open=false;for(const t of session.tracks)fs.rmSync(path.join(dir,t.id),{force:true});db.sessions=db.sessions.filter(s=>s!==session);save();return reply(200,{deleted:true});}
      if (parts.length === 3 && ['open','close'].includes(parts[2]) && req.method === 'POST') {session.open=parts[2]==='open';save();return reply(200,publicView(session));}
      const track = session.tracks.find(t => t.id === parts[2]);
      if (!track) return reply(404,{error:'Track unavailable'});
      if (parts[3] === 'audio' && req.method === 'GET') {
        if (track.status === 'rejected') return reply(404,{error:'Track rejected'});
        res.writeHead(200,{'Content-Type':track.type,'Content-Length':track.size});
        await pipeline(fs.createReadStream(path.join(dir,track.id)),res);return;
      }
      if (req.method === 'POST' && ['approve','reject'].includes(parts[3])) {
        if(track.status==='rejected')return reply(409,{error:'Rejected track cannot be restored'});
        track.status=parts[3]==='approve'?'approved':'rejected';
        if(track.status==='rejected')fs.rmSync(path.join(dir,track.id),{force:true});
        save();return reply(200,{status:track.status});
      }
      reply(404,{error:'Unknown endpoint'});
    } catch(error) { if(!res.headersSent && !res.destroyed)reply(400,{error:'Request failed; check the file and retry'}); else res.destroy(); }
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  server.on('close',()=>clearInterval(timer));
  return server;
}
if(require.main===module){
  const server=createSubmissionServer({dir:process.env.DECKLAB_DATA_DIR||path.join(process.cwd(),'submission-data'),token:process.env.DECKLAB_HOST_TOKEN,origins:(process.env.DECKLAB_ORIGINS||'null,http://localhost:5173,http://127.0.0.1:5173,https://iykdecklab.vercel.app').split(',')});
  server.listen(Number(process.env.PORT)||8787,process.env.HOST||'127.0.0.1',()=>console.log('Submission inbox listening. Keep your host token private.'));
}
module.exports={createSubmissionServer};
