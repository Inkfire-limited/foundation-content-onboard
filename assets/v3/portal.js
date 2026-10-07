(function($){
'use strict';
const C=window.FCO_Config,B=window.FCO_HubBridge,A=window.FCO_App;if(!B||C.isAdmin)return;
let busy=false,presenceTimer=null;
const tokenFrom=value=>{if(/^[a-f0-9]{64}$/.test(value))return value;try{const url=new URL(value,location.origin);return new URLSearchParams(url.hash.slice(1)).get('access')||'';}catch(e){return '';}};
const memberFrom=value=>{try{const url=new URL(value,location.origin);return new URLSearchParams(url.hash.slice(1)).get('member')||'';}catch(e){return '';}};
const stopPresence=()=>{if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null;}const node=document.getElementById('fco-presence');if(node){node.hidden=true;node.textContent='';node.removeAttribute('title');}};
const drawPresence=data=>{const node=document.getElementById('fco-presence');if(!node)return;const people=Array.isArray(data?.active)?data.active:[];if(!people.length){node.hidden=true;node.textContent='';node.removeAttribute('title');return;}const names=[...new Set(people.map(p=>String(p.name||'A teammate')))];node.hidden=false;node.textContent=names.length===1?`${names[0]} is also here`:`${names.length} teammates are also here`;node.title='Active in this project: '+names.join(', ');};
async function pingPresence(){if(!C.projectId||document.hidden)return;try{drawPresence(await B.request('/presence','POST',{project_id:C.projectId}));}catch(e){}}
const startPresence=()=>{stopPresence();pingPresence();presenceTimer=setInterval(pingPresence,20000);};
const loading=show=>{const node=document.getElementById('fco-opening');if(node)node.hidden=!show;};
function showGateway(message=''){
 stopPresence();loading(false);document.getElementById('fco-gateway').hidden=false;document.getElementById('fco-portal-project').hidden=true;
 document.getElementById('fco-gateway-status').textContent=message;
 document.getElementById('fco-signout').hidden=true;document.getElementById('fco-project-label').hidden=true;
 const tagline=document.getElementById('fco-sitebar-tagline');if(tagline)tagline.hidden=false;
}
async function openProject(token='',initial=false,member=''){
 if(busy||C.previewOnly)return;busy=true;const state=document.getElementById('fco-gateway-status');state.textContent='Opening your project…';
 if(initial)loading(true);
 try{
  if(C.projectId&&B.dirty&&!(await A.saveData())){state.textContent='Save or download your current changes before opening another project.';return;}
  const s=token?await B.request('/session','POST',{token,member}):await B.request('/session');
  if(C.previewOnly)return;
  B.csrf=s.csrf;B.context=s;C.projectId=s.project_id;C.user.name=s.contact_name;
  document.documentElement.style.setProperty('--fco-client-accent',s.accent||'#32b190');
  document.getElementById('fco-gateway').hidden=true;document.getElementById('fco-portal-project').hidden=false;document.getElementById('fco-signout').hidden=false;
  const label=document.getElementById('fco-project-label');label.textContent=s.client_name;label.hidden=false;
  const tagline=document.getElementById('fco-sitebar-tagline');if(tagline)tagline.hidden=true;
  if(token)history.replaceState(null,'',location.pathname+'#access='+token);
  await A.init();startPresence();
 }catch(e){if(!C.previewOnly)showGateway(initial&&!token&&e.code==='fco_session_required'?'':e.message);}
 finally{busy=false;loading(false);}
}
$(function(){
 document.getElementById('fco-open-form').addEventListener('submit',e=>{e.preventDefault();const value=document.getElementById('fco-invitation').value.trim(),token=tokenFrom(value);if(!/^[a-f0-9]{64}$/.test(token)){document.getElementById('fco-gateway-status').textContent='Paste the complete project link from your invitation email.';return;}openProject(token,false,memberFrom(value));});
 document.getElementById('fco-save-now').addEventListener('click',async()=>{A.flushPendingInputs?.();if(await A.saveData())B.notice('Your latest changes are saved.');});
 document.getElementById('fco-submit-project').addEventListener('click',async()=>{
  if(B.submitting)return;B.submitting=true;B.refreshSubmission?.();
  try{
   A.flushPendingInputs?.();if(!(await A.saveData()))return;
   if(B.submission?.current){B.notice('These answers have already been submitted.');return;}
   if(!(await B.confirmSubmission()))return;
   const result=await B.request(`/projects/${C.projectId}/submit`,'POST',{revision:B.revision});
   B.submission=result.submission;B.notice('Submitted for Inkfire review. Your project and files are saved.');
  }catch(err){B.notice(err.message,true);}finally{B.submitting=false;B.refreshSubmission?.();}
 });
 document.getElementById('fco-signout').addEventListener('click',async()=>{A.flushPendingInputs?.();if(!(await A.saveData()))return;try{await B.request('/logout','POST',{});B.dirty=false;history.replaceState(null,'',location.pathname);C.projectId=0;A.restorePortalHeader();showGateway('Your answers are saved. Use your private invitation link to return.');}catch(e){B.notice(e.message,true);}});
 // Resolve access before displaying the entry screen; invitation holders see only their welcome.
 openProject(tokenFrom(location.href),true,memberFrom(location.href));
 window.addEventListener('hashchange',()=>{const next=tokenFrom(location.href);if(next&&!C.previewOnly){if(B.dirty&&!confirm('Open another link? Save or download your unsaved work first.'))return;openProject(next,false,memberFrom(location.href));}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)pingPresence();});
});
})(jQuery);
