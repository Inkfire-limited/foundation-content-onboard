/* Browser-side answer checkpoints survive a failed request or a reload. */
(function(){
'use strict';
const C=window.FCO_Config;
const R=window.FCO_SaveRecovery={};
const lifetime=14*86400000;
const pageId=crypto.randomUUID();
let database;
R.id=()=>crypto.randomUUID();
R.normalize=function(data){
 const object=(parent,key)=>{if(parent&&typeof parent==='object'){const value=parent[key];parent[key]=value&&typeof value==='object'?(Array.isArray(value)?Object.assign({},value):value):{};}};
 ['project','branding','content','drafts','comments','_provenance'].forEach(key=>object(data,key));
 ['extra_question_answers','pending_inputs','feature_details','integration_details'].forEach(key=>object(data.project,key));
 ['sections','defaults'].forEach(key=>object(data._provenance,key));
 return data;
};
R.snapshot=function(data){R.normalize(data);const copy=JSON.parse(JSON.stringify(data));delete copy._hub;return copy;};
function open(){
 if(!database)database=new Promise((resolve,reject)=>{
  if(!window.indexedDB){reject(new Error('Browser recovery storage unavailable'));return;}
  const request=indexedDB.open('inkfire-onboarding-recovery',1);
  request.onupgradeneeded=()=>{const store=request.result.createObjectStore('copies',{keyPath:'id'});store.createIndex('project_id','project_id');};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Browser recovery storage is blocked'));
 });
 return database;
}
async function write(record){
 try{
  const db=await open();
  return await new Promise(resolve=>{
   const tx=db.transaction('copies','readwrite'),store=tx.objectStore('copies');
   store.put(record);
   const project=[];
   const scan=store.openCursor();scan.onsuccess=()=>{const cursor=scan.result;if(cursor){if(cursor.value.at<Date.now()-lifetime)cursor.delete();else if(cursor.value.project_id===record.project_id)project.push(cursor.value);cursor.continue();}else{project.sort((a,b)=>b.at-a.at).slice(20).forEach(row=>store.delete(row.id));}};
   tx.oncomplete=()=>resolve(true);tx.onerror=tx.onabort=()=>resolve(false);
  });
 }catch(error){return false;}
}
R.checkpoint=function(data,context={}){
 if(!C.projectId||C.previewOnly)return Promise.resolve(false);
 const record={id:String(C.projectId)+':'+pageId,project_id:Number(C.projectId),at:Date.now(),status:context.status||'pending',revision:Number(context.revision||0),request_id:String(context.request_id||''),error_code:String(context.error_code||''),data:R.snapshot(data)};
 return write(record);
};
R.list=async function(projectId){
 try{const db=await open();return await new Promise(resolve=>{const tx=db.transaction('copies','readonly'),request=tx.objectStore('copies').index('project_id').getAll(Number(projectId));request.onsuccess=()=>resolve(request.result.filter(row=>row.at>=Date.now()-lifetime).sort((a,b)=>b.at-a.at));request.onerror=()=>resolve([]);});}catch(error){return [];}
};
R.confirm=async function(data,attempt,reference){
 try{const db=await open();return await new Promise(resolve=>{
  const tx=db.transaction('copies','readwrite'),store=tx.objectStore('copies'),request=store.get(String(C.projectId)+':'+pageId);
  request.onsuccess=()=>{const row=request.result;if(row&&row.request_id===attempt&&JSON.stringify(row.data)===JSON.stringify(data)){row.status='saved';row.request_id=reference||attempt;store.put(row);}};
  tx.oncomplete=()=>resolve(true);tx.onerror=tx.onabort=()=>resolve(false);
 });}catch(error){return false;}
};
R.offer=async function(){
 if(C.previewOnly||!C.projectId)return;
 const id=Number(C.projectId),current=JSON.stringify(R.snapshot(window.FCO_App.data)),rows=(await R.list(id)).filter(row=>row.status!=='saved'&&row.id!==String(id)+':'+pageId&&JSON.stringify(row.data)!==current);
 if(Number(C.projectId)!==id||!rows.length)return;
 let box=document.getElementById('fco-browser-recovery');if(box)box.remove();
 box=document.createElement('section');box.id='fco-browser-recovery';box.className='fco-recovery';box.setAttribute('aria-label','Browser recovery copy');
 const text=document.createElement('p');text.textContent='An earlier unsaved copy is kept on this browser. Download it before continuing; it has not replaced the saved project.';box.append(text);
 const download=document.createElement('button');download.type='button';download.textContent='Download earlier unsaved copy';download.addEventListener('click',()=>window.FCO_HubBridge.downloadJSON(rows[0].data,'onboarding-browser-recovery.json'));box.append(download);
 const close=document.createElement('button');close.type='button';close.textContent='Keep current saved version';close.addEventListener('click',()=>box.remove());box.append(close);
 document.getElementById('fco-client-app')?.before(box);
};
})();
