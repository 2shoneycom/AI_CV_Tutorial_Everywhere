import {request,fileImage,resizeImage} from './shared.js';
const $=id=>document.getElementById(id);const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
let stream=null,timer,running=false,generation=0,pending=null;
const valid=/^[a-f0-9]{48}$/.test(token);
$('status').textContent=valid?'노트북에 연결할 준비가 됐어요.':'노트북에서 만든 연결 주소로 다시 열어 주세요.';
$('start').disabled=!valid || !navigator.mediaDevices?.getUserMedia;$('photo').disabled=!valid;
$('secure-note').textContent=isSecureContext?'연속 촬영 시 약 1초마다 사진을 보냅니다.':'현재 연결에서는 연속 카메라 촬영을 사용할 수 없어요. 사진 촬영 / 선택을 이용하거나 README의 HTTPS 설정을 완료해 주세요.';
function stop(){generation++;running=false;clearTimeout(timer);pending?.abort();stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;$('video').hidden=true;$('placeholder').hidden=false;$('start').disabled=!valid || !navigator.mediaDevices?.getUserMedia;$('stop-camera').disabled=true;$('status').textContent='촬영이 중지됐어요.';}
async function send(image){pending=new AbortController();try{await request('/api/frame',token,{method:'POST',body:JSON.stringify({image}),signal:AbortSignal.any([pending.signal,AbortSignal.timeout(10_000)])});$('status').textContent=`전송 완료 · ${new Date().toLocaleTimeString('ko-KR')}`;}finally{pending=null;}}
async function loop(mine){if(!running || mine!==generation)return;try{await send(resizeImage($('video'),$('video').videoWidth,$('video').videoHeight));if(running && mine===generation)timer=setTimeout(()=>loop(mine),1000);}catch(e){if(mine!==generation)return;stop();$('camera-error').textContent=e.message;}}
$('start').onclick=async()=>{const mine=++generation;$('camera-error').textContent='';$('start').disabled=true;try{
 const acquired=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
 if(mine!==generation){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;$('video').srcObject=stream;await $('video').play();
 if(mine!==generation)return;$('video').hidden=false;$('preview').hidden=true;$('placeholder').hidden=true;running=true;$('stop-camera').disabled=false;loop(mine);
 }catch{stop();$('camera-error').textContent='카메라를 열 수 없어요. 카메라 권한과 HTTPS 연결을 확인하거나 사진 촬영을 이용해 주세요.';}};
$('stop-camera').onclick=stop;
$('photo').onchange=async e=>{stop();$('camera-error').textContent='';try{const image=await fileImage(e.target.files[0]);await send(image);$('preview').src=image;$('preview').hidden=false;$('placeholder').hidden=true;}catch(err){$('camera-error').textContent=err.message;}e.target.value='';};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});window.addEventListener('pagehide',stop);
