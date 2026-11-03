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
// Values stay escaped; colour and URL validation also cover attribute contexts.
const safeURL=(value,image=false)=>{
 if(!String(value||'').trim())return '';
 try{const u=new URL(String(value),window.location.href);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&(!image||u.origin===window.location.origin)?u.href:'';}catch(_){return '';}
};
const plain=html=>{const doc=new DOMParser().parseFromString(String(html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:p|div|li|h[1-6])>/gi,'\n'),'text/html');return doc.body.textContent.trim();};
const fieldHTML=(label,html)=>html?`<div class="fco-review-field"><dt>${esc(label)}</dt><dd>${html}</dd></div>`:'';
const valueHTML=value=>{
 if(value===true)return '<span class="fco-review-text">Yes</span>';if(value===false)return '<span class="fco-review-text">No</span>';
 if(value==null||value==='')return '';
 if(Array.isArray(value)){
  const items=value.map(v=>({html:valueHTML(v),record:v&&typeof v==='object'})).filter(v=>v.html);
  return items.length?`<ul class="${items.some(v=>v.record)?'fco-review-records':'fco-review-list'}">${items.map(v=>`<li>${v.html}</li>`).join('')}</ul>`:'';
 }
 if(typeof value==='object'){
  const fields=Object.entries(value).filter(([key])=>!['id','sort','parent','image','type','mime','size','created_at','send_to_build','purpose','uuid','project_id','checksum'].includes(key)).map(([key,v])=>fieldHTML(labels[key]||key.replace(/_/g,' '),valueHTML(v))).join('');
  return fields?`<dl class="fco-review-fields">${fields}</dl>`:'';
 }
 const text=String(value),url=/^https?:\/\//i.test(text)?safeURL(text):'';
 return url?`<a class="fco-review-text" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`:`<span class="fco-review-text">${esc(text)}</span>`;
};
const colourHTML=c=>{
 const hex=String(c.hex||'').trim(),valid=/^#(?:[a-f0-9]{3}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(hex);
 return `<li class="fco-review-colour"><span class="fco-review-swatch${valid?'':' is-unset'}" ${valid?`style="background-color:${hex}"`:''} aria-hidden="true"></span><div><strong>${esc(c.name||'Brand colour')}</strong><code>${esc(hex||'Colour not specified')}</code>${!valid&&hex?'<span>Check colour value</span>':''}${c.pantone?`<span>Pantone: ${esc(c.pantone)}</span>`:''}</div></li>`;
};
const assetHTML=a=>{
 const url=safeURL(a.url),imageURL=safeURL(a.url,true),image=imageURL&&a.type==='image'&&a.mime!=='image/svg+xml';
 const name=a.filename||a.name||'Brand file',purpose={logo:'Main logo',site_icon:'Icon / favicon',brand_image:'Brand reference',document:'Brand guidelines'}[a.client_purpose]||a.client_purpose||'Inkfire to advise';
 return `<li class="fco-review-asset">${image?`<div class="fco-review-image"><img src="${esc(imageURL)}" alt="${esc(a.alt||name)}" loading="lazy"></div>`:'<div class="fco-review-file">Brand file</div>'}<div class="fco-review-asset-caption"><strong>${esc(name)}</strong><span>Suggested use: ${esc(purpose)}</span>${a.caption?`<span class="fco-review-text">${esc(a.caption)}</span>`:''}${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open original: ${esc(name)}">Open original</a>`:''}</div></li>`;
};
const fontsHTML=fonts=>{
 const rows=(fonts||[]).filter(f=>f.name||f.url).map(f=>fieldHTML(A.fontRoleLabel?.(f)||f.label||'Font',valueHTML(f.name||'Uploaded font')+(f.url?`<div>${valueHTML(f.url)}</div>`:''))).join('');
 return rows?`<dl class="fco-review-fields fco-review-fonts">${rows}</dl>`:'';
};
A.renderAnswerReview=function($input,steps,goTo){
 const p=A.data.project,b=A.data.branding,d=A.data;
 const visible=steps.filter(s=>!['outro','brand_summary'].includes(s.id)&&s.type!=='build_page_steps'&&(!s.when||s.when()));
 const get=target=>target?.split('.').reduce((v,k)=>v?.[k],d);
 function answer(s){
  if(s.type==='extra_question')return valueHTML(p.extra_question_answers?.[s.question?.id]);
  if(s.type==='grouped_fields'){const fields=s.fields.map(f=>fieldHTML(f.label,valueHTML(get(f.target)))).join('');return fields?`<dl class="fco-review-fields">${fields}</dl>`:'';}
  if(s.type==='setup_fields'){const fields=s.fields.map(([key,label])=>fieldHTML(label,valueHTML(p[key]))).join('');return fields?`<dl class="fco-review-fields">${fields}</dl>`:'';}
  if(s.id==='blog_toggle')return valueHTML(p.has_blog)+(p.has_blog?valueHTML(b.blog_categories):'');
  if(s.id==='shop_toggle')return valueHTML(p.has_shop)+(p.has_shop?valueHTML(b.shop_categories):'');
  if(s.id==='features')return valueHTML((p.features||[]).map(k=>A.featureCatalogue?.find(x=>x[0]===k)?.[1]||k));
  if(s.id==='specialist_features')return valueHTML(Object.fromEntries((p.features||[]).filter(k=>p.feature_details?.[k]).map(k=>[A.featureCatalogue?.find(x=>x[0]===k)?.[1]||k,p.feature_details[k]])))+valueHTML(p.specialist_features);
  if(s.id==='integrations')return (p.integration_choices||[]).map(k=>`<div class="fco-review-record"><h3>${esc(A.connectionCatalogue?.find(x=>x[0]===k)?.[1]||k)}</h3>${valueHTML(p.integration_details?.[k])}</div>`).join('')+valueHTML(p.integrations);
  if(s.id==='contact_info')return valueHTML(b.contact);
  if(s.id==='socials')return valueHTML(b.socials);
  if(s.id==='staff_roster')return valueHTML(d.content.staff);
  if(s.id==='wp_users')return valueHTML(p.wp_users);
  if(s.id==='typography')return fontsHTML(b.fonts);
  if(s.id==='logos')return (b.assets||[]).length?`<ul class="fco-review-assets">${b.assets.map(assetHTML).join('')}</ul>`:'';
  if(s.id==='brand_colours')return (b.colours_by_inkfire?'<p>Inkfire to choose the brand colours.</p>':d._provenance?.defaults?.brand_colors?'<p>Suggested starting colours — please confirm.</p>':'')+((b.colors||[]).length?`<ul class="fco-review-colours">${b.colors.map(colourHTML).join('')}</ul>`:'')+valueHTML(b.colour_palette_url);
  if(s.id==='inspiration')return valueHTML(b.inspiration_links)+valueHTML(b.brand_doc?{name:b.brand_doc.filename,url:b.brand_doc.url}:null)+valueHTML(b.style_notes);
  if(s.id==='pages')return valueHTML(d.pages.map(page=>page.title));
  if(s.type==='rich_wizard'){const page=d.drafts[s.pageId]||{};return valueHTML(plain(d.drafts[s.pageId+'::main']?.content))+valueHTML(page.images?.map((img,i)=>({name:img.filename||`Image ${i+1}`,caption:img.caption||''})));}
  return valueHTML(get(s.target));
 }
 const rows=visible.map(s=>({s,html:answer(s)}));
 const isSkipped=s=>!!p.skipped_steps?.includes(s.id);
 const badge=(label,kind)=>`<span class="fco-review-status is-${kind}">${label}</span>`;
 const skippedBadge=s=>isSkipped(s)?badge('Skipped','skipped'):'';
 const brandIDs=['logos','brand_colours','typography'],brandRows=rows.filter(x=>brandIDs.includes(x.s.id));
 const edit=s=>`<button type="button" class="fco-btn ghost small" data-review-step="${esc(s.id)}" aria-label="${C.previewOnly?'View':'Edit'} ${esc(s.title)}">${C.previewOnly?'View section':'Edit'}</button>`;
 const card=({s,html})=>`<section class="fco-guided-card"><div class="fco-review-heading"><div class="fco-review-title"><h2>${esc(s.title)}</h2>${skippedBadge(s)}</div>${edit(s)}</div>${isSkipped(s)?'<p class="fco-review-note">Skipped for now; saved answers are retained below.</p>':''}<div class="fco-review-answer">${html}</div></section>`;
 const branding=brandRows.some(x=>x.html)?`<section class="fco-guided-card fco-review-brand"><header><p class="fco-review-eyebrow">Brand overview</p><h2>${esc(b.company_name||'Your brand')}</h2>${b.tagline?`<p>${esc(b.tagline)}</p>`:''}</header>${brandRows.map(({s,html})=>`<section class="fco-review-brand-section fco-review-brand-${esc(s.id)}"><div class="fco-review-heading"><div class="fco-review-title"><h3>${esc(s.title)}</h3>${skippedBadge(s)}</div>${edit(s)}</div>${isSkipped(s)?'<p class="fco-review-note">Skipped for now; saved answers are retained below.</p>':''}<div class="fco-review-answer">${html||'<p>No saved selection yet.</p>'}</div></section>`).join('')}<p class="fco-review-note">These are saved brand references. File use and delivery approval are managed separately.</p></section>`:'';
 const empty=rows.filter(x=>!x.html);
 $input.html(`<div class="fco-review-panel fco-answer-review"><p class="fco-review-introduction">${C.previewOnly?'Read the saved answers and brand references below. This preview cannot save changes.':'Check your answers below. Everything is optional; you can submit now and return later. Selecting a feature does not approve extra work.'}</p>${branding}<div class="fco-review-answer-grid">${rows.filter(x=>x.html&&!brandIDs.includes(x.s.id)).map(card).join('')}</div>${empty.length?`<section class="fco-guided-card fco-review-unanswered" aria-labelledby="fco-unanswered-title"><h2 id="fco-unanswered-title">Unanswered sections (${empty.length})</h2><p>These sections have no saved answer. “Skipped” means someone chose “Skip for now”; “Not answered” means no answer has been entered. Sections with saved answers are shown above, including any marked “Skipped”.</p><div class="fco-review-links">${empty.map(({s})=>`<div class="fco-review-missing-row"><div class="fco-review-missing-title"><strong>${esc(s.title)}</strong>${isSkipped(s)?badge('Skipped','skipped'):badge('Not answered','empty')}</div>${edit(s)}</div>`).join('')}</div></section>`:''}${!C.previewOnly?`<section class="fco-guided-card"><h2>Ready for Inkfire to review?</h2><p>Submit your saved answers when you are ready. This does not publish your website or send files to the build.</p>${!C.isAdmin?'<button type="button" class="fco-btn primary" id="fco-review-submit">Submit for Inkfire review</button><p class="fco-review-submitted" role="status"></p>':''}</section>`:''}</div>`);
 $input.off('click.fcoAnswerReview').on('click.fcoAnswerReview','[data-review-step]',e=>goTo(e.currentTarget.dataset.reviewStep));
 $input.on('click.fcoAnswerReview','#fco-review-submit',()=>document.getElementById('fco-submit-project')?.click());
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
