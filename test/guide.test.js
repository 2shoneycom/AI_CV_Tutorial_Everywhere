import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyze,validateGuide,validateImage,imageDimensions} from '../src/guide.js';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const good={status:'guide',observation:'메뉴 버튼이 보입니다.',message:'메뉴를 눌러 주세요.',completionCheck:'옵션 화면 표시',target:{label:'메뉴',x:100,y:200,width:300,height:200}};
test('images reject disguised bytes, oversized payload and unsupported formats',()=>{
 assert.equal(validateImage(png),png);
 for(const bad of ['data:image/png;base64,YWJj','https://example.com/a.png','data:image/svg+xml;base64,YWJj',png+' '.repeat(3_000_000)])assert.throws(()=>validateImage(bad));
});
test('invalid grounding falls back to re-observation, never clamps a guessed box',()=>{
 assert.deepEqual(validateGuide(good),good);
 for(const target of [null,{...good.target,x:900},{...good.target,width:-1},{...good.target,y:NaN}])assert.equal(validateGuide({...good,target}).status,'observe');
 assert.equal(validateGuide({...good,status:'question'}).target,null);
 assert.throws(()=>validateGuide({...good,status:'unknown'}));
});
test('Responses input contains image and dialogue only and disables response storage',async()=>{
 let sent;
 const guide=await analyze({image:png,answer:'차가운 음료',history:[{user:'주문',assistant:'따뜻하게 드실까요?'}],apiKey:'test-secret',model:'test-model',fetchImpl:async(url,options)=>{
 sent=JSON.parse(options.body);assert.equal(url,'https://api.openai.com/v1/responses');
 return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(good)}]}]})};
 }});
 assert.equal(guide.status,'guide');assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);assert.equal(sent.input[0].content[1].image_url,png);assert.match(sent.input[0].content[0].text,/차가운/);assert.equal(sent.tools,undefined);
});
test('upstream credential errors do not leak upstream response text',async()=>{
 await assert.rejects(()=>analyze({image:png,history:[],answer:'',apiKey:'secret',model:'test',fetchImpl:async()=>({ok:false,status:401,text:async()=> 'private-data'})}),e=>!e.message.includes('private-data')&&/인증/.test(e.message));
});
test('incomplete and refusal output are explicit rather than fake guides',async()=>{
 const call=data=>analyze({image:png,history:[],answer:'',apiKey:'x',fetchImpl:async()=>({ok:true,json:async()=>data})});
 await assert.rejects(()=>call({status:'incomplete',output:[]}));
 assert.equal((await call({status:'completed',output:[{content:[{type:'refusal'}]}]})).status,'observe');
});

test('encoded PNG dimensions are supplied independently for each axis',()=>{ assert.deepEqual(imageDimensions(png),{width:1,height:1}); });
