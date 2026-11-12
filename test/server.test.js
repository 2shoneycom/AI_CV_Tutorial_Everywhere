import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createApp} from '../src/server.js';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const guide={status:'question',observation:'메뉴 화면',message:'무엇을 드시겠어요?',target:null,completionCheck:''};
async function setup(t,analyzeImpl=async()=>guide){
 const app=createApp({apiKey:'fake',analyzeImpl});const server=http.createServer(app.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{app.close();server.close();server.closeAllConnections();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,token,method='GET',data)=>{const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,data:await response.json()};};
 const session=(await call('/api/session',null,'POST',{})).data;return{base,call,session};
}
test('camera can publish but cannot read images or invoke billed analysis',async t=>{
 const {call,session}=await setup(t);
 assert.equal((await call('/api/frame')).status,401);
 assert.equal((await call('/api/frame',session.camera)).status,401);
 assert.equal((await call('/api/analyze',session.camera,'POST',{})).status,401);
 assert.equal((await call('/api/frame',session.owner,'POST',{image})).status,401);
 assert.equal((await call('/api/frame',session.camera,'POST',{image})).status,200);
 const frame=(await call('/api/frame',session.owner)).data;assert.equal(frame.image,image);
 assert.equal((await call(`/api/frame?after=${frame.id}`,session.owner)).data.unchanged,true);
 assert.equal((await call('/api/analyze',session.owner,'POST',{frameId:'old',answer:''})).status,409);
 assert.equal((await call('/api/analyze',session.owner,'POST',{frameId:frame.id,answer:''})).data.guide.status,'question');
});
test('reset revokes camera and owner capabilities and clears images',async t=>{
 const {call,session}=await setup(t);await call('/api/frame',session.camera,'POST',{image});await call('/api/session',session.owner,'DELETE');
 assert.equal((await call('/api/frame',session.owner)).status,401);assert.equal((await call('/api/frame',session.camera,'POST',{image})).status,401);
 const next=(await call('/api/session',null,'POST',{})).data;assert.equal((await call('/api/frame',next.owner)).data.unchanged,true);
});
test('static file allowlist prevents reading secrets and cross-origin session creation is rejected',async t=>{
 const {base}=await setup(t);
 assert.equal((await fetch(base+'/.env.local')).status,404);
 assert.equal((await fetch(base+'/src/server.js')).status,404);
 assert.equal((await fetch(base+'/api/session',{method:'POST',headers:{Origin:'https://evil.example'}})).status,403);
});
test('concurrent analysis is rejected and in-flight result is invalidated on stop',async t=>{
 let release;let started;const began=new Promise(r=>started=r);
 const {call,session}=await setup(t,()=>{started();return new Promise(r=>release=r);});
 await call('/api/frame',session.camera,'POST',{image});const frame=(await call('/api/frame',session.owner)).data;
 const pending=call('/api/analyze',session.owner,'POST',{frameId:frame.id,answer:''});await began;
 assert.equal((await call('/api/analyze',session.owner,'POST',{frameId:frame.id,answer:''})).status,409);
 await call('/api/session',session.owner,'DELETE');release(guide);assert.equal((await pending).status,409);
});
test('analysis returns the captured image even when another image arrives',async t=>{
 let release,started;const began=new Promise(r=>started=r);
 const {call,session}=await setup(t,()=>{started();return new Promise(r=>release=r);});
 await call('/api/frame',session.camera,'POST',{image});const frame=(await call('/api/frame',session.owner)).data;
 const pending=call('/api/analyze',session.owner,'POST',{frameId:frame.id,answer:''});await began;
 await new Promise(r=>setTimeout(r,310));await call('/api/frame',session.camera,'POST',{image});release(guide);
 const result=(await pending).data;assert.equal(result.frameId,frame.id);assert.equal(result.image,frame.image);
 assert.notEqual((await call('/api/frame',session.owner)).data.id,result.frameId);
});
