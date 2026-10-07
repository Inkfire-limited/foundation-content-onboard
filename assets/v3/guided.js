/* Guided requirement collection. These choices request review, never enable build features. */
(function ($) {
'use strict';
const A=window.FCO_App, B=window.FCO_HubBridge;
if(!A||!B)return;
const esc=B.escape;
const features=[
 ['forms','Contact forms','What should people ask or send, and who should receive it?'],
 ['gallery','Photo gallery','What will you show, and who will keep it updated?'],
 ['downloads','Downloads & resources','Which files should visitors be able to download?'],
 ['search','Website search','What content should visitors be able to search?'],
 ['bookings','Bookings & appointments',''],['memberships','Members area',''],
 ['donations','Donations','One-off or regular donations? Tell us about any existing donation service.'],
 ['courses','Online courses','Who can access courses, and do you need to track progress?'],
 ['directory','Directory & listings','Who can add listings, and who approves them?'],
 ['events','Events','Information only, reservations or paid tickets?'],
 ['multilingual','Multiple languages','Which languages are needed, and who will supply translations?'],
 ['custom','Something else to discuss','Describe the task you need help with. Inkfire will assess it before agreeing the work.'],
 ['unsure','Help me decide','']
];
const connections=[
 ['crm','Customer records (CRM)','Customer enquiries, contacts or leads'],
 ['email_marketing','Email newsletters','Sign-ups and mailing lists'],
 ['payments','Payments','An existing payment service'],
 ['accounting','Accounts & invoicing','Invoices or sales records'],
 ['booking','Booking system','An existing booking or scheduling service'],
 ['analytics','Visitor analytics','Reports on website use'],
 ['other','Another service','A specific service to discuss'],
 ['none','No connections needed',''],['unsure','Help me decide','']
];
A.featureCatalogue=features; A.connectionCatalogue=connections;
A.guidedRequirementsHTML=function(data){
 const p=data.project||{},selected=Array.isArray(p.features)?p.features:[],linked=Array.isArray(p.integration_choices)?p.integration_choices:[];
 if(!selected.length&&!linked.length)return '';
 const featureRows=selected.map(key=>{const item=features.find(x=>x[0]===key);const note=p.feature_details?.[key];return `<div class="fco-requirement-row"><h4>${esc(item?item[1]:key)}</h4><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(note||'No further detail supplied.')}</p></div>`;}).join('');
 const connectionRows=linked.map(key=>{const item=connections.find(x=>x[0]===key);const detail=p.integration_details?.[key]||{};return `<div class="fco-requirement-row"><h4>${esc(item?item[1]:key)}</h4><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc([detail.service,detail.outcome].filter(Boolean).join('\n')||'No further detail supplied.')}</p></div>`;}).join('');
 return `<section class="fco-admin-card"><h3>Feature & connection requests</h3><p>Preferences for review, not approved scope. Check the agreed quote before adding work. Notes for deselected options remain in the project data but are not active requests.</p>${featureRows}${connectionRows}</section>`;
};
const scope='<p class="fco-scope-note"><strong>For Inkfire to review.</strong> Your agreed quote defines what is included. Extra features, subscriptions or connections may affect cost and timing. Nothing is added to the build by selecting it here.</p>';
function pills(items,selected,kind){return `<fieldset class="fco-guided-pills"><legend>${kind==='feature'?'Features to discuss':'Services to connect'}</legend>${items.map(([key,label])=>`<label class="fco-option-pill"><input type="checkbox" data-${kind}="${key}" ${selected.includes(key)?'checked':''}><span>${esc(label)}</span></label>`).join('')}</fieldset>`;}
function field(id,label,value,help,attrs='',kind='textarea'){
 const common=`id="${id}" name="${id}" autocomplete="off" data-lpignore="true" class="fco-wiz-field fco-group-control" aria-describedby="${id}-help" maxlength="2000" ${attrs}`;
 return `<div class="fco-form-field"><label for="${id}">${esc(label)}</label>${kind==='input'?`<input type="text" ${common} value="${esc(value||'')}">`:`<textarea ${common} rows="3">${esc(value||'')}</textarea>`}<p class="fco-question-help" id="${id}-help">${esc(help||'')}</p></div>`;
}
function goTo(id){const picker=document.getElementById('wiz-jump');if(picker){picker.value=id;picker.dispatchEvent(new Event('change',{bubbles:true}));}}
function mapObject(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
A.renderGuidedStep=function(s,$input,steps){
 const p=A.data.project;
 if(s.id==='features'){
  const current=Array.isArray(p.features)?p.features:[];
  $input.html(`<div class="fco-guided-panel"><p class="fco-guided-intro">Choose the features you would like to discuss. Blog and shop questions follow later.</p>${pills(features,current,'feature')}${scope}<p class="fco-guided-feedback" role="status"></p></div>`);
  $input.on('change','[data-feature]',e=>{
   const key=e.target.dataset.feature;const chosen=new Set(Array.isArray(p.features)?p.features:[]);
   if(e.target.checked)chosen.add(key);else chosen.delete(key);p.features=[...chosen];
   $input.find('.fco-guided-feedback').text('Feature preferences updated. Inkfire will review these against your agreed scope.');A.debouncedSave();
  });return true;
 }
 if(s.id==='specialist_features'){
  const selected=features.filter(([key,,help])=>help&&(p.features||[]).includes(key));
  p.feature_details=mapObject(p.feature_details);
  $input.html(`<div class="fco-guided-panel"><p class="fco-guided-intro">A little more detail about the features you selected. Describe the outcome you need; we will work out the technical setup.</p><div class="fco-selected-pills" aria-label="Selected features">${selected.map(([,label])=>`<span>${esc(label)}</span>`).join('')}</div><div class="fco-guided-detail-grid">${selected.map(([key,label,help])=>`<section class="fco-guided-card">${field('fco-feature-'+key,label,p.feature_details[key],help,`data-feature-detail="${key}"`)}</section>`).join('')}</div><details class="fco-guided-legacy" ${p.specialist_features?'open':''}><summary>Additional notes${p.specialist_features?' (previously supplied)':''}</summary>${field('wiz-field-specialist_features','Anything else we should know?',p.specialist_features,'Keep this to the selected features. Other work needs a separate discussion.','data-legacy="specialist_features"')}</details><button class="fco-btn ghost small" type="button" data-change-features>Change feature choices</button>${scope}</div>`);
  $input.on('input','[data-feature-detail]',e=>{p.feature_details[e.target.dataset.featureDetail]=e.target.value;A.debouncedSave();});
  $input.on('input','[data-legacy]',e=>{p.specialist_features=e.target.value;A.debouncedSave();});
  $input.on('click','[data-change-features]',()=>goTo('features'));return true;
 }
 if(s.id==='integrations'){
  p.integration_details=mapObject(p.integration_details);
  const chosen=()=>Array.isArray(p.integration_choices)?p.integration_choices:[];
  $input.html(`<div class="fco-guided-panel"><p class="fco-guided-intro">Does your website need to share information with a service you already use?</p>${pills(connections,chosen(),'connection')}<div class="fco-guided-detail-grid" id="fco-connection-details"></div><details class="fco-guided-legacy" ${p.integrations?'open':''}><summary>Connection notes${p.integrations?' (previously supplied)':''}</summary>${field('wiz-field-integrations','Notes for Inkfire',p.integrations,'Existing answers are kept here. Do not include passwords or private access keys.','data-connection-notes')}</details>${scope}<p class="fco-guided-feedback" role="status"></p></div>`);
  const renderDetails=()=>{
   $input.find('#fco-connection-details').html(connections.filter(([key])=>chosen().includes(key)&&!['none','unsure'].includes(key)).map(([key,label,hint])=>{
    const value=mapObject(p.integration_details[key]);
    return `<section class="fco-guided-card"><h2>${esc(label)}</h2>${field('fco-provider-'+key,'Service name',value.service,'Name the service, or write “not decided”.',`data-connection-key="${key}" data-part="service"`,'input')}${field('fco-outcome-'+key,'What should it do?',value.outcome,hint+'. Describe the result you need, not the technical steps.',`data-connection-key="${key}" data-part="outcome"`)}</section>`;
   }).join(''));
  };renderDetails();
  $input.on('change','[data-connection]',e=>{
   const key=e.target.dataset.connection;let set=new Set(chosen());
   if(e.target.checked){if(['none','unsure'].includes(key))set=new Set([key]);else{set.delete('none');set.delete('unsure');set.add(key);}}else set.delete(key);
   p.integration_choices=[...set];$input.find('[data-connection]').each((i,node)=>{node.checked=set.has(node.dataset.connection);});renderDetails();
   $input.find('.fco-guided-feedback').text(set.has('none')?'No connections requested. Previous notes are kept.':set.has('unsure')?'Inkfire will help you decide. Previous notes are kept.':'Connection preferences updated.');A.debouncedSave();
  });
  $input.on('input','[data-connection-key]',e=>{const key=e.target.dataset.connectionKey;p.integration_details[key]=mapObject(p.integration_details[key]);p.integration_details[key][e.target.dataset.part]=e.target.value;A.debouncedSave();});
  $input.on('input','[data-connection-notes]',e=>{p.integrations=e.target.value;A.debouncedSave();});return true;
 }
 if(s.id==='outro' && A.renderAnswerReview){A.renderAnswerReview($input,steps,goTo);return true;}
 if(s.id==='outro'){
  const visible=steps.filter(x=>x.type!=='build_page_steps'&&x.id!=='outro'&&(!x.when||x.when()));
  const skipped=visible.filter(x=>(p.skipped_steps||[]).includes(x.id));
  const pages=Array.isArray(A.data.pages)?A.data.pages:[];
  const filled=pages.filter(page=>String(A.data.drafts?.[page.id+'::main']?.content||'').replace(/<[^>]*>/g,'').trim()).length;
  $input.html(`<div class="fco-review-panel"><p class="fco-guided-intro">Thank you for sharing your plans. Check your details and content, then submit them when you are ready for Inkfire to review.</p><div class="fco-review-stats"><div><strong>${filled} / ${pages.length}</strong><span>Pages with written content</span></div><div><strong>${skipped.length}</strong><span>Sections marked for later</span></div></div>${skipped.length?`<section class="fco-guided-card"><h2>Come back to these sections</h2><div class="fco-review-links">${skipped.map(x=>`<button type="button" class="fco-btn ghost small" data-review-step="${esc(x.id)}">${esc(x.title)}</button>`).join('')}</div></section>`:''}<section class="fco-guided-card"><h2>What happens next?</h2><p>Use <strong>Review content</strong> to check your workspace, or <strong>Submit for Inkfire review</strong> below to hand over the saved version.</p><p>You can keep adding or updating content afterwards. Submitting does not publish the website or approve extra work.</p></section></div>`);
  $input.on('click','[data-review-step]',e=>goTo(e.currentTarget.dataset.reviewStep));return true;
 }
 return false;
};
})(jQuery);
