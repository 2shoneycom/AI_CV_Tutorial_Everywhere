import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { AppError, analyze, validateImage } from './guide.js';
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const files = { '/': ['index.html','text/html'], '/camera': ['camera.html','text/html'], '/app.js':['app.js','text/javascript'], '/camera.js':['camera.js','text/javascript'], '/style.css':['style.css','text/css'], '/shared.js':['shared.js','text/javascript'], '/kiosk':['kiosk.html','text/html'], '/kiosk.js':['kiosk.js','text/javascript'] };
const local = ip => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip);
const token = () => randomBytes(24).toString('hex');
async function body(req) {
  let size = 0; const parts = [];
  for await (const part of req) { size += part.length; if (size > 3_000_000) throw new AppError(413, '전송할 사진이 너무 큽니다.'); parts.push(part); }
  try { return JSON.parse(Buffer.concat(parts).toString()); } catch { throw new AppError(400, '요청 형식이 올바르지 않습니다.'); }
}
export function createApp({ apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || 'gpt-5.4', analyzeImpl = analyze } = {}) {
  const sessions = new Map();
  const clear = s => { s.controller?.abort(); s.frame = null; s.history = []; s.generation++; };
  function find(req, role) {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    const session = [...sessions.values()].find(s => (role === 'camera' ? s.camera : s.owner) === bearer);
    if (!session || Date.now() > session.expires) throw new AppError(401, '연결이 만료되었습니다. 노트북에서 새 연결을 만들어 주세요.');
    return session;
  }
  const cleanup = setInterval(() => { for (const [key,s] of sessions) if (Date.now()>s.expires) { clear(s); sessions.delete(key); } }, 60_000).unref();
  const handler = async (req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status,data) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.headers.origin && req.headers.origin !== `${req.socket.encrypted ? 'https':'http'}://${req.headers.host}`) throw new AppError(403,'다른 사이트에서 보낸 요청은 허용하지 않습니다.');
      if (req.method === 'GET' && files[url.pathname]) {
        const [name,type] = files[url.pathname]; res.setHeader('Content-Type',`${type}; charset=utf-8`); return res.end(await readFile(resolve(publicDir,name)));
      }
      if (req.method === 'POST' && url.pathname === '/api/session') {
        const host = new URL(`http://${req.headers.host}`).hostname;
        if (!local(req.socket.remoteAddress) || !['localhost','127.0.0.1','[::1]'].includes(host)) throw new AppError(403,'새 연결은 노트북의 localhost 화면에서 만들어 주세요.');
        for (const s of sessions.values()) clear(s); sessions.clear();
        const s = { owner:token(), camera:token(), frame:null, history:[], generation:0, busy:false, expires:Date.now()+2*60*60*1000, calls:0 };
        sessions.set(s.owner,s);
        const scheme = req.socket.encrypted ? 'https' : 'http'; const port = req.socket.localPort;
        const hosts = Object.values(networkInterfaces()).flat().filter(i=>i && i.family==='IPv4' && !i.internal).map(i=>i.address);
        return send(201,{ owner:s.owner, camera:s.camera, cameraUrls:hosts.map(h=>`${scheme}://${h}:${port}/camera#${s.camera}`), expires:s.expires, model, keyConfigured:!!apiKey });
      }
      if (url.pathname === '/api/frame' && req.method === 'POST') {
        const s=find(req,'camera'); const data=await body(req); const image=validateImage(data.image);
        if (s.lastUpload && Date.now()-s.lastUpload<300) throw new AppError(429,'전송 간격을 조금 늘려 주세요.');
        s.lastUpload=Date.now(); s.frame={id:token(),image,receivedAt:Date.now()}; return send(200,{id:s.frame.id});
      }
      if (url.pathname === '/api/frame' && req.method === 'GET') {
        const s=find(req,'owner'); return send(200,s.frame && s.frame.id !== url.searchParams.get('after') ? s.frame : { unchanged:true, receivedAt:s.frame?.receivedAt || null });
      }
      if (url.pathname === '/api/analyze' && req.method === 'POST') {
        const s=find(req,'owner'); const input=await body(req);
        if (s.busy) throw new AppError(409,'앞선 장면을 분석하고 있습니다.');
        if (!s.frame || s.frame.id !== input.frameId) throw new AppError(409,'화면이 갱신되었습니다. 최신 장면으로 다시 요청해 주세요.');
        if (Date.now()-s.frame.receivedAt>120_000) throw new AppError(409,'사진이 오래되었습니다. 다시 촬영해 주세요.');
        if (typeof input.answer !== 'string' || input.answer.length>1000) throw new AppError(400,'답변은 1,000자 이내로 입력해 주세요.');
        if (s.calls>=60) throw new AppError(429,'이 연결의 분석 횟수(60회)를 사용했습니다. 새 연결을 만들어 주세요.');
        if (s.lastCall && Date.now()-s.lastCall<1500) throw new AppError(429,'잠시 후 다시 분석해 주세요.');
        const snapshot={...s.frame}; const generation=s.generation; s.busy=true; s.calls++; s.lastCall=Date.now();
        const controller=new AbortController(); s.controller=controller;
        const timer=setTimeout(()=>controller.abort(),45_000);
        try {
          const guide=await analyzeImpl({image:snapshot.image,answer:input.answer,history:s.history,apiKey,model,signal:controller.signal});
          if (generation!==s.generation) throw new AppError(409,'종료된 안내입니다. 새 장면으로 시작해 주세요.');
          s.history.push({user:input.answer,assistant:guide.message,status:guide.status,completionCheck:guide.completionCheck}); s.history=s.history.slice(-8);
          return send(200,{guide,frameId:snapshot.id,image:snapshot.image,receivedAt:snapshot.receivedAt,analyzedAt:Date.now()});
        } finally { clearTimeout(timer); s.busy=false; if (s.controller===controller) s.controller=null; }
      }
      if (url.pathname === '/api/session' && req.method === 'DELETE') { const s=find(req,'owner'); clear(s); sessions.delete(s.owner); return send(200,{stopped:true}); }
      throw new AppError(404,'요청한 주소를 찾을 수 없습니다.');
    } catch (e) { if (!res.headersSent) send(e.status || 503,{error:e instanceof AppError ? e.message : e.name === 'AbortError' ? '분석을 중지했거나 시간이 초과되었습니다. 다시 시도해 주세요.' : '연결을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'}); }
  };
  return {handler, close:()=>{clearInterval(cleanup); for(const s of sessions.values())clear(s); sessions.clear();}};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app=createApp(); const tls=process.env.TLS_CERT && process.env.TLS_KEY;
  const server=tls ? https.createServer({cert:await readFile(process.env.TLS_CERT),key:await readFile(process.env.TLS_KEY)},app.handler) : http.createServer(app.handler);
  server.requestTimeout=60_000;
  server.listen(Number(process.env.PORT || 3000),process.env.HOST || '0.0.0.0',()=>console.log(`Tutorial Everywhere: ${tls?'https':'http'}://localhost:${server.address().port}`));
  const stop=()=>{app.close();server.close();server.closeAllConnections();}; process.on('SIGTERM',stop); process.on('SIGINT',stop);
}
