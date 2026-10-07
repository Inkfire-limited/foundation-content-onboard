(function($){
'use strict';
const C=window.FCO_Config, A=window.FCO_App;
if(!C || !A || !C.hub) return;
const B=window.FCO_HubBridge={revision:0,csrf:'',dirty:false,saving:null,wanted:false,conflict:false,accessRequired:false,accessMessage:'',recoveryFocus:null,assets:[],context:{}};
const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
B.escape=esc;
B.notice=function(message,error=false){ const n=document.getElementById('fco-notice');if(n){n.textContent=message;n.className=error?'fco-toast error':'fco-toast';clearTimeout(B.noticeTimer);B.noticeTimer=setTimeout(()=>{n.className='';n.textContent='';},error?15000:6500);} };
B.headers=function(json=true){const h={};if(json)h['Content-Type']='application/json';if(C.isAdmin)h['X-WP-Nonce']=C.api.nonce;else if(B.csrf)h['X-FCO-CSRF']=B.csrf;return h;};
B.request=async function(path,method='GET',body=null,old=false){
 const opts={method,credentials:'same-origin',cache:'no-store',headers:B.headers(!(body instanceof FormData))};if(body!==null)opts.body=body instanceof FormData?body:JSON.stringify(body);
 const res=await fetch((old?C.api.root:C.hubRoot)+path,opts);let data;try{data=await res.json();}catch(e){throw Object.assign(new Error('The server returned an unexpected response. Your unsaved work is still here.'),{status:res.status});}
 if(!res.ok){const raw=String(data.data?.request_id||'');const requestId=/^FCO-SAVE-[A-F0-9]{12}$/.test(raw)?raw:'';throw Object.assign(new Error(data.message||'Request failed.'),{status:res.status,code:data.code,response:data,requestId});}return data;
};
B.jq=function(promise){const d=$.Deferred();promise.then(v=>d.resolve(v),e=>d.reject(e));return d.promise();};
A.apiGet=function(path,data={}){const query=new URLSearchParams(data);return B.jq(B.request(path+'?'+query,'GET',null,true).then(res=>{if(path==='/project/current'){B.submission=res._hub?.submission||null;B.revision=Number(res._hub?.revision||0);B.dirty=false;B.conflict=false;B.accessRequired=false;B.accessMessage='';B.state('saved');}return res;}));};
A.apiPost=function(path,payload={}){if(path==='/project/save')payload.revision=B.revision;return B.jq(B.request(path,'POST',payload,true).then(res=>{if(path==='/project/save')B.revision=Number(res.revision);return res;}));};
B.state=function(state){const text=state==='saving'?'Saving…':state==='access'?'Not saved. Refresh project access.':state==='error'?'Not saved. Please retry.':state==='dirty'?'Unsaved changes':state==='conflict'?'Another tab or person saved changes. Download your copy before reloading.':'All changes saved';$('.fco-save-indicator,.fco-hub-save').text(text).toggleClass('is-error',['error','conflict','access'].includes(state));};
A.setSaveState=B.state;
A.saveData=function(){
 clearTimeout(A.saveTimer);B.dirty=true;B.wanted=true;
 if(B.conflict){B.wanted=false;B.state('conflict');return Promise.resolve(false);}
 if(B.accessRequired){B.wanted=false;B.state('access');return Promise.resolve(false);}
 if(B.saving)return B.saving;
 B.saving=(async()=>{
   try{
    while(B.wanted){B.wanted=false;B.state('saving');const snapshot=JSON.parse(JSON.stringify(A.data));delete snapshot._hub;
     const result=await B.request('/project/save','POST',{project_id:C.projectId,revision:B.revision,data:snapshot},true);B.revision=Number(result.revision);B.submission=result.submission||B.submission;
     const current=JSON.parse(JSON.stringify(A.data));delete current._hub;if(JSON.stringify(snapshot)!==JSON.stringify(current))B.wanted=true;
    }
    B.dirty=false;B.state('saved');B.clearRecovery();return true;
   }catch(e){B.dirty=true;B.wanted=false;B.conflict=e.code==='fco_conflict';B.accessRequired=!C.isAdmin&&!C.previewOnly&&['fco_session_required','fco_session_stale'].includes(e.code);B.accessMessage='';B.recovery(e);B.state(B.conflict?'conflict':B.accessRequired?'access':'error');B.notice(e.message,true);return false;}
   finally{B.saving=null;}
 })();return B.saving;
};
A.debouncedSave=function(){B.dirty=true;clearTimeout(A.saveTimer);if(B.conflict||B.accessRequired){B.state(B.conflict?'conflict':'access');return;}B.state('dirty');A.saveTimer=setTimeout(()=>A.saveData(),650);};
B.downloadJSON=function(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
// Remember focus before disabling a native button: disabling it can move focus to BODY.
B.clearRecovery=function(){
 const bar=document.getElementById('fco-recovery');if(!bar)return;
 const active=document.activeElement;
 const lostFocus=B.recoveryFocus===bar&&(active===document.body||active===document.documentElement);
 if(bar.contains(active)||lostFocus){
  const status=Array.from(document.querySelectorAll('.fco-hub-save,.fco-save-indicator')).find(node=>node.getClientRects().length);
  if(status){status.tabIndex=-1;status.focus({preventScroll:true});}
 }
 if(B.recoveryFocus===bar)B.recoveryFocus=null;
 bar.remove();document.dispatchEvent(new Event('fco:recovery'));
};
B.refreshAccess=async function(){
 if(C.isAdmin||C.previewOnly||!B.accessRequired)return false;
 const projectId=Number(C.projectId);
 try{
  // Refresh credentials only. Never replace local answers or adopt a newer revision.
  const session=await B.request('/session');
  if(Number(C.projectId)!==projectId||Number(session.project_id)!==projectId){
   throw new Error('This browser has a different project open. Open this project’s original invitation in a new tab, then return here and choose Refresh access. Your work is kept in this tab.');
  }
  if(typeof session.csrf!=='string'||!/^[a-f0-9]{48}$/.test(session.csrf))throw new Error('Project access could not be refreshed. Open this project’s original invitation in a new tab, then try Refresh access again.');
  B.csrf=session.csrf;B.accessRequired=false;B.accessMessage='';
  // The existing saved revision still goes through the normal 409 conflict check.
  return await A.saveData();
 }catch(error){
  B.accessRequired=true;
  B.accessMessage=error.code==='fco_session_required'?'Your session has ended. Open this project’s original invitation in a new tab, then return here and choose Refresh access. Do not reload this tab before saving or downloading your work.':error.message;
  B.recovery(error);B.state('access');B.notice(B.accessMessage,true);return false;
 }
};
B.recovery=function(error){
 let bar=document.getElementById('fco-recovery');
 if(!bar){bar=document.createElement('section');bar.id='fco-recovery';bar.className='fco-recovery';bar.setAttribute('aria-labelledby','fco-recovery-title');bar.innerHTML='<strong id="fco-recovery-title">Your unsaved work has not been discarded.</strong><p class="fco-recovery-detail"></p><p class="fco-recovery-reference" hidden></p><div class="fco-recovery-actions"><button type="button" data-recovery="download">Download my copy</button><button type="button" data-recovery="refresh" hidden>Refresh access</button><button type="button" data-recovery="retry">Retry save</button><button type="button" data-recovery="reload">Reload latest saved version</button></div>';document.getElementById('fco-client-app').before(bar);
  bar.addEventListener('click',async e=>{const button=e.target.closest('[data-recovery]');if(!button||button.disabled)return;const action=button.dataset.recovery;
   if(action==='download')B.downloadJSON(A.data,'onboarding-unsaved-copy.json');
   if((action==='retry'&&!B.conflict&&!B.accessRequired)||(action==='refresh'&&B.accessRequired)){
    if(bar.contains(document.activeElement))B.recoveryFocus=bar;
    button.disabled=true;
    try{if(action==='refresh')await B.refreshAccess();else await A.saveData();}
    finally{
     if(button.isConnected){button.disabled=false;const active=document.activeElement;if(B.recoveryFocus===bar&&(active===document.body||active===document.documentElement)){const target=B.conflict?'download':B.accessRequired?'refresh':'retry';bar.querySelector('[data-recovery="'+target+'"]').focus();}}
     if(B.recoveryFocus===bar)B.recoveryFocus=null;
    }
   }
   if(action==='reload'&&confirm('Reload the saved version? Download your unsaved copy first.')){B.dirty=false;location.reload();}
  });
 }
 bar.querySelector('.fco-recovery-detail').textContent=B.conflict?'Another tab or person saved a newer version. Download your copy before reloading. We will not overwrite their changes.':B.accessRequired?(B.accessMessage||'This tab needs current project access. Refresh access to retry saving without losing your work. If your session has ended, open this project’s original invitation in a new tab first, then return here. A newer saved version will still be protected.'):'Saving was not confirmed. Retry here, or download your copy before reloading.';
 const retry=bar.querySelector('[data-recovery="retry"]'),refresh=bar.querySelector('[data-recovery="refresh"]'),active=document.activeElement;
 const follow=(active===retry||active===refresh)||(B.recoveryFocus===bar&&(active===document.body||active===document.documentElement));
 retry.hidden=B.conflict||B.accessRequired;refresh.hidden=!B.accessRequired||B.conflict;
 if(follow&&((active===retry&&retry.hidden)||(active===refresh&&refresh.hidden)||active===document.body||active===document.documentElement)){bar.querySelector('[data-recovery="'+(B.conflict?'download':B.accessRequired?'refresh':'retry')+'"]').focus();}
 const reference=bar.querySelector('.fco-recovery-reference');if(error){reference.hidden=!error.requestId;reference.textContent=error.requestId?'Support reference: '+error.requestId:'';}
 document.dispatchEvent(new Event('fco:recovery'));
};
window.addEventListener('beforeunload',e=>{if(B.dirty){e.preventDefault();e.returnValue='';}});
A.exportJson=function(){B.downloadJSON(A.data,'onboarding-content.json');};
A.importJson=function(e){const file=e.target.files?.[0];if(!file)return;file.text().then(async raw=>{try{const data=JSON.parse(raw);if(!Array.isArray(data.pages))throw new Error('The file needs a pages array.');if(!confirm('Replace this project’s content with the uploaded JSON?'))return;A.data=data;if(await A.saveData()){B.dirty=false;location.reload();}}catch(err){B.notice(err.message,true);}});};
A.syncToWpDraftPages=function(){B.notice('Use the Connection panel to review and send an approved revision. Local WordPress sync is disabled.');if(C.isAdmin)document.getElementById('fco-close-editor')?.click();};
A.sendEmailSummary=function(){B.notice('Invitations and review status are managed from the project dashboard.');};

const originalLoad=A.loadProject.bind(A);
A.loadProject=async function(){await originalLoad();if(!A.data)return;A.wizardState={};if(Array.isArray(A.data.comments))A.data.comments={...A.data.comments};B.dirty=false;B.state('saved');};
A.renderStart=function($el){const m=B.context;const name=m.contact_name||C.user.name||'your team';const client=m.client_name||A.data.branding.company_name||'your project';const resuming=!!A.data.project.wizard_step&&!['intro','site_name'].includes(A.data.project.wizard_step);$el.html(`<div class="fco-start-hero"><div class="fco-start-kicker">Welcome, ${esc(name)}</div>${m.logo_url?`<img class="fco-client-logo" src="${esc(m.logo_url)}" alt="${esc(client)} logo">`:''}<h1 class="fco-start-title">Let’s build<br>${esc(client)}.</h1><p class="fco-start-sub">${esc(m.welcome||'Bring your content, images and ideas together. Work at your own pace, and come back whenever you are ready.')}</p><div class="fco-start-actions"><button class="fco-btn primary large" id="btn-begin">${resuming?'Continue onboarding':'Start onboarding'} →</button><button class="fco-btn ghost large" id="btn-skip">Open content dashboard</button></div><p class="fco-welcome-footnote">Your progress saves to this project, not just this device.</p></div>`);$('#btn-begin').on('click',()=>A.switchMode('wizard'));$('#btn-skip').on('click',()=>A.switchMode('editor'));};
const originalEditor=A.renderEditor.bind(A);
A.renderEditor=function($el){originalEditor($el);$('#btn-sync-pages').text('Review delivery');$('#btn-email-summary').hide();if(B.context.logo_url)$el.find('.fco-logo-mark img').attr({src:B.context.logo_url,alt:(B.context.client_name||'Client')+' logo'});B.state(B.conflict?'conflict':B.accessRequired?'access':B.dirty?'dirty':'saved');};
A.renderUserListManager=function(targetId){const list=A.data.project.wp_users;$(targetId).html(list.map((u,i)=>`<div class="fco-user-row"><label>Username<input class="fco-input user-in" data-i="${i}" data-k="username" value="${esc(u.username)}" name="requested-website-username-${i}" autocomplete="off" data-lpignore="true"></label><label>Email address<input type="email" class="fco-input user-in" data-i="${i}" data-k="email" value="${esc(u.email)}" autocomplete="off" required></label><label>First name<input class="fco-input user-in" data-i="${i}" data-k="first_name" value="${esc(u.first_name)}"></label><label>Last name<input class="fco-input user-in" data-i="${i}" data-k="last_name" value="${esc(u.last_name)}"></label><label>Requested role<select class="fco-select user-in" data-i="${i}" data-k="role">${['editor','author','contributor','subscriber'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${r[0].toUpperCase()+r.slice(1)}</option>`).join('')}</select></label><button type="button" class="fco-btn ghost small user-del" data-i="${i}" aria-label="Remove requested user ${i+1}">Remove</button></div>`).join('')||'<p>No accounts requested yet. Inkfire reviews these before creating users on the new website.</p>');$(targetId).off('input change click').on('input change','.user-in',e=>{const el=$(e.currentTarget);list[el.data('i')][el.data('k')]=el.val();A.debouncedSave();}).on('click','.user-del',e=>{list.splice($(e.currentTarget).data('i'),1);A.renderUserListManager(targetId);A.saveData();});};
A.renderAssetManager=function(targetId){const assets=A.data.branding.assets;$(targetId).html(assets.map((a,i)=>`<div class="fco-media-item">${a.type==='file'?`<span class="fco-file-label">${esc(a.filename||'Document')}</span>`:`<img src="${esc(a.url)}" alt="${esc(a.alt||'Brand asset')}">`}<button type="button" class="fco-media-x" aria-label="Remove this asset reference" data-i="${i}">×</button></div>`).join(''));$(targetId).off('click').on('click','.fco-media-x',e=>{assets.splice($(e.currentTarget).data('i'),1);A.renderAssetManager(targetId);A.saveData();});};
A.initWpEditor=function(id,conf){A.wpEditorId=id;const el=document.getElementById(id);if(!el)return;if(!window.wp?.editor?.initialize){el.addEventListener('input',()=>conf.onChange(el.value));return;}try{wp.editor.remove(id);}catch(e){}wp.editor.initialize(id,{tinymce:{wpautop:true,menubar:false,toolbar1:'formatselect,bold,italic,bullist,numlist,blockquote,link,unlink,removeformat,undo,redo',plugins:'lists,paste,wordpress,wplink',setup:ed=>ed.on('Change KeyUp SetContent',()=>conf.onChange(ed.getContent()))},quicktags:!!C.isAdmin,mediaButtons:false});$(el).off('input.fcoWp').on('input.fcoWp',()=>conf.onChange(el.value));};

B.chooseFiles=function(options={}){return new Promise(resolve=>{
 const opener=document.activeElement;
 const dialog=document.createElement('dialog');dialog.className='fco-file-dialog';dialog.setAttribute('aria-labelledby','fco-file-picker-title');dialog.innerHTML=`<form method="dialog" class="fco-dialog-head"><h2 id="fco-file-picker-title">${esc(options.title||'Project files')}</h2><button class="fco-x" aria-label="Close file picker">×</button></form><p>Only this project’s files are shown. Up to 20 MB per file. SVGs, Office files and fonts stay private references unless handled separately by Inkfire.</p><label class="fco-upload-label">Upload files <input type="file" id="fco-file-upload" ${options.multiple?'multiple':''} accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.svg,.txt,.zip,.docx,.pptx,.xlsx,.woff,.woff2,.ttf,.otf"></label><p class="fco-upload-state" role="status"></p><div class="fco-file-picker-grid"></div><div class="fco-dialog-actions"><button type="button" class="fco-picker-select">Attach selected files</button><button type="button" class="fco-picker-cancel">Cancel</button></div>`;
 document.body.appendChild(dialog);const selection=new Set();let items=[];let settled=false;
 const close=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();if(opener?.isConnected)opener.focus();resolve(value);};
 const render=()=>{dialog.querySelector('.fco-file-picker-grid').innerHTML=items.map(a=>`<button type="button" class="fco-pick-file ${selection.has(a.id)?'selected':''}" data-id="${a.id}" aria-pressed="${selection.has(a.id)}">${a.type==='image'?`<img src="${esc(a.url)}" alt="">`:'<span class="fco-document-icon">FILE</span>'}<span>${esc(a.filename)}</span><small>${Math.ceil(a.size/1024)} KB</small></button>`).join('')||'<p>No files yet. Upload your first one above.</p>';};
 const reload=async()=>{items=await B.request(`/projects/${C.projectId}/assets`);B.assets=items;render();};
 dialog.addEventListener('click',e=>{const pick=e.target.closest('.fco-pick-file');if(pick){const id=Number(pick.dataset.id);if(selection.has(id))selection.delete(id);else{if(!options.multiple)selection.clear();selection.add(id);}render();dialog.querySelector(`.fco-pick-file[data-id="${id}"]`)?.focus();}if(e.target.closest('.fco-picker-select'))close(items.filter(a=>selection.has(a.id)));if(e.target.closest('.fco-picker-cancel'))close([]);});
 dialog.addEventListener('close',()=>close([]));dialog.addEventListener('cancel',e=>{e.preventDefault();close([]);});
 const uploadFiles=async files=>{const input=dialog.querySelector('input[type=file]'),state=dialog.querySelector('.fco-upload-state');if(input.disabled||settled)return;const batch=Array.from(files||[]);if(!options.multiple)batch.splice(1);if(!batch.length)return;input.disabled=true;dialog.querySelector('.fco-picker-select').disabled=true;try{for(const file of batch){if(settled)break;if(file.size>20971520)throw new Error(file.name+' is larger than 20 MB.');state.textContent='Uploading '+file.name+'…';const fd=new FormData();fd.append('file',file);const asset=await B.request(`/projects/${C.projectId}/assets`,'POST',fd);if(!options.multiple)selection.clear();selection.add(asset.id);}await reload();state.textContent='Uploaded and saved to this project. Choose Attach selected files to add them to this section.';}catch(err){state.textContent=err.message;try{await reload();}catch(ignore){}}finally{input.disabled=false;input.value='';dialog.querySelector('.fco-picker-select').disabled=false;}};
 dialog.querySelector('input[type=file]').addEventListener('change',e=>uploadFiles(e.target.files));
 dialog.showModal();reload().then(()=>{if(options.initialFiles?.length)return uploadFiles(options.initialFiles);}).catch(e=>{dialog.querySelector('.fco-upload-state').textContent=e.message;});
});};
// Adapt the existing editor's media calls without giving guests WordPress Media Library access.
window.wp=window.wp||{};wp.media=function(options={}){let callback=null,selected=[];const models=()=>selected.map(a=>({id:a.id,attributes:a,toJSON:()=>a}));const frame={on:(event,fn)=>{if(event==='select')callback=fn;return frame;},state:()=>({get:()=>({map:fn=>models().map(fn),first:()=>models()[0]})}),open:()=>B.chooseFiles(options).then(files=>{selected=files;if(selected.length&&callback)callback();})};return frame;};

// Every dashed area uses the existing project picker, including drag-and-drop.
$(document).on('dragenter.fcoUpload dragover.fcoUpload','#fco-client-app .fco-upload-zone',function(e){if(!Array.from(e.originalEvent?.dataTransfer?.types||[]).includes('Files'))return;e.preventDefault();$(this).addClass('is-dragover');if(e.originalEvent.dataTransfer)e.originalEvent.dataTransfer.dropEffect='copy';}).on('dragleave.fcoUpload','#fco-client-app .fco-upload-zone',function(e){if(!this.contains(e.relatedTarget))$(this).removeClass('is-dragover');}).on('drop.fcoUpload','#fco-client-app .fco-upload-zone',function(e){e.preventDefault();e.stopPropagation();$(this).removeClass('is-dragover');const files=Array.from(e.originalEvent?.dataTransfer?.files||[]);if(!files.length||document.querySelector('.fco-file-dialog[open]'))return;const button=document.getElementById(this.dataset.uploadButton);if(button&&!button.disabled)$(button).trigger('click',[files]);});

// Persist wizard values as they change, including fields the prototype only captured on Next.
$(document).on('input.fcoHub','#wiz-input input,#wiz-input textarea',function(){const id=this.id||'';const brand={'wiz-field-site_name':'company_name','wiz-field-tagline':'tagline','wiz-field-one_liner':'one_liner'};if(brand[id]){A.data.branding[brand[id]]=this.value;A.debouncedSave();}if(id==='wiz-adm-email'||id==='wiz-adm-web'){A.data.project[id==='wiz-adm-email'?'admin_email':'existing_website']=this.value;A.debouncedSave();}});
})(jQuery);
