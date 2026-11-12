export async function request(path,token,options={}) {
 const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},signal:options.signal || AbortSignal.timeout(55_000)});
 const data=await response.json(); if(!response.ok) { const error=new Error(data.error || '요청에 실패했습니다.'); error.status=response.status; throw error; } return data;
}
export async function fileImage(file) {
 if(!file || file.size>20_000_000) throw new Error('20MB 이하의 이미지 파일을 선택해 주세요.');
 const source=URL.createObjectURL(file); const image=new Image();
 try { image.src=source; await image.decode(); return resizeImage(image,image.naturalWidth,image.naturalHeight); }
 catch { throw new Error('이 사진 형식을 읽지 못했습니다. JPEG 또는 PNG로 다시 선택해 주세요.'); }
 finally { URL.revokeObjectURL(source); }
}
export function resizeImage(source,width,height) {
 if(!width || !height) throw new Error('카메라가 준비될 때까지 기다려 주세요.');
 const scale=Math.min(1,1280/Math.max(width,height)); const canvas=document.createElement('canvas'); canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.82);
}
