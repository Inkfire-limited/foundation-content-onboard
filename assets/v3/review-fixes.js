/* Preserve unfinished answers and make review and handover explicit. */
(function($){
'use strict';
const A=window.FCO_App,B=window.FCO_HubBridge,C=window.FCO_Config;
if(!A||!B)return;
const esc=B.escape;
const pending=new Map();
function pendingData(){
 const p=A.data.project;
 if(!p.pending_inputs||Array.isArray(p.pending_inputs)||typeof p.pending_inputs!=='object')p.pending_inputs={};
 return p.pending_inputs;
}
A.trackPendingInput=function(selector,key,commit){
 const input=document.querySelector(selector);if(!input)return;
 const data=pendingData();input.value=data[key]||input.value;
 pending.set(key,{input,commit,project:C.projectId});
 const remember=()=>{if(input.value)data[key]=input.value;else delete data[key];A.debouncedSave();};
 $(input).on('input.fcoPending',remember).on('blur.fcoPending',()=>flush(key)).on('keydown.fcoPending',e=>{if(e.key==='Enter')queueMicrotask(remember);});
};
function flush(key){
 const item=pending.get(key);if(!item||!item.input.isConnected||item.project!==C.projectId)return;
 delete pendingData()[key];
 if(item.input.value.trim())item.commit();
}
A.flushPendingInputs=function(){for(const [key,item] of pending){if(!item.input.isConnected||item.project!==C.projectId)pending.delete(key);else flush(key);}};

const labels={company_name:'Organisation',tagline:'Tagline',one_liner:'What you do',address:'Address',emails:'Email addresses',phones:'Phone numbers',platform:'Platform',url:'Link',name:'Name',label:'Use',hex:'Colour',pantone:'Pantone reference',username:'Username',email:'Email',first_name:'First name',last_name:'Last name',role:'Requested role',position:'Role',bio:'Biography',service:'Service',outcome:'What it should do',caption:'Image notes',client_purpose:'Suggested use'};
const plain=html=>{const doc=new DOMParser().parseFromString(String(html||''),'text/html');return doc.body.textContent.trim();};
const valueHTML=value=>{
 if(value===true)return 'Yes';if(value===false)return 'No';
 if(value==null||value==='')return '';
 if(Array.isArray(value))return value.map(valueHTML).filter(Boolean).map(v=>`<li>${v}</li>`).join('') ? `<ul>${value.map(valueHTML).filter(Boolean).map(v=>`<li>${v}</li>`).join('')}</ul>`:'';
 if(typeof value==='object')return Object.entries(value).filter(([key])=>!['id','sort','parent','image','type','mime','size','created_at','send_to_build','purpose','uuid','project_id'].includes(key)).map(([key,v])=>{const out=valueHTML(v);return out?`<div><strong>${esc(labels[key]||key.replace(/_/g,' '))}:</strong> ${out}</div>`:'';}).join('');
 return esc(String(value));
};
A.renderAnswerReview=function($input,steps,goTo){
 const p=A.data.project,b=A.data.branding,d=A.data;
 const visible=steps.filter(s=>!['outro','brand_summary'].includes(s.id)&&s.type!=='build_page_steps'&&(!s.when||s.when()));
 const get=target=>target?.split('.').reduce((v,k)=>v?.[k],d);
 function answer(s){
  if(s.type==='grouped_fields')return s.fields.map(f=>{const value=valueHTML(get(f.target));return value?`<div><strong>${esc(f.label)}:</strong> ${value}</div>`:'';}).join('');
  if(s.type==='setup_fields')return s.fields.map(([key,label])=>p[key]?`<div><strong>${esc(label)}:</strong> ${valueHTML(p[key])}</div>`:'').join('');
  if(s.id==='blog_toggle')return valueHTML(p.has_blog)+(p.has_blog?valueHTML(b.blog_categories):'');
  if(s.id==='shop_toggle')return valueHTML(p.has_shop)+(p.has_shop?valueHTML(b.shop_categories):'');
  if(s.id==='features')return valueHTML((p.features||[]).map(k=>A.featureCatalogue?.find(x=>x[0]===k)?.[1]||k));
  if(s.id==='specialist_features')return valueHTML(Object.fromEntries((p.features||[]).filter(k=>p.feature_details?.[k]).map(k=>[A.featureCatalogue?.find(x=>x[0]===k)?.[1]||k,p.feature_details[k]])))+valueHTML(p.specialist_features);
  if(s.id==='integrations')return (p.integration_choices||[]).map(k=>`<div><strong>${esc(A.connectionCatalogue?.find(x=>x[0]===k)?.[1]||k)}</strong>${valueHTML(p.integration_details?.[k])}</div>`).join('')+valueHTML(p.integrations);
  if(s.id==='contact_info')return valueHTML(b.contact);
  if(s.id==='socials')return valueHTML(b.socials);
  if(s.id==='staff_roster')return valueHTML(d.content.staff);
  if(s.id==='wp_users')return valueHTML(p.wp_users);
  if(s.id==='typography')return valueHTML((b.fonts||[]).filter(font=>font.name||font.url));
  if(s.id==='logos')return valueHTML((b.assets||[]).map(a=>({name:a.filename||a.name||'Brand file',client_purpose:a.client_purpose||'Inkfire to advise'})));
  if(s.id==='brand_colours')return (b.colours_by_inkfire?'Inkfire to choose. ':d._provenance?.defaults?.brand_colors?'Suggested starting colours — please confirm. ':'')+valueHTML(b.colors)+valueHTML(b.colour_palette_url);
  if(s.id==='inspiration')return valueHTML(b.inspiration_links)+valueHTML(b.brand_doc?.filename)+valueHTML(b.style_notes);
  if(s.id==='pages')return valueHTML(d.pages.map(page=>page.title));
  if(s.type==='rich_wizard'){const page=d.drafts[s.pageId]||{};return valueHTML(plain(d.drafts[s.pageId+'::main']?.content))+valueHTML(page.images?.map((img,i)=>({name:img.filename||`Image ${i+1}`,caption:img.caption||''})));}
  return valueHTML(get(s.target));
 }
 const rows=visible.map(s=>({s,html:answer(s)}));
 const missing=rows.filter(x=>!x.html||p.skipped_steps?.includes(x.s.id));
 $input.html(`<div class="fco-review-panel fco-answer-review"><p>Check your answers below. Everything is optional; you can submit now and return later. Selecting a feature does not approve extra work.</p>${missing.length?`<details class="fco-guided-card"><summary>${missing.length} sections to revisit (optional)</summary><div class="fco-review-links">${missing.map(({s})=>`<button type="button" class="fco-btn ghost small" data-review-step="${esc(s.id)}">${esc(s.title)}</button>`).join('')}</div></details>`:''}${rows.map(({s,html})=>`<section class="fco-guided-card"><div class="fco-review-heading"><h2>${esc(s.title)}</h2><button type="button" class="fco-btn ghost small" data-review-step="${esc(s.id)}" aria-label="Edit ${esc(s.title)}">Edit</button></div>${p.skipped_steps?.includes(s.id)?'<p class="fco-small">Marked for later; any saved answers are shown below.</p>':''}<div class="fco-review-answer">${html||'<p>No answer yet — that is fine.</p>'}</div></section>`).join('')}<section class="fco-guided-card"><h2>Ready for Inkfire to review?</h2><p>Submit your saved answers when you are ready. This does not publish your website or send files to the build.</p>${!C.isAdmin&&!C.previewOnly?'<button type="button" class="fco-btn primary" id="fco-review-submit">Submit for Inkfire review</button><p class="fco-review-submitted" role="status"></p>':''}</section></div>`);
 $input.on('click','[data-review-step]',e=>goTo(e.currentTarget.dataset.reviewStep));
 $input.on('click','#fco-review-submit',()=>document.getElementById('fco-submit-project')?.click());
};

const originalAssets=A.renderAssetManager;
A.renderAssetManager=function(target){
 originalAssets.call(A,target);
 $(target).find('.fco-media-item').each((i,node)=>{
  const a=A.data.branding.assets[i];
  $(node).append(`<label class="fco-asset-purpose">Suggested use<select class="fco-select" data-client-purpose="${i}">${[['','Inkfire to advise'],['logo','Main logo'],['site_icon','Icon / favicon'],['brand_image','Brand reference'],['document','Brand guidelines']].map(([key,label])=>`<option value="${key}" ${a.client_purpose===key?'selected':''}>${label}</option>`).join('')}</select></label>`);
 });
 $(target).off('change.fcoPurpose').on('change.fcoPurpose','[data-client-purpose]',e=>{A.data.branding.assets[Number(e.target.dataset.clientPurpose)].client_purpose=e.target.value;A.debouncedSave();});
 if(!$(target).next('.fco-asset-approval-note').length)$(target).after('<p class="fco-small fco-asset-approval-note">Tell us how you would like each file used. Inkfire still approves files and their final use before delivery.</p>');
};

function enhancePageImages(){
 const app=document.getElementById('fco-client-app');if(!app||!A.data)return;
 const wizard=app.classList.contains('mode-wizard');if(wizard&&app.dataset.wizardType!=='rich_wizard')return;
 const id=wizard?String(app.dataset.wizardStep).replace(/^pg_content_/,''):A.activeId,imgs=A.data.drafts[id]?.images||[],grid=wizard?'#wiz-page-imgs':'#editor-page-imgs';
 $(grid+' .fco-media-item').each((i,node)=>{if(node.querySelector('textarea'))return;$(node).append(`<label class="fco-image-note">Description / intended placement (optional)<textarea class="fco-input" data-image-note="${i}" rows="2" maxlength="2000">${esc(imgs[i]?.caption||'')}</textarea></label>`);});
 $(grid).off('input.fcoNotes').on('input.fcoNotes','[data-image-note]',e=>{if(imgs[e.target.dataset.imageNote]){imgs[e.target.dataset.imageNote].caption=e.target.value;A.debouncedSave();}});
}
function controls(){
 if(C.isAdmin||C.previewOnly)return;
 const current=!!B.submission?.current&&!B.dirty;
 const when=B.submission?.submitted_at?new Date(B.submission.submitted_at.replace(' ','T')).toLocaleString('en-GB'):'';
 const message=B.submission?current?`Submitted for Inkfire review · ${when}`:`Last submitted ${when}. Your later changes have not been submitted.`:'';
 const node=document.getElementById('fco-submission-status');if(node)node.textContent=message;
 document.querySelectorAll('#fco-submit-project,#fco-review-submit').forEach(button=>{button.disabled=!!B.submitting||current||B.conflict||B.accessRequired;button.textContent=current?'Submitted for review':B.submission?'Submit updated answers':'Submit for Inkfire review';});
 document.querySelectorAll('.fco-review-submitted').forEach(node=>node.textContent=message);
 const resume=document.getElementById('fco-resume-wizard');if(resume){resume.hidden=!document.getElementById('fco-client-app')?.classList.contains('mode-editor');resume.textContent=A.data?.project?.wizard_complete?'Review your answers':'Continue onboarding';}
}
B.refreshSubmission=controls;
const state=B.state;B.state=function(value){state.call(B,value);controls();};A.setSaveState=B.state;
document.addEventListener('fco:steps',()=>{enhancePageImages();controls();});
// Image lists are redrawn after selecting/removing files.
$(function(){const app=document.getElementById('fco-client-app');if(app)new MutationObserver(()=>enhancePageImages()).observe(app,{childList:true,subtree:true});
 document.getElementById('fco-resume-wizard')?.addEventListener('click',()=>{if(A.data.project.wizard_complete)A.data.project.wizard_step='outro';A.switchMode('wizard');});
});
const renderEditor=A.renderEditor;A.renderEditor=function($el){renderEditor.call(A,$el);if(!C.isAdmin){const button=$('<button>',{type:'button',class:'fco-btn ghost small',text:A.data.project.wizard_complete?'Review answers':'Continue wizard'});button.on('click',()=>{if(A.data.project.wizard_complete)A.data.project.wizard_step='outro';A.switchMode('wizard');});$el.find('.fco-head-right').prepend(button);}};
const originalSwitch=A.switchMode;A.switchMode=function(mode){originalSwitch.call(A,mode);controls();};
B.confirmSubmission=()=>new Promise(resolve=>{
 const opener=document.activeElement,dialog=document.createElement('dialog');dialog.className='fco-file-dialog fco-submit-dialog';dialog.setAttribute('aria-labelledby','fco-submit-title');
 dialog.innerHTML='<h2 id="fco-submit-title">Submit for Inkfire review?</h2><p>Your saved answers will be ready for the Inkfire team to review. You can keep editing afterwards. Nothing is published or delivered to your build.</p><div class="fco-dialog-actions"><button type="button" data-confirm-submit>Submit answers</button><button type="button" data-cancel-submit>Keep reviewing</button></div>';
 const finish=value=>{dialog.close();dialog.remove();if(opener?.isConnected)opener.focus();resolve(value);};
 dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});dialog.addEventListener('click',e=>{if(e.target.closest('[data-confirm-submit]'))finish(true);if(e.target.closest('[data-cancel-submit]'))finish(false);});document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-cancel-submit]').focus();
});
})(jQuery);
