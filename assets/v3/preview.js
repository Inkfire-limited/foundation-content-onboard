(function($){
'use strict';
$(function(){
 const button=document.getElementById('fco-admin-preview');if(!button)return;
 button.addEventListener('click',async function(){
  const A=window.FCO_App,B=window.FCO_HubBridge,C=window.FCO_Config;
  C.previewOnly=true;button.disabled=true;clearTimeout(A.saveTimer);B.dirty=false;C.projectId=0;
  B.context={contact_name:'Inkfire',client_name:'Preview project'};
  const projectLabel=document.getElementById('fco-project-label');projectLabel.textContent='Preview project';projectLabel.hidden=false;
  document.getElementById('fco-sitebar-tagline')?.setAttribute('hidden','');
  document.getElementById('fco-opening')?.setAttribute('hidden','');
  B.request=async()=>{throw new Error('Project requests are disabled in preview. Close preview to return.');};
  A.apiGet=()=>B.jq(Promise.resolve({project:{has_blog:true,has_shop:true,features:["bookings","memberships","courses","directory","events","forms","multilingual","custom"]},branding:{company_name:'Preview project'},pages:[]}));
  A.apiPost=()=>B.jq(Promise.reject(new Error('Preview only — nothing is saved.')));
  A.saveData=async()=>{B.dirty=false;return true;};A.debouncedSave=()=>{B.dirty=false;};
  B.chooseFiles=async()=>{B.notice('File uploads are unavailable in preview.');return [];};
  document.getElementById('fco-gateway').hidden=true;
  document.getElementById('fco-portal-project').hidden=false;
  const strip=document.querySelector('.fco-project-strip');
  strip.innerHTML='<strong>Admin preview — changes are not saved</strong><label class="fco-preview-picker">Section <select id="fco-preview-slide"></select></label><button type="button" id="fco-preview-close">Close preview</button>';
  document.getElementById('fco-preview-close').addEventListener('click',()=>location.reload());
  const slides=[['site_name','Site name'],['admin_setup','Admin details'],['tagline','Tagline'],['one_liner','One-liner'],['contact_info','Contact info'],['socials','Social media'],['logos','Brand assets'],['brand_colours','Palette'],['typography','Typography'],['inspiration','Inspiration'],['brand_summary','Brand summary'],['blog_toggle','Blog'],['blog_cats','Blog categories'],['shop_toggle','Online store'],['shop_cats','Product categories'],['staff_roster','Team'],['wp_users','WordPress users'],['pages','Sitemap'],['build_page_steps','Content'],['outro','Finish']];
  const select=document.getElementById('fco-preview-slide');document.addEventListener('fco:steps',e=>{select.replaceChildren();e.detail.forEach(s=>select.add(new Option(s.title,s.id)));select.value=A.data.project.wizard_step;});slides.forEach(([value,text])=>select.add(new Option(text,value)));
  select.addEventListener('change',()=>{A.data.project.wizard_step=select.value;A.switchMode('wizard');});
  const switchMode=A.switchMode.bind(A);A.switchMode=function(mode){switchMode(mode);$('#wiz-save-now').hide();$('.fco-wiz-footnote,.fco-welcome-footnote').text('Preview only — changes are not saved.');};
  await A.init();A.switchMode('wizard');
 });
});
})(jQuery);
