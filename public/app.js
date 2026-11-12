import {request,fileImage,resizeImage} from './shared.js';
const $=id=>document.getElementById(id);
let localStream=null,localTimer,localGeneration=0;
let session=null,frame=null,busy=false,epoch=0,pollTimer,guideMessage='';
function error(e){$('error').textContent=e?.message || '';}
function controls(){ $('local-start').disabled=!session || !!localStream || !navigator.mediaDevices?.getUserMedia; $('local-stop').disabled=!localStream; $('analyze').disabled=!session || !frame || busy; $('upload').disabled=!session || busy; $('stop').disabled=!session; $('connect').disabled=busy; $('analyze').textContent=busy?'장면을 살펴보고 있어요…':'현재 장면 안내받기 →'; }
function resetView(){frame=null;guideMessage='';$('live').hidden=true;$('live').removeAttribute('src');$('empty').hidden=false;$('snapshot-section').hidden=true;$('snapshot').removeAttribute('src');$('target').hidden=true;$('speak').disabled=true;$('history').replaceChildren();$('observation').textContent='';$('completion').hidden=true;$('message').textContent='사진을 연결하고 하고 싶은 일을 알려 주세요.';$('guide-title').textContent='무엇을 도와드릴까요?';$('guide-status').textContent='준비';$('frame-status').textContent='WAITING';$('answer').value='';window.speechSynthesis?.cancel();}
async function poll(mine){
 if(mine!==epoch || !session)return;
 try{const data=await request(`/api/frame?after=${frame?.id || ''}`,session.owner);
 if(mine!==epoch)return;
 if(!data.unchanged){frame=data;$('live').src=data.image;$('live').hidden=false;$('empty').hidden=true;}
 if(frame){const seconds=Math.floor((Date.now()-frame.receivedAt)/1000);$('frame-status').textContent=seconds>5?'수신 대기':'CONNECTED';$('age').textContent=`마지막 수신 ${seconds}초 전 · 안내는 아래의 분석 사진에 표시됩니다.`;}
 controls();
 }catch(e){if(mine!==epoch)return;error(e);if(e.status===401){session=null;resetView();$('connection').textContent='연결 만료';controls();return;}}
 if(mine===epoch)pollTimer=setTimeout(()=>poll(mine),650);
}
$('connect').onclick=async()=>{error();try{
 const next=await request('/api/session',null,{method:'POST',body:'{}'}); stopLocal();epoch++;clearTimeout(pollTimer);session=next;resetView();controls();
 $('connection').textContent='연결 준비 완료 · 2시간 동안 유효';$('pairing').open=true;$('links').replaceChildren();
 for(const url of next.cameraUrls){const row=document.createElement('div');row.className='link-row';const a=document.createElement('a');a.href=url;a.textContent=url;a.target='_blank';a.rel='noopener';const button=document.createElement('button');button.textContent='주소 복사';button.className='secondary';button.onclick=async()=>{try{await navigator.clipboard.writeText(url);button.textContent='복사 완료';}catch{error(new Error('주소를 직접 선택해서 복사해 주세요.'));}};row.append(a,button);$('links').append(row);}
 if(!next.cameraUrls.length)$('links').textContent='Wi-Fi 주소를 찾지 못했습니다. 노트북에서 사진을 선택해 테스트하세요.';
 if(!next.keyConfigured)error(new Error('API 키가 설정되지 않았습니다. 서버 설정을 확인해 주세요.'));
 poll(epoch);
 }catch(e){error(e);}};
$('stop').onclick=async()=>{const old=session;stopLocal();epoch++;clearTimeout(pollTimer);session=null;busy=false;resetView();controls();$('links').replaceChildren();$('connection').textContent='연결 종료';if(old)try{await request('/api/session',old.owner,{method:'DELETE'});}catch(e){error(e);}};
$('upload').onchange=async event=>{error();const mine=epoch;try{const image=await fileImage(event.target.files[0]);if(mine!==epoch || !session)return;await request('/api/frame',session.camera,{method:'POST',body:JSON.stringify({image})});}catch(e){error(e);}event.target.value='';};
$('guide-form').onsubmit=async event=>{event.preventDefault();if(busy || !session || !frame)return;error();busy=true;controls();const mine=epoch;const answer=$('answer').value.trim();
 $('snapshot-section').hidden=true; $('speak').disabled=true;
 try{const result=await request('/api/analyze',session.owner,{method:'POST',body:JSON.stringify({frameId:frame.id,answer})});if(mine!==epoch)return;
 const g=result.guide;$('snapshot').src=result.image;await $('snapshot').decode();if(mine!==epoch)return;$('snapshot-section').hidden=false;
 $('guide-status').textContent=({guide:'한 단계 안내',question:'질문',observe:'다시 확인',done:'목표 확인'})[g.status];
 $('guide-title').textContent=({guide:'여기부터 해볼까요?',question:'한 가지만 알려 주세요.',observe:'조금 더 확인할게요.',done:'여기까지 잘 하셨어요.'})[g.status];
 $('message').textContent=g.message;$('observation').textContent=g.observation;$('completion').textContent=g.completionCheck?`다음에 확인할 것 · ${g.completionCheck}`:'';$('completion').hidden=!g.completionCheck;
 const b=g.target;$('target').hidden=!b;if(b){Object.assign($('target').style,{left:`${(b.x+b.width/2)/10}%`,top:`${(b.y+b.height/2)/10}%`});$('target-label').textContent=b.label;}
 guideMessage=g.message;$('speak').disabled=!('speechSynthesis' in window);const li=document.createElement('li');li.textContent=`${answer || '장면 확인'} → ${g.message}`;$('history').append(li);$('answer').value='';
 }catch(e){if(mine===epoch)error(e);}finally{if(mine===epoch){busy=false;controls();}}};
$('speak').onclick=()=>{speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(guideMessage);utterance.lang='ko-KR';utterance.rate=0.9;speechSynthesis.speak(utterance);};

function stopLocal(){localGeneration++;clearTimeout(localTimer);localStream?.getTracks().forEach(t=>t.stop());localStream=null;$('local-video').srcObject=null;$('local-video').hidden=true;controls();}
async function localLoop(mine,sessionEpoch){
 if(!localStream || mine!==localGeneration || sessionEpoch!==epoch || !session)return;
 try{const image=resizeImage($('local-video'),$('local-video').videoWidth,$('local-video').videoHeight);await request('/api/frame',session.camera,{method:'POST',body:JSON.stringify({image})});
 if(mine===localGeneration && sessionEpoch===epoch)localTimer=setTimeout(()=>localLoop(mine,sessionEpoch),1000);
 }catch(e){if(mine===localGeneration){stopLocal();error(e);}}
}
$('local-start').onclick=async()=>{error();stopLocal();const mine=localGeneration;const sessionEpoch=epoch;$('local-start').disabled=true;
 try{const device=$('camera-device').value;const acquired=await navigator.mediaDevices.getUserMedia({video:device?{deviceId:{exact:device},width:{ideal:1280}}:{width:{ideal:1280}},audio:false});
 if(mine!==localGeneration || sessionEpoch!==epoch){acquired.getTracks().forEach(t=>t.stop());return;}
 localStream=acquired;$('local-video').srcObject=acquired;$('local-video').hidden=false;await $('local-video').play();
 const devices=await navigator.mediaDevices.enumerateDevices();const active=acquired.getVideoTracks()[0].getSettings().deviceId;$('camera-device').replaceChildren();
 for(const d of devices.filter(d=>d.kind==='videoinput')){const option=document.createElement('option');option.value=d.deviceId;option.textContent=d.label || '카메라';option.selected=d.deviceId===active;$('camera-device').append(option);}
 if(mine!==localGeneration || sessionEpoch!==epoch)return;controls();localLoop(mine,sessionEpoch);
 }catch{if(mine===localGeneration){stopLocal();error(new Error('카메라 권한과 아이폰 연결을 확인해 주세요. 기본 카메라를 허용하면 목록에서 아이폰을 선택할 수 있습니다.'));}}
};
$('local-stop').onclick=stopLocal;
$('camera-device').onchange=()=>{stopLocal();};
window.addEventListener('pagehide',()=>{stopLocal();clearTimeout(pollTimer);});
