(function($){
'use strict';
const C=window.FCO_Config,B=window.FCO_HubBridge,A=window.FCO_App;
if(!C?.previewOnly||!C.previewProject||!B||!A)return;
// Install no-save guards before the app can render a question or schedule autosave.
const message='Preview only: changes are not saved.';
C.isAdmin=false;C.projectId=Number(C.previewProject);B.dirty=false;
clearTimeout(A.saveTimer);
B.state=()=>{$('.fco-save-indicator,.fco-hub-save').text(message).removeClass('is-error');};
A.setSaveState=B.state;
A.saveData=async()=>{B.dirty=false;B.state();return true;};
A.debouncedSave=()=>{clearTimeout(A.saveTimer);B.dirty=false;B.state();};
B.request=async()=>{throw new Error(message+' Return to project management to make changes.');};
A.apiPost=()=>B.jq(Promise.reject(new Error(message)));
B.chooseFiles=async()=>{B.notice('Uploads are disabled in preview. Existing project images are shown.');return [];};
A.importJson=()=>B.notice('Import is disabled in preview.');
A.syncToWpDraftPages=()=>B.notice('Sending to the build is disabled in preview.');
A.sendEmailSummary=()=>B.notice('Email is disabled in preview.');
const originalSwitch=A.switchMode.bind(A);
A.switchMode=function(mode){originalSwitch(mode);$('#wiz-save-now,#btn-sync-pages,#btn-email-summary,#btn-import-json').hide();$('.fco-wiz-footnote,.fco-welcome-footnote').text(message);B.state();};
$(async function(){
 const state=document.getElementById('fco-gateway-status');
 document.getElementById('fco-open-form').hidden=true;
 document.getElementById('fco-admin-preview')?.setAttribute('hidden','');
 document.getElementById('fco-signout').hidden=true;
 state.textContent='Loading the saved client view…';
 try{
  const response=await fetch(C.hubRoot+'/projects/'+C.projectId+'/client-preview',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{'X-WP-Nonce':C.previewNonce}});
  const saved=await response.json();
  if(!response.ok)throw new Error(saved.message||'Unable to load this project. Sign in again and reopen its preview.');
  if(saved.id!==C.projectId||!saved.read_only)throw new Error('The preview did not match the requested project.');
  B.context=saved.context;B.revision=saved.revision;C.user.name=saved.context.contact_name||'Your team';
  const projectLabel=document.getElementById('fco-project-label');projectLabel.textContent=saved.context.client_name||'Project';projectLabel.hidden=false;
  document.getElementById('fco-sitebar-tagline')?.setAttribute('hidden','');
  document.getElementById('fco-opening')?.setAttribute('hidden','');
  document.documentElement.style.setProperty('--fco-client-accent',saved.context.accent||'#32b190');
  A.apiGet=()=>B.jq(Promise.resolve(JSON.parse(JSON.stringify(saved.data))));
  const strip=document.querySelector('.fco-project-strip');
  strip.classList.add('fco-saved-preview-strip');
  strip.innerHTML='<div><strong id="fco-saved-preview-title"></strong><span class="fco-hub-save" role="status"></span></div><div class="fco-saved-preview-actions"><button type="button" data-preview-mode="start">Welcome</button><button type="button" data-preview-mode="wizard">Questions</button><button type="button" data-preview-mode="editor">Content dashboard</button><a id="fco-preview-back">Back to project</a></div>';
  document.getElementById('fco-saved-preview-title').textContent=(saved.context.client_name||'Project')+' · Saved revision '+saved.revision;
  const back=document.getElementById('fco-preview-back');back.href=C.adminUrl+'&project='+C.projectId;
  strip.querySelectorAll('[data-preview-mode]').forEach(button=>button.addEventListener('click',()=>A.switchMode(button.dataset.previewMode)));
  document.getElementById('fco-gateway').hidden=true;document.getElementById('fco-portal-project').hidden=false;
  await A.init();B.state();
 }catch(error){state.textContent=error.message;document.getElementById('fco-gateway').hidden=false;document.getElementById('fco-opening')?.setAttribute('hidden','');}
});
})(jQuery);
