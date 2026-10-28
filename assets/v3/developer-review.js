(function () {
'use strict';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

window.FCO_DeveloperReview = {
 async mount({project, root, request, notice, onConnection}) {
  const id=project.id;
  root.innerHTML='<section class="fco-admin-card fco-developer-review"><h3 tabindex="-1">Review answers &amp; developer brief</h3><p role="status">Loading the latest saved brief…</p></section>';
  const panel=root.firstElementChild;
  let loading=false;
  const load=async()=>{
   if(loading)return;loading=true;
   panel.querySelector('[data-refresh-brief]')?.setAttribute('disabled','');
   try {
    const brief=await request(`/projects/${id}/brief`);
    if(!panel.isConnected)return;
    const s=brief.summary||{},n=key=>Number(s[key]||0),last=project.submissions?.[0];
    panel.innerHTML=`<header class="fco-review-intro"><div><p class="fco-review-eyebrow">SAVED ANSWERS · REVISION ${Number(brief.revision)}</p><h3 tabindex="-1">Review answers &amp; developer brief</h3><p>Read the saved answers here before approving a development-site delivery. This view does not edit answers or send anything.</p><p class="fco-small">${brief.saved_at?'Last saved: '+escape(new Date(brief.saved_at).toLocaleString('en-GB'))+'. ':''}${last?'Latest submitted version: '+Number(last.revision)+(Number(last.revision)!==Number(brief.revision)?' — the current saved brief includes later changes.':'.'):'No submitted version yet.'}</p></div><div class="fco-review-actions"><button type="button" class="button" data-refresh-brief>Refresh saved answers</button><a class="button button-primary" href="${escape(brief.pdf_url)}" data-brief-pdf>Download current PDF</a><button type="button" class="button" data-review-connection>Review delivery settings</button></div></header>
     <div class="fco-review-summary" aria-label="Saved content summary"><div><strong>${n('pages_with_copy')} of ${n('pages_total')}</strong><span>pages contain written copy</span></div><div><strong>${n('questions_answered')} of ${n('questions_total')}</strong><span>project questions have an answer</span></div><div><strong>${n('files_approved')} of ${n('files_total')}</strong><span>files approved for transfer</span></div></div>
     <div class="fco-review-caution"><strong>Items to check before handoff</strong><p>${n('pages_without_copy')?n('pages_without_copy')+' planned page(s) have no written copy. ':''}${n('questions_unanswered')?n('questions_unanswered')+' optional project question(s) have no saved answer. ':''}A draft status is not evidence that page copy is present. Saved answers and requested features are not approval of scope.</p><p>${project.connection?'A development site is connected. Review its destination and choose the delivery scope separately.':'No development site is connected. This brief can still be reviewed and downloaded.'} Nothing in this view approves files, creates users or starts a delivery.</p></div>
     <div class="fco-brief-tools"><label for="fco-brief-search">Find an answer<input id="fco-brief-search" type="search" placeholder="Search questions, answers or section names" autocomplete="off"></label><label for="fco-brief-section">Jump to section<select id="fco-brief-section"><option value="">Choose a section</option></select></label><button type="button" class="button" data-clear-brief-search disabled>Clear search</button><p class="fco-small" id="fco-brief-search-status" role="status" aria-live="polite"></p></div>
     <div class="fco-brief-document">${brief.html}</div>
     <details class="fco-brief-email"><summary>Email this PDF to a teammate</summary><form><label for="fco-brief-email">Staff email address<input id="fco-brief-email" type="email" required maxlength="254" autocomplete="off" placeholder="colleague@example.com"></label><p class="fco-small">Contains private client information. Send only to someone working on this project. A separate confirmation is required.</p><button class="button" type="submit">Send PDF</button><p data-brief-email-status role="status"></p></form></details>`;
    const article=panel.querySelector('.inkfire-brief');
    const contents=[...article.querySelectorAll('h2')].find(h=>h.textContent==='Contents');
    if(contents?.nextElementSibling?.tagName==='OL')contents.nextElementSibling.remove();
    contents?.remove();
    const sections=[...article.children].filter(e=>e.tagName==='SECTION');
    const sectionPicker=panel.querySelector('#fco-brief-section');
    for(const section of sections){
     const heading=section.querySelector('h2'),name=heading?.textContent||'Saved information';
     sectionPicker.add(new Option(name,section.id));
     section.classList.add('fco-brief-section');
     if(/^(Answer provenance|Preserved future|Additional saved information)/.test(name)){
      const details=document.createElement('details'),summary=document.createElement('summary');
      details.className='fco-brief-technical';summary.textContent=name;
      section.before(details);details.append(summary,section);heading.hidden=true;
     }
    }
    const search=panel.querySelector('#fco-brief-search'),clear=panel.querySelector('[data-clear-brief-search]'),status=panel.querySelector('#fco-brief-search-status');
    const filter=()=>{
     const q=search.value.trim().toLocaleLowerCase();let visible=0;
     for(const section of sections){const match=!q||section.textContent.toLocaleLowerCase().includes(q);section.hidden=!match;const details=section.closest('details');if(details){details.hidden=!match;details.open=!!q&&match;}if(match)visible++;}
     clear.disabled=!q;status.textContent=q?(visible?`${visible} of ${sections.length} sections match. The PDF always includes all saved information.`:'No matching saved answers. Try another word.'):sections.length+' sections · project questions, page copy, files and retained information included.';
    };
    search.addEventListener('input',filter);clear.addEventListener('click',()=>{search.value='';filter();search.focus();});
    sectionPicker.addEventListener('change',()=>{const target=sections.find(e=>e.id===sectionPicker.value);if(!target)return;search.value='';filter();const details=target.closest('details');if(details)details.open=true;target.querySelector('h2')?.removeAttribute('hidden');target.scrollIntoView({behavior:'auto',block:'start'});target.setAttribute('tabindex','-1');target.focus({preventScroll:true});});
    panel.querySelector('[data-refresh-brief]').addEventListener('click',load);
    panel.querySelector('[data-review-connection]').addEventListener('click',onConnection);
    let mailRequest=crypto.randomUUID();const form=panel.querySelector('.fco-brief-email form');
    form.addEventListener('input',()=>{mailRequest=crypto.randomUUID();});
    form.addEventListener('submit',async event=>{
     event.preventDefault();const email=form.querySelector('input').value.trim();
     if(!form.reportValidity()||!confirm(`Email the private PDF for ${project.settings.client_name}, revision ${brief.revision}, to ${email}?`))return;
     const button=form.querySelector('button');button.disabled=true;
     try{const result=await request(`/projects/${id}/brief/email`,'POST',{email,revision:brief.revision,request_id:mailRequest,confirmed:true});form.querySelector('[data-brief-email-status]').textContent=result.message;}
     catch(error){notice(error.message,true);}finally{button.disabled=false;}
    });
    filter();
   } catch(error){if(panel.isConnected){panel.innerHTML='<h3>Developer brief unavailable</h3><p>'+escape(error.message)+'</p><button type="button" class="button" data-retry-brief>Try again</button>';panel.querySelector('button').addEventListener('click',load);}}
   finally{loading=false;panel.querySelector('[data-refresh-brief]')?.removeAttribute('disabled');}
  };
  await load();
 }
};
})();
