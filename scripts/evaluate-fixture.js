// Opt-in live API evaluation against synthetic kiosk screenshots only.
import {readFile,writeFile} from 'node:fs/promises';
import {analyze} from '../src/guide.js';
const root=new URL('../',import.meta.url);
const image='data:image/png;base64,'+(await readFile(new URL('report/assets/2026-11-12-kiosk.png',root))).toString('base64');
const results=[];
let history=[];
for(const scenario of [{name:'missing-goal',answer:'',expected:'question'},{name:'americano-grounding',answer:'아이스 아메리카노 한 잔을 주문하고 싶어요.',expected:'guide'}]){
 const started=Date.now();
 try{
  const guide=await analyze({image,history,answer:scenario.answer,apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL || 'gpt-5.4',signal:AbortSignal.timeout(45_000)});
  let pass=guide.status===scenario.expected;
  if(scenario.expected==='guide'){
   const b=guide.target;const cx=b?.x+b?.width/2,cy=b?.y+b?.height/2;
   // Manually annotated from the fixture image, used only for evaluation.
   pass=pass && cx>=218 && cx<=493 && cy>=322 && cy<=442;
  }
  results.push({name:scenario.name,pass,latencyMs:Date.now()-started,guide});
  history.push({user:scenario.answer,assistant:guide.message,status:guide.status,completionCheck:guide.completionCheck});
 }catch(e){results.push({name:scenario.name,pass:false,error:e.status?e.message:'API 연결 또는 응답 시간 확인 필요'});}
}
await writeFile(new URL('report/2026-11-12-fixture-evaluation.json',root),JSON.stringify({model:process.env.OPENAI_MODEL || 'gpt-5.4',note:'Two synthetic fixture checks; not a general accuracy benchmark.',results},null,2)+'\n');
console.log(JSON.stringify(results.map(({name,pass,latencyMs,guide,error})=>({name,pass,latencyMs,status:guide?.status,target:guide?.target,error})),null,2));
if(results.some(r=>!r.pass))process.exitCode=1;
