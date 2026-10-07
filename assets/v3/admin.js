(function($){
'use strict';
const C=window.FCO_Config,B=window.FCO_HubBridge,A=window.FCO_App;if(!B||!C.isAdmin)return;
let projects=[],selected=null,tab='overview';const esc=B.escape;
const date=s=>s?new Date(s.includes('T')?s:s.replace(' ','T')+'Z').toLocaleString('en-GB'):'Not yet';
const status=s=>String(s||'draft').replaceAll('_',' ');
const api=(path,method='GET',body=null)=>B.request(path,method,body);
const busy=async(btn,fn)=>{btn.disabled=true;try{await fn();}catch(e){B.notice(e.message,true);}finally{btn.disabled=false;}};
function shell(){
 const root=document.getElementById('fco-admin-app');
 root.innerHTML=`<header class="fco-admin-head"><div><p class="fco-eyebrow">INKFIRE · CLIENT WORKSPACE</p><h1>Client onboarding</h1><p>Invite. Collect. Review. Send to the build.</p></div><div><a class="button" href="${esc(C.portalUrl)}" target="_blank" rel="noopener">Open portal page</a> <button class="button button-primary" id="fco-create">New project</button></div></header><div class="fco-metrics"><div><strong id="fco-total">0</strong><span>Active projects</span></div><div><strong id="fco-progress">0</strong><span>In progress</span></div><div><strong id="fco-submitted">0</strong><span>Ready for review</span></div><div><strong>Private</strong><span>Project-scoped uploads</span></div></div><div class="fco-admin-grid"><aside class="fco-project-list-panel"><label for="fco-filter">Find a project</label><input id="fco-filter" type="search" placeholder="Client or contact"><label class="screen-reader-text" for="fco-status-filter">Project status</label><select id="fco-status-filter"><option value="">Current projects</option>${['draft','invited','in_progress','submitted','approved','archived','trash'].map(s=>`<option value="${s}">${esc(status(s))}</option>`).join('')}</select><div id="fco-project-list"></div></aside><section id="fco-project-detail"><div class="fco-admin-empty"><h2>A welcoming start for every client.</h2><p>Create a project, personalise the welcome and send a private invitation. Clients can return to the same link without a WordPress account.</p><p>Select a project on the left to manage its submissions and development-site connection.</p></div></section></div>`;
 root.querySelector('#fco-create').addEventListener('click',createDialog);
 root.querySelector('#fco-filter').addEventListener('input',list);
 root.querySelector('#fco-status-filter').addEventListener('change',list);
}
async function loadList(){projects=await api('/projects?include_trash=1');list();document.getElementById('fco-total').textContent=projects.filter(p=>!['archived','trash'].includes(p.status)).length;document.getElementById('fco-progress').textContent=projects.filter(p=>p.status==='in_progress').length;document.getElementById('fco-submitted').textContent=projects.filter(p=>p.status==='submitted').length;}
function list(){const q=(document.getElementById('fco-filter')?.value||'').toLowerCase(),filter=document.getElementById('fco-status-filter')?.value||'';document.getElementById('fco-project-list').innerHTML=projects.filter(p=>(filter?p.status===filter:!['archived','trash'].includes(p.status))&&`${p.name} ${p.email} ${p.contact} ${(p.collaborators||[]).map(c=>`${c.name} ${c.email}`).join(' ')}`.toLowerCase().includes(q)).map(p=>`<button class="fco-project-card ${selected?.id===p.id?'selected':''}" data-project="${p.id}"><strong>${esc(p.name)}</strong><span>${esc(p.contact||p.email||'Contact not set')}</span><span class="fco-badge">${esc(status(p.status))}</span>${p.invitation_schedule?.status==='scheduled'?`<small class="fco-list-scheduled">Invite scheduled: ${esc(p.invitation_schedule.display_time)}</small>`:''}<small>${p.filled} of ${p.pages} pages have content</small></button>`).join('')||'<p class="fco-small">No matching projects.</p>';document.querySelectorAll('[data-project]').forEach(btn=>btn.addEventListener('click',()=>select(Number(btn.dataset.project))));}
async function select(id){try{selected=await api('/projects/'+id);const filter=document.getElementById('fco-status-filter');if(['archived','trash'].includes(selected.settings.status))filter.value=selected.settings.status;else if(['archived','trash'].includes(filter.value))filter.value='';C.projectId=id;B.context=selected.settings;history.replaceState(null,'',C.adminUrl+'&project='+id);list();render();}catch(e){B.notice(e.message,true);}}
function render(){if(!selected)return;const d=selected,m=d.settings;if(m.status==='trash'){renderTrash(d);return;}document.getElementById('fco-project-detail').innerHTML=`<div class="fco-detail-head"><div><p class="fco-eyebrow">PROJECT ${d.id}</p><h2>${esc(m.client_name||'Existing project')}</h2></div><div class="fco-detail-meta"><span class="fco-badge">${esc(status(m.status))} · revision ${d.revision}</span><a class="button" href="${esc(C.portalUrl+'?fco_preview='+d.id)}" target="_blank" rel="noopener" title="Open the saved client view in a new tab. Changes are not saved.">Preview client view ↗</a>${lifecycleButtons(d)}</div></div><nav class="fco-admin-tabs" aria-label="Project sections">${['overview','content','questions','files','connection','emails','activity'].map(t=>`<button type="button" data-tab="${t}" class="${tab===t?'active':''}" aria-current="${tab===t?'page':'false'}">${t==='emails'?'Email history':t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</nav><div id="fco-detail-body"></div>`;document.querySelectorAll('.fco-admin-tabs button').forEach(b=>b.addEventListener('click',()=>{tab=b.dataset.tab;render();}));({overview,content,questions,files,connection,emails,activity})[tab]();bindLifecycleButtons();}
async function refresh(){await loadList();if(selected){selected=await api('/projects/'+selected.id);B.context=selected.settings;render();}}
function emails(){
 const root=document.getElementById('fco-detail-body');
 const rows=Array.isArray(selected.email_history)?selected.email_history:[];
 let page=0;const size=25;
 let formatter,zone=C.invitationTimezone||'Europe/London';
 try{formatter=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:zone});}
 catch(error){zone='UTC';formatter=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'});}
 const when=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?'Not recorded':formatter.format(d);};
 const labels={accepted:'Accepted by email service',failed:'Failed',pending:'Outcome unconfirmed',uncertain:'Outcome unconfirmed'};
 root.innerHTML=`<section class="fco-admin-card fco-email-history" aria-labelledby="fco-email-history-title"><h3 id="fco-email-history-title">Email history</h3><p>Invitation emails from this onboarder, newest first. Times shown in ${esc(zone)}.</p><p class="fco-small">Acceptance by the email service is not proof of inbox delivery or opening. Earlier entries come from recorded project activity. This panel does not send emails.</p>${rows.length?`<div class="fco-email-history-scroll" tabindex="0" role="region" aria-label="Email history table; scroll horizontally to see every column"><table class="widefat striped"><caption class="screen-reader-text">Invitation email history for ${esc(selected.settings.client_name||'this project')}</caption><thead><tr><th scope="col">Date / time</th><th scope="col">Recipient</th><th scope="col">Email</th><th scope="col">Status</th></tr></thead><tbody id="fco-email-history-rows"></tbody></table></div><div class="fco-email-history-pagination"><button type="button" class="button" id="fco-email-history-prev" aria-controls="fco-email-history-rows">Previous</button><span id="fco-email-history-page" role="status" aria-live="polite"></span><button type="button" class="button" id="fco-email-history-next" aria-controls="fco-email-history-rows">Next</button></div>`:'<p class="fco-email-history-empty">No invitation emails recorded for this project yet.</p>'}</section>`;
 if(!rows.length)return;
 const body=document.getElementById('fco-email-history-rows'),prev=document.getElementById('fco-email-history-prev'),next=document.getElementById('fco-email-history-next'),summary=document.getElementById('fco-email-history-page');
 const draw=()=>{
  const start=page*size,part=rows.slice(start,start+size);
  body.innerHTML=part.map(row=>`<tr><td><time datetime="${esc(row.at||'')}">${esc(when(row.at))}</time></td><td>${esc(row.recipient||'Not recorded')}</td><td><strong>${esc(row.type||'Invitation')}</strong>${row.method?`<small>${esc(row.method==='scheduled'?'Scheduled send':'Manual send')}</small>`:''}${row.actor?`<small>${esc(row.actor)}</small>`:''}${row.subject?`<small>${esc(row.subject)}</small>`:''}</td><td><span class="fco-badge">${esc(labels[row.status]||'Outcome unconfirmed')}</span></td></tr>`).join('');
  summary.textContent=`${start+1}–${start+part.length} of ${rows.length} recorded attempts`;
  prev.disabled=page===0;next.disabled=start+size>=rows.length;
 };
 prev.addEventListener('click',()=>{if(page>0){page--;draw();}});
 next.addEventListener('click',()=>{if((page+1)*size<rows.length){page++;draw();}});
 draw();
}
function schedulePanel(d){
 const s=d.invitation_schedule,tz=s?.timezone||C.invitationTimezone||'Europe/London',waiting=s?.status==='scheduled',locked=['sending','uncertain'].includes(s?.status),archived=['archived','trash'].includes(d.settings.status);
 const recipients=Array.isArray(s?.recipients)&&s.recipients.length?s.recipients:(s?.recipient?[s.recipient]:[]);
 const state=s?(s.status==='accepted'?'Accepted by email service':s.status==='scheduled'?'Scheduled':status(s.status)):'';
 const text=s?.status==='scheduled'?`Will send to ${recipients.length} ${recipients.length===1?'person':'people'} (${recipients.join(', ')}) on ${s.display_time}. This scheduled email batch has not been sent yet.`:s?.message||'';
 return `${s?`<div class="fco-schedule-state ${s.status==='failed'||s.status==='uncertain'||s.overdue?'needs-attention':''}" role="status"><strong>${esc(state)}</strong><p>${esc(text)}</p>${s.overdue?'<p>The scheduled time has passed. Background processing needs checking; do not send a duplicate.</p>':''}</div>`:''}
 <details class="fco-invite-schedule" ${waiting||locked?'open':''}><summary>${waiting?'Manage scheduled invitation':'Schedule an invitation'}</summary>
 <form id="fco-schedule-form"><label for="fco-invite-date">Send date and time<input type="datetime-local" id="fco-invite-date" name="send_at" required min="${esc(C.invitationLocalNow||'')}" value="${waiting?esc(s.local_datetime):''}" ${locked||archived?'disabled':''}></label>
 <p class="fco-small" id="fco-invite-timezone">Time zone: <strong>${esc(tz)}</strong>. The current branded email and latest saved welcome will be used.</p>
 <div class="fco-action-row"><button class="button button-primary" id="fco-schedule-save" type="submit" ${locked||archived?'disabled':''}>${waiting?'Update schedule':'Schedule invitation'}</button>${waiting?'<button class="button fco-button-danger" id="fco-schedule-cancel" type="button">Cancel scheduled send</button>':''}</div>
 <p class="fco-small">Changing the recipient, replacing or disabling the access link, or archiving the project cancels a pending invitation. WordPress background processing can run later if the site is unavailable or its scheduler is delayed.</p>
 </form></details>`;
}
function overview(){
 const d=selected,m=d.settings;
 let team=(Array.isArray(m.collaborators)&&m.collaborators.length?m.collaborators:(m.email?[{id:'primary',name:m.contact_name||'',email:m.email}]:[])).map(x=>({id:x.id||'',name:x.name||'',email:x.email||''}));
 const scheduled=d.invitation_schedule?.status==='scheduled',scheduleLocked=['scheduled','sending','uncertain'].includes(d.invitation_schedule?.status);
 const invitationState=scheduled?'Invitation scheduled':m.last_invite_status==='failed'?'Last email attempt failed':m.last_invite_status==='partial'?'Some invitations need attention':m.last_invite_status==='pending'?'Email status needs checking':!m.active?(m.last_invited?'Access disabled':'Not invited yet'):m.last_invite_status==='not_sent'?'New link ready, not emailed':m.last_invited?'Invitation sent':'Link ready, not emailed';
 const lastRecipients=Array.isArray(m.last_invited_recipients)&&m.last_invited_recipients.length?m.last_invited_recipients:(m.last_invited_email?[m.last_invited_email]:[]);const lastSent=m.last_invited?`Last accepted by the email service: ${esc(date(m.last_invited))}${lastRecipients.length?' to '+esc(lastRecipients.join(', ')):''}.`:'No invitation email has been sent for this project.';
 document.getElementById('fco-detail-body').innerHTML=`
 <form id="fco-settings" class="fco-admin-form">
  <h3>Client & welcome</h3><p class="fco-small">These details personalise the client’s workspace and invitation. Saving settings does not send an email.</p>
  <div class="fco-field-pair"><label>Client / company name<input name="client_name" value="${esc(m.client_name)}" maxlength="200" required></label><label>Contact name<input name="contact_name" value="${esc(m.contact_name)}" maxlength="200" placeholder="The name used in their welcome"></label></div>
  <label>Personal welcome<textarea name="welcome" rows="3" maxlength="5000" placeholder="Your project space is ready. Add your content whenever you have time.">${esc(m.welcome)}</textarea></label>
  <div class="fco-field-pair"><label>Client logo URL<input name="logo_url" type="url" value="${esc(m.logo_url)}" placeholder="https://…"></label><label>Accent colour<input type="color" name="accent" value="${esc(m.accent)}"></label></div>
  <button class="button" id="fco-logo-upload" type="button">Choose / upload client logo</button>
  <details class="fco-invite-advanced"><summary>Private staff notes</summary><label>Never shown to the client<textarea name="note" rows="3">${esc(m.note)}</textarea></label></details>
  <button class="button button-primary" type="submit">Save project settings</button>
 </form>
 <section class="fco-admin-card fco-invitation-card" aria-labelledby="fco-invitation-title">
  <div class="fco-invitation-heading"><h3 id="fco-invitation-title">Client invitation</h3><span class="fco-badge">${esc(invitationState)}</span></div>
  <p>Email each collaborator their own personalised entry link into the same shared workspace. Everyone can work at the same time; save conflicts are protected rather than silently overwritten.</p>
  <div class="fco-collaborator-editor" aria-labelledby="fco-collaborators-title"><div class="fco-collaborator-head"><h4 id="fco-collaborators-title">People with access</h4><button class="button" type="button" id="fco-add-collaborator">Add teammate</button></div><div id="fco-collaborator-list"></div><p class="fco-small">Each person gets the same project access with their name attached to their session. The client can still share a copied generic link if needed.</p></div>
  <p id="fco-invite-recipient-preview" class="fco-small"></p>
  <div class="fco-action-row fco-invite-actions"><button class="button button-primary" type="button" id="fco-email-invite">${m.last_invited&&m.last_invite_status!=='not_sent'?'Resend invitation':'Send invitation'}</button><button class="button" type="button" id="fco-copy-link">Copy access link</button></div>
  ${schedulePanel(d)}
  <p class="fco-small">${lastSent}</p>
  ${m.last_invited?'<p class="fco-mail-disclaimer">“Sent” means accepted by the email service, not confirmed in the recipient’s inbox.</p>':''}
  <details class="fco-invite-advanced"><summary>Advanced access controls</summary>
   <p>The link does not expire automatically. Anyone holding it can access and edit this project. Replacing or disabling it also ends existing client sessions.</p>
   <div class="fco-action-row"><button class="button" type="button" data-link="create" ${d.link?'':'disabled'}>Replace access link</button><button class="button fco-button-danger" type="button" data-link="revoke" ${d.link?'':'disabled'}>Disable client access</button></div>
   <p class="fco-small">Replacing a link does not email it. Use Send invitation afterwards. Copy access link creates a link automatically when one is needed.</p>
  </details>
 </section>`;
 const form=document.getElementById('fco-settings'),send=document.getElementById('fco-email-invite'),teamList=document.getElementById('fco-collaborator-list');
 const newMemberId=()=>`member_${(crypto.randomUUID?crypto.randomUUID().replaceAll('-',''):String(Date.now())+Math.random().toString(16).slice(2)).slice(0,16)}`;
 const settingsPayload=()=>({...Object.fromEntries(new FormData(form)),collaborators:team.map(person=>({id:person.id||'',name:person.name.trim(),email:person.email.trim()}))});
 const initial=JSON.stringify(settingsPayload());
 const teamEmails=()=>team.map(person=>person.email.trim()).filter(Boolean);
 const renderTeam=()=>{teamList.innerHTML=team.length?team.map((person,i)=>`<div class="fco-collaborator-row" data-index="${i}"><label>Name<input type="text" form="fco-settings" data-collab="name" value="${esc(person.name)}" maxlength="200" required autocomplete="name"></label><label>Email<input type="email" form="fco-settings" data-collab="email" value="${esc(person.email)}" maxlength="254" required autocomplete="email"></label><button class="button fco-button-danger" type="button" data-remove-collaborator="${i}" aria-label="Remove ${esc(person.name||'this teammate')}">Remove</button></div>`).join(''):'<p class="fco-small">No collaborators yet. Add the people who should receive access.</p>';};
 const updateRecipient=()=>{
  const emails=teamEmails(),preview=document.getElementById('fco-invite-recipient-preview');
  preview.textContent=emails.length?`${emails.length} ${emails.length===1?'person':'people'} will receive personalised access: ${emails.join(', ')}.`:'Add at least one teammate to send invitations. You can still copy a generic project link without recipients.';
  const dirty=JSON.stringify(settingsPayload())!==initial;
  send.textContent=scheduleLocked?'Send now (cancel schedule first)':dirty?'Save & send invitations':m.last_invited&&m.last_invite_status!=='not_sent'?'Resend invitations':'Send invitations';
  send.disabled=scheduleLocked||m.status==='archived'||!emails.length;
  if(scheduleLocked)preview.textContent='The invitation batch is already scheduled or awaiting a sending result. Manage it below; do not send a second batch.';
 };
 teamList.addEventListener('input',e=>{const row=e.target.closest('[data-index]');if(!row||!e.target.dataset.collab)return;team[Number(row.dataset.index)][e.target.dataset.collab]=e.target.value;updateRecipient();});
 teamList.addEventListener('click',e=>{const button=e.target.closest('[data-remove-collaborator]');if(!button)return;team.splice(Number(button.dataset.removeCollaborator),1);renderTeam();updateRecipient();});
 document.getElementById('fco-add-collaborator').addEventListener('click',()=>{team.push({id:newMemberId(),name:'',email:''});renderTeam();teamList.querySelector('[data-index]:last-child input')?.focus();updateRecipient();});
 form.addEventListener('input',updateRecipient);renderTeam();updateRecipient();
 if(m.status==='archived'){send.disabled=true;document.getElementById('fco-copy-link').disabled=true;document.querySelectorAll('[data-link]').forEach(button=>button.disabled=true);document.getElementById('fco-invite-recipient-preview').textContent='Reopen this project using the button above before inviting the client.';}
 const save=async()=>{if(!form.reportValidity())throw new Error('Please check the highlighted project fields.');return api('/projects/'+d.id,'POST',settingsPayload());};
 form.addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{await save();await refresh();B.notice('Settings saved. No invitation was sent.');});});
 document.getElementById('fco-logo-upload').addEventListener('click',async()=>{const chosen=await B.chooseFiles({title:'Choose client logo'});if(chosen[0]){form.elements.logo_url.value=chosen[0].url;updateRecipient();}});
 const scheduleForm=document.getElementById('fco-schedule-form'),dateInput=document.getElementById('fco-invite-date');
 let scheduleRequestId=crypto.randomUUID(),schedulePayloadKey='';
 dateInput.setAttribute('aria-describedby','fco-invite-timezone');
 scheduleForm.addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{
  const recipients=teamEmails();
  if(!recipients.length){document.getElementById('fco-add-collaborator').focus();throw new Error('Add at least one teammate before scheduling.');}
  if(!form.reportValidity()||!scheduleForm.reportValidity())return;
  const when=dateInput.value,tz=d.invitation_schedule?.timezone||C.invitationTimezone||'Europe/London';
  const pretty=new Intl.DateTimeFormat('en-GB',{dateStyle:'full',timeStyle:'short',timeZone:'UTC'}).format(new Date(when+'Z'));
  if(!confirm(`Schedule invitations to ${recipients.length} ${recipients.length===1?'person':'people'} for ${pretty} (${tz})?\n\nRecipients:\n${recipients.join('\n')}\n\nYour current welcome and settings will be saved. No email will be sent now.`))return;
  const saved=await save();
  const key=JSON.stringify([recipients,when,tz]);
  if(schedulePayloadKey&&key!==schedulePayloadKey)scheduleRequestId=crypto.randomUUID();schedulePayloadKey=key;
  const result=await api(`/projects/${d.id}/invitation-schedule`,'POST',{send_at:when,timezone:tz,expected_recipients:recipients,expected_schedule_id:saved.invitation_schedule?.id||'',request_id:scheduleRequestId,confirmed:true});
  await refresh();B.notice(result.message);
 });});
 document.getElementById('fco-schedule-cancel')?.addEventListener('click',e=>busy(e.currentTarget,async()=>{
  if(!confirm('Cancel this scheduled invitation? The client will not receive it, and their saved project content will be kept.'))return;
  const result=await api(`/projects/${d.id}/invitation-schedule/cancel`,'POST',{expected_schedule_id:d.invitation_schedule.id,confirmed:true});
  await refresh();B.notice(result.message);
 }));
 send.addEventListener('click',e=>busy(e.currentTarget,async()=>{
  if(scheduleLocked)throw new Error('Cancel the pending schedule before sending now.');
  const recipients=teamEmails();
  if(!recipients.length){document.getElementById('fco-add-collaborator').focus();throw new Error('Add at least one teammate before sending invitations.');}
  if(!form.reportValidity())return;
  if(!confirm(`Send personalised invitations to ${recipients.length} ${recipients.length===1?'person':'people'}?\n\n${recipients.join('\n')}\n\nYour current welcome and settings will be saved first.`))return;
  await save();
  const target=JSON.stringify(recipients),storageKey='fco_manual_invite_request_'+d.id,recipientKey=storageKey+'_recipient';
  const newId=()=>crypto.randomUUID?crypto.randomUUID():'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(c)/4).toString(16));
  let requestId='';
  try{
   requestId=sessionStorage.getItem(storageKey)||'';
   if(!requestId||sessionStorage.getItem(recipientKey)!==target){requestId=newId();sessionStorage.setItem(storageKey,requestId);sessionStorage.setItem(recipientKey,target);}
  }catch(error){requestId=newId();}
  let result,failed;
  try{result=await api(`/projects/${d.id}/invite`,'POST',{expected_recipients:recipients,request_id:requestId});}
  catch(error){
   failed=error;
   if(/recorded as failed|different recipient/i.test(String(error?.message||''))){try{sessionStorage.removeItem(storageKey);sessionStorage.removeItem(recipientKey);}catch(ignore){}}
  }
  await refresh();
  if(failed)throw failed;
  try{sessionStorage.removeItem(storageKey);sessionStorage.removeItem(recipientKey);}catch(ignore){}
  B.notice(result.message);
 }));
 document.getElementById('fco-copy-link').addEventListener('click',e=>busy(e.currentTarget,async()=>{
  const saved=await save();let link=saved.link;
  if(!link){const result=await api(`/projects/${d.id}/link`,'POST',{action:'create'});link=result.link;}
  try{await navigator.clipboard.writeText(link);await refresh();B.notice('Access link copied. No email was sent.');}
  catch(error){await refresh();const input=document.createElement('input');input.type='text';input.readOnly=true;input.value=link;input.setAttribute('aria-label','Private project link; select and copy');document.querySelector('.fco-invite-actions').after(input);input.focus();input.select();B.notice('Copy the highlighted access link. No email was sent.');}
 }));
 document.querySelectorAll('[data-link]').forEach(btn=>btn.addEventListener('click',()=>busy(btn,async()=>{
  const revoke=btn.dataset.link==='revoke';
  if(!confirm(revoke?'Disable the client’s link and existing sessions? Their saved work is kept.':'Replace the access link? The old link and existing sessions will stop working. No email is sent automatically.'))return;
  await save();await api(`/projects/${d.id}/link`,'POST',{action:btn.dataset.link});await refresh();B.notice(revoke?'Client access disabled. Saved content is kept.':'New link created. Send the invitation to share it with the client.');
 })));
}

let lifecyclePending=false;
function lifecycleButtons(d){
 const archived=d.settings.status==='archived',trashed=d.settings.status==='trash';
 return `<div class="fco-project-actions" aria-label="Project actions">${trashed?'<button type="button" class="button button-primary" data-life="restore">Restore project</button><button type="button" class="button fco-button-danger" data-life="delete">Delete permanently</button>':`<button type="button" class="button" data-life="${archived?'unarchive':'archive'}">${archived?'Reopen project':'Archive'}</button><button type="button" class="button fco-button-danger" data-life="trash">Delete</button>`}</div>`;
}
function bindLifecycleButtons(){
 document.querySelectorAll('#fco-project-detail [data-life]').forEach(button=>button.addEventListener('click',()=>projectAction(button.dataset.life,button,selected)));
}
function renderTrash(d){
 document.getElementById('fco-project-detail').innerHTML=`<div class="fco-detail-head"><div><p class="fco-eyebrow">PROJECT ${d.id} · TRASH</p><h2>${esc(d.settings.client_name||'Existing project')}</h2></div>${lifecycleButtons(d)}</div><section class="fco-admin-card"><h3>This project is in Trash</h3><p>Its ${(d.data.pages||[]).length} planned pages, ${d.assets.length} files and ${d.submissions.length} submitted versions are kept until you choose Delete permanently. Restore brings the project back without re-enabling its old invitation links or delivery queue.</p><p>Deleting a project here never deletes pages, media or users already sent to the connected website. Server backups are separate.</p></section>`;
 bindLifecycleButtons();
}
async function projectAction(action,button,project){
 if(lifecyclePending||!project)return;
 const id=Number(project.id),name=project.settings.client_name||'project '+id;
 const warnings={archive:`Archive "${name}"?\n\nKeep its content and files, disable client access and cancel queued deliveries. You can reopen it later.`,trash:`Move "${name}" to Trash?\n\nYou can restore it later. Client access will be disabled and queued deliveries cancelled. Nothing on the connected website will be deleted.`,delete:`Permanently delete "${name}" from Inkfire?\n\nThis removes this project's saved content, submissions, uploaded project files and delivery history. It cannot be undone from the dashboard. The connected website and server backups will not be changed.`};
 if(warnings[action]&&!confirm(warnings[action]))return;
 lifecyclePending=true;button.disabled=true;let completed=false;
 try{
  const result=await api(`/projects/${id}/${action}`,'POST',{confirmed:true});completed=true;
  if(action==='trash'||action==='delete'){
   selected=null;C.projectId=0;B.context={};history.replaceState(null,'',C.adminUrl);
   await loadList();
   document.getElementById('fco-project-detail').innerHTML=`<div class="fco-admin-empty"><h2 tabindex="-1">${action==='trash'?'Project moved to Trash':'Project permanently deleted'}</h2><p>${esc(name)}</p><p>${action==='trash'?'Choose Trash in the project filter to restore it or remove it permanently.':'The connected website has not been changed.'}</p>${action==='trash'?'<button type="button" class="button" id="fco-undo-delete">Undo delete</button>':''}</div>`;
   document.getElementById('fco-undo-delete')?.addEventListener('click',e=>projectAction('restore',e.currentTarget,project));
   document.querySelector('#fco-project-detail h2')?.focus();
  }else{
   tab='overview';document.getElementById('fco-status-filter').value=result.status==='archived'?'archived':'';
   await loadList();await select(id);
  }
  B.notice(result.message||'Project updated.');
 }catch(error){B.notice(completed?'The project action completed. Reload the dashboard to see the updated list.':error.message,true);}
 finally{lifecyclePending=false;button.disabled=false;}
}
function requirementsHTML(data){const p=data.project||{},brand=data.branding||{};const labels={goals:'Goals & audience',features:'Features',domain:'Website address',hosting:'Hosting / domain provider',languages:'Languages',timezone:'Location / time zone',products:'Products',payments:'Payments',shipping:'Delivery',tax_invoices:'Tax / invoices',bookables:'Bookable services',availability:'Availability',booking_payments:'Booking payments / cancellation',member_access:'Membership access',member_billing:'Membership billing',specialist_features:'Additional feature notes',integrations:'Connection notes',migration:'Migration',accessibility_privacy:'Accessibility & privacy',launch_date:'Launch date',approvals:'Approvals',aftercare:'Aftercare',skipped_steps:'Skipped sections'};return '<section class="fco-admin-card"><h3>Website requirements</h3>'+(brand.colours_by_inkfire===true?'<div class="fco-requirement-row"><h4>Brand colours</h4><p>Client has asked Inkfire to pick their brand colours. Any retained swatches are references, not their chosen final palette.</p></div>':'')+(brand.colour_palette_url?'<div class="fco-requirement-row"><h4>Colour scheme reference</h4><p style="overflow-wrap:anywhere">'+esc(brand.colour_palette_url)+'</p></div>':'')+Object.entries(labels).filter(([key])=>p[key]&&(!Array.isArray(p[key])||p[key].length)).map(([key,label])=>`<div class="fco-requirement-row"><h4>${esc(label)}</h4><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(Array.isArray(p[key])?p[key].join(', '):p[key])}</p></div>`).join('')+'</section>';}
function provenanceHTML(data){
 const provenance=data?._provenance||{},sections=provenance.sections&&typeof provenance.sections==='object'?provenance.sections:{};
 const labels={staff_prefilled:'Inkfire pre-filled',client_confirmed:'Client confirmed',client_changed:'Client changed',skipped:'Skipped',unanswered:'Unanswered',unknown:'Unknown'};
 const rows=Object.entries(sections).sort(([a],[b])=>a.localeCompare(b)).map(([id,record])=>{
  const state=record?.state||'unknown';
  return `<div class="fco-history-row"><strong>${esc(id.startsWith('pg_content_') ? ('Page content: '+((data.pages||[]).find(p=>p.id===id.slice(11))?.title||'Removed page')) : ({site_name:'Website basics',admin_setup:'Language & location',contact_info:'Contact details',logos:'Brand assets',wp_users:'Website logins',pages:'Sitemap',outro:'Review your answers'}[id]||id.replaceAll('_',' ')))}</strong><span class="fco-badge">${esc(labels[state]||state.replaceAll('_',' '))}</span><small>${record?.updated_at?esc(date(record.updated_at)):''}</small></div>`;
 }).join('');
 const defaults=provenance.defaults?.brand_colors?'<p class="fco-small"><strong>Brand colours:</strong> the stock swatches began as system defaults, not a client-confirmed palette.</p>':'';
 return `<section class="fco-admin-card"><h3>Answer provenance</h3><p>Confirmation is tracked separately from the current value. Existing answers that pre-date this tracking stay unknown until the client confirms, changes or skips their section.</p>${defaults}${rows||'<p>No sections have recorded provenance yet. Existing populated answers must not be treated as client-approved solely because they are present.</p>'}</section>`;
}
async function questions(){
 const d=selected;
 let draft=JSON.parse(JSON.stringify(Array.isArray(d.data?.project?.extra_questions)?d.data.project.extra_questions:[]));
 const answers=(d.data?.project?.extra_question_answers&&typeof d.data.project.extra_question_answers==='object')?d.data.project.extra_question_answers:{};
 const root=document.getElementById('fco-detail-body');
 let library=[];
 try{
  const response=await api('/question-library');
  library=Array.isArray(response?.items)?response.items:[];
 }catch(error){
  B.notice('The reusable question library could not be loaded. Project questions still work normally.',true);
 }
 for(const q of draft){
  if(q.library_id)continue;
  const match=library.find(item=>item.title===q.title&&item.help===q.help&&item.type===q.type&&JSON.stringify(item.options||[])===JSON.stringify(q.options||[]));
  if(match)q.library_id=match.id;
 }
 const uid=()=>{const raw=crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(36).slice(2);return 'q_'+raw.replace(/[^a-z0-9]/gi,'').toLowerCase();};
 const answerText=value=>{
  if(Array.isArray(value))return value.join(', ');
  if(value===null||value===undefined||String(value).trim()==='')return 'No answer yet';
  return String(value);
 };
 const usageText=item=>{
  const usage=Array.isArray(item?.usage)?item.usage:[];
  if(!usage.length)return '<span class="fco-library-unused">Not used yet</span>';
  return usage.map(record=>{
   const when=record.last_used_at?date(record.last_used_at):'Date not recorded';
   return `<span class="fco-library-tag" title="Last used ${esc(when)}">${esc(record.client_name||('Project '+record.project_id))}</span>`;
  }).join('');
 };
 const collect=()=>{
  const cards=[...root.querySelectorAll('[data-extra-question]')];
  return cards.map(card=>{
   const type=card.querySelector('[name="type"]').value;
   const rawOptions=card.querySelector('[name="options"]').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
   const row={
    id:card.dataset.extraQuestion,
    title:card.querySelector('[name="title"]').value.trim(),
    help:card.querySelector('[name="help"]').value.trim(),
    type,
    options:['single','multi'].includes(type)?[...new Set(rawOptions)]:[]
   };
   if(card.dataset.libraryId)row.library_id=card.dataset.libraryId;
   return row;
  });
 };
 const validateQuestion=q=>{
  if(!q.title)throw new Error('Each extra question needs a question title.');
  if(['single','multi'].includes(q.type)&&q.options.length<2)throw new Error('Choice questions need at least two options.');
 };
 const saveOneToLibrary=async(q)=>{
  validateQuestion(q);
  const result=await api('/question-library','POST',{project_id:d.id,question:q});
  if(!result?.item||!result?.library_id)throw new Error('The library did not return a saved question.');
  const existing=library.findIndex(item=>item.id===result.library_id);
  if(existing>=0)library[existing]=result.item;else library.unshift(result.item);
  q.library_id=result.library_id;
  return result.item;
 };
 const draw=()=>{
  const searchPlaceholder=library.length?'Search questions or client tags':'Library is empty';
  root.innerHTML=`<section class="fco-admin-card"><div class="fco-detail-head"><div><h3>Project-specific questions</h3><p>Add extra onboarding slides for this project only. Every question is optional and clients always keep <strong>Skip for now</strong>.</p></div><div class="fco-action-row"><button class="button" type="button" id="fco-open-question-library">Question library</button><button class="button button-primary" type="button" id="fco-add-extra-question">Add question</button></div></div><p class="fco-small">Use these for technical or project-specific details that do not belong in the standard onboarder. Save useful slides to the reusable Inkfire library, then pull them into future projects. Library items record which client projects used them.</p><section class="fco-question-library" id="fco-question-library" hidden aria-labelledby="fco-library-title"><div class="fco-detail-head"><div><h4 id="fco-library-title">Reusable question library</h4><p>Choose a saved slide to copy it into ${esc(d.settings.client_name||'this project')}. It remains optional for the client.</p></div><button class="button" type="button" id="fco-close-question-library">Close library</button></div><label class="fco-library-search">Search library<input id="fco-library-search" type="search" placeholder="${esc(searchPlaceholder)}" autocomplete="off"></label><div id="fco-library-list">${library.length?library.map(item=>`<article class="fco-library-item" data-library-item="${esc(item.id)}" data-library-search="${esc(`${item.title||''} ${item.help||''} ${(item.usage||[]).map(u=>u.client_name||'').join(' ')}`.toLowerCase())}"><div><div class="fco-library-kicker">${esc((item.type||'textarea').replace('textarea','Long answer').replace('text','Short answer').replace('single','Choose one').replace('multi','Choose several'))}</div><h5>${esc(item.title||'Untitled question')}</h5>${item.help?`<p>${esc(item.help)}</p>`:''}<div class="fco-library-tags" aria-label="Clients that used this question">${usageText(item)}</div></div><button class="button button-primary" type="button" data-library-use="${esc(item.id)}">Add to project</button></article>`).join(''):'<div class="fco-admin-empty"><h4>Your reusable library is empty.</h4><p>Use <strong>Save to library</strong> on any project question to start building it.</p></div>'}</div></section><div id="fco-extra-question-list">${draft.length?draft.map((q,i)=>`<fieldset class="fco-extra-question-admin" data-extra-question="${esc(q.id)}" data-library-id="${esc(q.library_id||'')}"><legend>Optional question ${i+1}${q.library_id?' Â· Library':''}</legend><div class="fco-form-grid"><label>Question<input name="title" maxlength="240" value="${esc(q.title||'')}" placeholder="What do you need us to confirm?"></label><label>Answer type<select name="type"><option value="textarea" ${q.type==='textarea'?'selected':''}>Long answer</option><option value="text" ${q.type==='text'?'selected':''}>Short answer</option><option value="single" ${q.type==='single'?'selected':''}>Choose one</option><option value="multi" ${q.type==='multi'?'selected':''}>Choose several</option></select></label><label class="fco-field-wide">Helpful context<textarea name="help" rows="3" maxlength="2000" placeholder="Explain what you need and why. Remind them they can skip if unsure.">${esc(q.help||'')}</textarea></label><label class="fco-field-wide fco-extra-options" ${['single','multi'].includes(q.type)?'':'hidden'}>Choice options <span class="fco-small">(one per line)</span><textarea name="options" rows="4" maxlength="6000">${esc((q.options||[]).join('\n'))}</textarea></label></div><div class="fco-extra-answer"><strong>Current client answer:</strong> ${esc(answerText(answers[q.id]))}</div><div class="fco-action-row"><button class="button" type="button" data-q-library>${q.library_id?'Save this version to library':'Save to library'}</button><button class="button" type="button" data-q-move="-1" ${i===0?'disabled':''}>Move up</button><button class="button" type="button" data-q-move="1" ${i===draft.length-1?'disabled':''}>Move down</button><button class="button fco-button-danger" type="button" data-q-remove>Remove</button></div></fieldset>`).join(''):'<div class="fco-admin-empty"><h4>No extra questions yet.</h4><p>The standard onboarding flow will be used until you add project-specific slides.</p></div>'}</div><div class="fco-action-row"><button class="button button-primary" type="button" id="fco-save-extra-questions">Save questions</button>${draft.length?'<button class="button" type="button" id="fco-save-all-library">Save all to library</button>':''}<span id="fco-extra-question-status" class="fco-small" role="status" aria-live="polite"></span></div></section>`;
  root.querySelectorAll('[name="type"]').forEach(select=>select.addEventListener('change',()=>{select.closest('[data-extra-question]').querySelector('.fco-extra-options').hidden=!['single','multi'].includes(select.value);}));
  const libraryPanel=root.querySelector('#fco-question-library');
  root.querySelector('#fco-open-question-library').addEventListener('click',()=>{libraryPanel.hidden=false;root.querySelector('#fco-library-search')?.focus();});
  root.querySelector('#fco-close-question-library').addEventListener('click',()=>{libraryPanel.hidden=true;root.querySelector('#fco-open-question-library')?.focus();});
  root.querySelector('#fco-library-search')?.addEventListener('input',e=>{
   const needle=e.target.value.trim().toLowerCase();
   root.querySelectorAll('[data-library-item]').forEach(item=>{item.hidden=needle&&!item.dataset.librarySearch.includes(needle);});
  });
  root.querySelectorAll('[data-library-use]').forEach(btn=>btn.addEventListener('click',()=>{
   draft=collect();
   const item=library.find(entry=>entry.id===btn.dataset.libraryUse);
   if(!item)return;
   draft.push({id:uid(),title:item.title||'',help:item.help||'',type:item.type||'textarea',options:Array.isArray(item.options)?[...item.options]:[],library_id:item.id});
   draw();
   B.notice(`Added â${item.title}â from the reusable library. Save questions when you are ready.`);
  }));
  root.querySelector('#fco-add-extra-question').addEventListener('click',()=>{draft=collect();draft.push({id:uid(),title:'',help:'',type:'textarea',options:[]});draw();setTimeout(()=>root.querySelector('[data-extra-question]:last-of-type input[name="title"]')?.focus(),0);});
  root.querySelectorAll('[data-q-library]').forEach(btn=>btn.addEventListener('click',()=>busy(btn,async()=>{
   draft=collect();
   const card=btn.closest('[data-extra-question]');
   const q=draft.find(item=>item.id===card.dataset.extraQuestion);
   if(!q)return;
   const saved=await saveOneToLibrary(q);
   B.notice(`Saved â${saved.title}â to the reusable question library and tagged ${d.settings.client_name||'this client'}.`);
   draw();
  })));
  root.querySelector('#fco-save-all-library')?.addEventListener('click',e=>busy(e.currentTarget,async()=>{
   draft=collect();
   for(const q of draft)validateQuestion(q);
   for(const q of draft)await saveOneToLibrary(q);
   B.notice(`${draft.length} optional question${draft.length===1?'':'s'} saved to the reusable library and tagged ${d.settings.client_name||'this client'}.`);
   draw();
  }));
  root.querySelectorAll('[data-q-move]').forEach(btn=>btn.addEventListener('click',()=>{draft=collect();const card=btn.closest('[data-extra-question]'),i=draft.findIndex(q=>q.id===card.dataset.extraQuestion),to=i+Number(btn.dataset.qMove);if(i<0||to<0||to>=draft.length)return;[draft[i],draft[to]]=[draft[to],draft[i]];draw();}));
  root.querySelectorAll('[data-q-remove]').forEach(btn=>btn.addEventListener('click',()=>{draft=collect();const id=btn.closest('[data-extra-question]').dataset.extraQuestion;const hasAnswer=answers[id]!==undefined&&(Array.isArray(answers[id])?answers[id].length:String(answers[id]??'').trim()!=='');if(hasAnswer&&!confirm('This question already has a client answer. Remove it from the client flow while keeping the saved answer in project history?'))return;draft=draft.filter(q=>q.id!==id);draw();}));
  root.querySelector('#fco-save-extra-questions').addEventListener('click',e=>busy(e.currentTarget,async()=>{
   draft=collect();
   for(const q of draft)validateQuestion(q);
   await api('/projects/'+d.id+'/questions','POST',{revision:selected.revision,questions:draft});
   await refresh();
   B.notice('Optional project questions saved. Library-linked slides were tagged with this client.');
  }));
 };
 draw();
}
function content(){const d=selected,pages=d.data.pages||[];document.getElementById('fco-detail-body').innerHTML=`<section class="fco-admin-card"><h3>Saved website content</h3><p>${pages.length} planned pages. Open the existing content editor to review branding, page structure, copy, team members and requested accounts.</p><div class="fco-action-row"><button class="button button-primary" id="fco-open-editor">Open content editor</button><button class="button" id="fco-export-project">Download content JSON</button><button class="button button-primary" id="fco-open-brief">Developer brief & PDF</button></div><div class="fco-page-summary">${pages.map(p=>`<div><strong>${esc(p.title)}</strong><span>${esc(status(d.data.drafts?.[p.id]?.status||'empty'))}</span></div>`).join('')}</div></section><section class="fco-admin-card"><h3>Submitted versions</h3><p>Each submission preserves the exact saved content at that revision. Later edits do not change these records.</p>${d.submissions.length?d.submissions.map(s=>`<div class="fco-history-row"><span>Revision ${s.revision} · ${esc(date(s.created_at))}</span><button class="button" data-submission="${s.id}">Download submitted version</button></div>`).join(''):'<p>No versions submitted yet.</p>'}</section>`;
 document.getElementById('fco-detail-body').insertAdjacentHTML('beforeend',provenanceHTML(d.data)+requirementsHTML(d.data)+(A.guidedRequirementsHTML?A.guidedRequirementsHTML(d.data):''));
 document.getElementById('fco-open-editor').addEventListener('click',async()=>{document.getElementById('fco-admin-app').hidden=true;document.getElementById('fco-editor-panel').hidden=false;C.projectId=d.id;B.context=d.settings;B.revision=d.revision;await A.init();});
 document.getElementById('fco-open-brief').addEventListener('click',e=>busy(e.currentTarget,async()=>{const brief=await api(`/projects/${d.id}/brief`);if(selected?.id!==d.id||tab!=='content')return;let panel=document.getElementById('fco-developer-brief');if(!panel){panel=document.createElement('section');panel.id='fco-developer-brief';panel.className='fco-admin-card';document.getElementById('fco-detail-body').append(panel);}panel.innerHTML=`<p><a class="button button-primary" href="${esc(brief.pdf_url)}">Download PDF · revision ${brief.revision}</a></p><form id="fco-brief-email-form"><label for="fco-brief-email">Send PDF to a staff member</label><input id="fco-brief-email" type="email" required maxlength="254" autocomplete="off" placeholder="colleague@example.com"><p class="fco-small">Contains private client information. Send only to someone working on this project.</p><button class="button" type="submit">Send PDF</button><p id="fco-brief-email-status" role="status"></p></form>${brief.html}`;
 let mailRequest=crypto.randomUUID();const mailForm=panel.querySelector('#fco-brief-email-form');
 mailForm.addEventListener('input',()=>{mailRequest=crypto.randomUUID();});
 mailForm.addEventListener('submit',event=>{event.preventDefault();const recipient=mailForm.querySelector('input').value.trim();if(!mailForm.reportValidity()||!confirm(`Email the private PDF for ${d.settings.client_name}, revision ${brief.revision}, to ${recipient}?`))return;busy(event.submitter,async()=>{const result=await api(`/projects/${d.id}/brief/email`,'POST',{email:recipient,revision:brief.revision,request_id:mailRequest,confirmed:true});panel.querySelector('#fco-brief-email-status').textContent=result.message;});});
 panel.scrollIntoView({behavior:'smooth'});}));
 document.getElementById('fco-export-project').addEventListener('click',()=>B.downloadJSON(d.data,'onboarding-project-'+d.id+'.json'));
 document.querySelectorAll('[data-submission]').forEach(btn=>btn.addEventListener('click',()=>busy(btn,async()=>{const s=await api(`/projects/${d.id}/submissions/${btn.dataset.submission}`);B.downloadJSON(s,'submitted-revision-'+s.revision+'.json');})));
}
function files(){
 const d=selected;
 const purposeOptions=a=>{
  const common=[['','Not assigned'],['document','Reference document']];
  if(a.type==='image')common.push(['logo','Site logo'],['site_icon','Site icon / favicon'],['brand_image','Brand image'],['page_image','Page image']);
  if(String(a.mime||'').startsWith('font/'))common.push(['font','Website font']);
  return common.map(([value,label])=>`<option value="${value}" ${String(a.purpose||'')===value?'selected':''}>${label}</option>`).join('');
 };
 document.getElementById('fco-detail-body').innerHTML=`<section class="fco-admin-card"><div class="fco-detail-head"><h3>Project file vault</h3><button class="button" id="fco-upload-files">Upload files</button></div><p>Files stay private on Inkfire by default. Uploading a file does <strong>not</strong> approve it for the build. Inkfire staff must tick “Send to build” for each file that may enter the destination Media Library.</p><p class="fco-small">The website purpose is also explicit. In particular, a logo or site icon is never guessed from its filename.</p>${d.assets.length?d.assets.map(a=>`<form class="fco-asset-admin" data-asset="${a.id}">${a.type==='image'?`<img src="${esc(a.url)}" alt="${esc(a.alt)}">`:'<span class="fco-document-icon">FILE</span>'}<div><strong>${esc(a.filename)}</strong>${(d.data.branding?.assets||[]).find(file=>Number(file.id)===Number(a.id))?.client_purpose?`<p class="fco-small">Client suggested use: ${esc((d.data.branding.assets.find(file=>Number(file.id)===Number(a.id)).client_purpose).replaceAll("_"," "))}. Staff approval still required.</p>`:""}<p>${Math.ceil(a.size/1024)} KB · ${esc(a.mime)}</p><a href="${esc(a.url)}" target="_blank" rel="noopener">Open original</a><label>Alt text<input name="alt" value="${esc(a.alt)}"></label><label>Caption<input name="caption" value="${esc(a.caption)}"></label><label>Website purpose<select name="purpose">${purposeOptions(a)}</select></label><label><input type="checkbox" name="send_to_build" ${a.send_to_build?'checked':''}> Send this file to the development build</label><button class="button" type="submit">Save file details</button></div></form>`).join(''):'<p>No files uploaded yet.</p>'}</section>`;
 document.getElementById('fco-upload-files').addEventListener('click',async()=>{await B.chooseFiles({title:'Project files',multiple:true});await refresh();});
 document.querySelectorAll('[data-asset]').forEach(form=>form.addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{
  const fd=new FormData(form);
  await api(`/projects/${d.id}/assets/${form.dataset.asset}`,'POST',{alt:fd.get('alt'),caption:fd.get('caption'),purpose:fd.get('purpose')||'',send_to_build:fd.has('send_to_build')});
  B.notice('File details saved.');
 });}));
}
function jobsHTML(d){
 const normalise=value=>{
  if(value===undefined||value===null||value===''||(Array.isArray(value)&&!value.length))return[];
  if(Array.isArray(value))return value.map(item=>{
   if(item===null||item===undefined)return'';
   if(typeof item==='string'||typeof item==='number')return String(item);
   if(typeof item==='object'){
    if(item.message)return String(item.message);
    if(item.label&&item.status)return item.label+': '+item.status;
    try{return JSON.stringify(item);}catch(error){return String(item);}
   }
   return String(item);
  }).filter(Boolean);
  if(typeof value==='object')return Object.entries(value).map(([key,item])=>{
   let detail='';
   if(Array.isArray(item))detail=item.join(', ');
   else if(item&&typeof item==='object'){try{detail=JSON.stringify(item);}catch(error){detail=String(item);}}
   else if(typeof item==='boolean')detail=item?'Yes':'No';
   else detail=String(item??'');
   return status(key)+(detail?': '+detail:'');
  });
  return[String(value)];
 };
 const group=(label,value)=>{
  const items=normalise(value);
  return items.length?`<div class="fco-delivery-group"><strong>${esc(label)}</strong><ul>${items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div>`:'';
 };
 return d.deliveries.length?d.deliveries.map(j=>{
  const result=j.report.result||{};
  const hasCounts=['pages_created','pages_updated','users_created','terms_created'].some(key=>result[key]!==undefined);
  const counts=hasCounts?`<p>Pages: ${esc(result.pages_created??0)} created, ${esc(result.pages_updated??0)} updated. Users: ${esc(result.users_created??0)}. Categories: ${esc(result.terms_created??0)}.</p>`:'';
  const itemised=result.items||j.report.items||{};
  const preflight=j.report.preflight||{};
  const groups=
   group('Imported',itemised.imported||result.imported||j.report.imported)+
   group('Applied',itemised.applied||result.applied||j.report.applied)+
   group('Preserved',itemised.preserved||result.preserved||j.report.preserved)+
   group('Preflight follow-up',preflight.requires_setup)+
   group('Developer follow-up',itemised.requires_setup||itemised.developer_setup||itemised.developer_required||result.requires_setup||result.developer_setup||result.developer_required||result.requires_developer||j.report.requires_setup||j.report.developer_setup||j.report.developer_required||j.report.requires_developer)+
   group('Conflicts',result.conflicts||j.report.conflicts)+
   group('Errors',result.errors||j.report.errors);
  const partial=!!result.partial;
  return `<div class="fco-job"><div class="fco-history-row"><strong>Revision ${j.revision} · ${esc(status(j.status))}</strong><span>${esc(date(j.created_at))}</span></div>${j.report.last_error?`<p class="fco-error-message">${esc(j.report.last_error)}</p>`:''}${j.report.error?`<p class="fco-error-message">${esc(j.report.error)}</p>`:''}${partial?'<p class="fco-error-message"><strong>Partial receiver outcome.</strong> Inspect the destination and approve a new delivery after the cause is fixed. This delivery ID will not be replayed.</p>':''}${counts}${groups||'<p class="fco-small">No itemised receiver report was returned for this delivery.</p>'}<details><summary>Technical delivery report</summary><pre>${esc(JSON.stringify(j.report,null,2))}</pre></details>${!partial&&['pending','failed','attention'].includes(j.status)?`<button class="button" data-retry="${esc(j.id)}">${j.status==='pending'?'Process next batch':'Retry / check delivery'}</button>`:''}</div>`;
 }).join(''):'<p>No deliveries yet.</p>';
}
function bindRetries(){document.querySelectorAll('[data-retry]').forEach(btn=>btn.addEventListener('click',()=>busy(btn,async()=>{await api(`/projects/${selected.id}/retry`,'POST',{job_id:btn.dataset.retry});await refresh();})));}
function connection(){
 const d=selected,c=d.connection;
 const versionAtLeast=(version,required)=>{
  const a=String(version||'0').split('.').map(part=>parseInt(part,10)||0),b=String(required||'0').split('.').map(part=>parseInt(part,10)||0),length=Math.max(a.length,b.length);
  for(let i=0;i<length;i++){const av=a[i]||0,bv=b[i]||0;if(av>bv)return true;if(av<bv)return false;}
  return true;
 };
 const needsUpgrade=!!c&&!versionAtLeast(c.connector_version,'1.2.3');
 const builder=c?.builder?.label||c?.builder?.type||'WordPress';
 const builderVersion=c?.builder?.version?' '+c.builder.version:'';
 const nativeBranding=c?.builder?.native_branding?' · native branding: '+c.builder.native_branding:'';
 const capabilities=Array.isArray(c?.capabilities)?c.capabilities:[];
 const approvedFiles=(d.assets||[]).filter(a=>a.send_to_build);
 document.getElementById('fco-detail-body').innerHTML=`<section class="fco-admin-card"><h3>Development-site connection</h3><p>Install the receiving plugin on the separate development site, enable development imports in Settings → Onboarding Connector, then paste its pairing code here. Pairing only establishes the secure transport relationship. It does not send project content.</p><p><a class="button" href="${esc(C.connectorUrl)}" download>Download latest connector plugin</a></p>${c?`<div class="fco-connected"><strong>Connected: ${esc(c.site_name)}</strong><code>${esc(c.url)}</code><span>Connector ${esc(c.connector_version)} · ${esc(date(c.connected_at))}</span><span>Builder: ${esc(builder+builderVersion+nativeBranding)}</span>${capabilities.length?`<small>Verified capabilities: ${esc(capabilities.join(', '))}</small>`:''}</div>`:'<p><strong>Not connected.</strong> Content collection works before a development site is ready.</p>'}${needsUpgrade?`<div class="notice notice-warning inline"><p><strong>Connector update required.</strong> This build reports Connector ${esc(c.connector_version||'unknown')}. Install Connector 1.2.3 or later and reconnect before delivery. Version 1.2.3 adds signed preflight before file transfer and the scoped builder-write safeguards required by the audit.</p></div>`:''}<form id="fco-connect-form"><label for="fco-pairing-code">Private pairing code<textarea id="fco-pairing-code" rows="3" autocomplete="off" spellcheck="false" placeholder="Paste from the development site" required></textarea></label><div class="fco-action-row"><button class="button button-primary" type="submit">${c?'Replace / reconnect':'Connect build'}</button>${c?'<button class="button" id="fco-disconnect" type="button">Disconnect</button>':''}</div></form></section><section class="fco-admin-card"><h3>Approve a delivery</h3><p>This sends a fixed saved revision. Nothing below happens merely because the client saved an answer.</p><fieldset class="fco-delivery-scope"><legend><strong>Choose exactly what this delivery may change</strong></legend><label class="fco-check"><input id="fco-send-pages" type="checkbox" ${needsUpgrade?'disabled':''}> Create or update connector-managed <strong>draft pages</strong> (${d.data.pages?.length||0} planned)</label><label class="fco-check"><input id="fco-send-media" type="checkbox" ${needsUpgrade?'disabled':''}> Transfer the <strong>explicitly approved files</strong> (${approvedFiles.length} currently marked “Send to build”)</label><label class="fco-check"><input id="fco-send-terms" type="checkbox" ${needsUpgrade?'disabled':''}> Create requested categories/tags where their taxonomy exists</label></fieldset><label class="fco-check"><input id="fco-apply-branding" type="checkbox" ${needsUpgrade?'disabled':''}> Apply approved website identity & branding: site title, tagline, website language, explicitly assigned logo/site icon, colours/fonts and supported builder-native globals</label><p class="fco-small">Unsupported builder operations are reported as developer follow-up instead of being guessed or overwriting designed work.</p><label class="fco-check"><input id="fco-apply-admin-email" type="checkbox" ${needsUpgrade?'disabled':''}> Set the receiving website’s administration email to the saved website contact email. This does not create a login.</label><p class="fco-small"><strong>Email note:</strong> changing WordPress’s administration email can itself trigger WordPress notification/confirmation mail. That is separate from new-user account emails below.</p><label class="fco-check"><input id="fco-create-users" type="checkbox" ${needsUpgrade?'disabled':''}> Create the requested website users after review (no administrators)</label><label class="fco-check"><input id="fco-account-emails" type="checkbox" disabled> Email those new users their account setup links</label><button class="button button-primary" id="fco-preview-delivery" ${!c||needsUpgrade?'disabled':''}>Review exact delivery & send</button></section><section class="fco-admin-card"><h3>Delivery queue</h3><p class="fco-small">Each delivery runs a signed destination preflight before any new file transfer. The queue retries temporary transport failures; receiver-reported developer follow-up is shown as attention rather than complete.</p><div id="fco-delivery-list">${jobsHTML(d)}</div></section>`;
 document.getElementById('fco-connect-form').addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{const code=document.getElementById('fco-pairing-code').value;if(c&&!confirm('Replace or reconnect the destination? Previously queued jobs will stop rather than move to a different build.'))return;await api(`/projects/${d.id}/connect`,'POST',{pairing_code:code});document.getElementById('fco-pairing-code').value='';B.notice('Development site paired and capabilities refreshed.');await refresh();});});
 document.getElementById('fco-disconnect')?.addEventListener('click',e=>busy(e.currentTarget,async()=>{if(!confirm('Disconnect this build and stop its queued deliveries?'))return;await api(`/projects/${d.id}/disconnect`,'POST',{});await refresh();}));
 document.getElementById('fco-create-users').addEventListener('change',e=>{document.getElementById('fco-account-emails').disabled=!e.target.checked;if(!e.target.checked)document.getElementById('fco-account-emails').checked=false;});
 document.getElementById('fco-preview-delivery').addEventListener('click',e=>busy(e.currentTarget,async()=>{
  const preview=await api(`/projects/${d.id}/preview`,'POST',{});
  const opts={
   pages:document.getElementById('fco-send-pages').checked,
   media:document.getElementById('fco-send-media').checked,
   terms:document.getElementById('fco-send-terms').checked,
   users:document.getElementById('fco-create-users').checked,
   branding:document.getElementById('fco-apply-branding').checked,
   admin_email:document.getElementById('fco-apply-admin-email').checked,
   account_emails:document.getElementById('fco-account-emails').checked
  };
  const branding=opts.branding?`YES\n  Site title: ${preview.site_title||'Not supplied'}\n  Tagline: ${preview.tagline||'Not supplied'}\n  Website language: ${preview.language||'Not supplied'}\n  Brand colours: ${preview.brand_colours??0}; brand fonts: ${preview.brand_fonts??0}\n  Builder: ${preview.connection?.builder?.label||preview.connection?.builder?.type||'WordPress'}`:'No changes';
  const fileLines=opts.media&&preview.selected_files?.length?'\nApproved files:\n'+preview.selected_files.map(f=>`  • ${f.filename}${f.purpose?' ['+f.purpose.replaceAll('_',' ')+']':''}`).join('\n'):'';
  const text=`Send revision ${preview.revision} to ${preview.connection.url}?\n\nDraft pages: ${opts.pages?'YES ('+preview.pages+')':'No'}\nApproved file transfer: ${opts.media?'YES ('+preview.files+')':'No'}${fileLines}\nCategories/tags: ${opts.terms?'YES':'No'}\nCreate requested users: ${opts.users?'YES ('+preview.users+')':'No'}\nSend new-user account emails: ${opts.account_emails?'YES':'No'}\nApply site setup & branding: ${branding}\nWebsite admin email: ${opts.admin_email?(preview.admin_email||'MISSING: save a website contact email first'):'No change'}${opts.admin_email?'\n  Note: WordPress may send its own administration-email notification/confirmation message.':''}\n\n${preview.message}\n\nThis is your approval of this exact saved revision and scope.`;
  if(!confirm(text))return;
  await api(`/projects/${d.id}/send`,'POST',{...opts,revision:preview.revision,approved:true});
  B.notice('Approved revision queued. Destination preflight runs before any new file transfer.');await refresh();
 }));
 bindRetries();
}
function activity(){document.getElementById('fco-detail-body').innerHTML=`<section class="fco-admin-card"><h3>Project activity</h3><p>Personalised invitation links label the intended collaborator for presence and activity context, but this is not a verified login identity.</p>${selected.events.length?selected.events.map(e=>`<div class="fco-event"><strong>${esc(e.event)}</strong><span>${esc(e.detail)}</span><small>${esc(date(e.at))} · ${esc(e.actor)}</small></div>`).join(''):'<p>No activity recorded yet.</p>'}</section>`;}
function createDialog(){
 const dialog=document.createElement('dialog');dialog.className='fco-file-dialog fco-create-dialog';dialog.setAttribute('aria-labelledby','fco-create-heading');
 dialog.innerHTML=`<form id="fco-new-project" class="fco-admin-form">
 <h2 id="fco-create-heading">A new client workspace</h2>
 <label>Client / company name<input name="client_name" maxlength="200" required autofocus></label>
 <label>Contact name<input name="contact_name" maxlength="200"></label>
 <label>Primary contact email<input type="email" name="email" maxlength="254" autocomplete="email" placeholder="client@example.com"></label>
 <div class="fco-collaborator-editor"><div class="fco-collaborator-head"><h3>Additional teammates <span class="fco-small">(optional)</span></h3><button class="button" type="button" id="fco-create-add-collaborator">Add teammate</button></div><div id="fco-create-collaborators"></div><p class="fco-small">Each teammate receives their own personalised link into the same shared workspace.</p></div>
 <label>Personal welcome<textarea name="welcome" rows="3" maxlength="5000"></textarea></label>
 <fieldset class="fco-invite-choice"><legend>Client invitation</legend>
 <label class="fco-invite-option"><input type="radio" name="send_invitation" value="later" checked><span><strong>Set up without inviting</strong><small>Keep it private. Send an invitation later from the project settings.</small></span></label>
 <label class="fco-invite-option"><input type="radio" name="send_invitation" value="now"><span><strong>Send invitations now</strong><small>Email every named collaborator their personalised workspace link as soon as this project is created.</small></span></label>
 <p id="fco-create-invite-preview" class="fco-small" aria-live="polite">No email will be sent.</p>
 </fieldset>
 <details class="fco-create-connection"><summary>Connect a development site <span>(optional)</span></summary>
 <p>Paste the connector’s pairing code now, or connect the build later. Invitations work independently of this connection.</p>
 <label for="fco-create-pairing">Private pairing code</label><textarea id="fco-create-pairing" name="pairing_code" rows="3" maxlength="2000" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" placeholder="Paste from Settings → Onboarding Connector on the development site"></textarea>
 <p class="fco-small">Pairing checks the connection only. It does not send content, create website users or change the build.</p><a href="${esc(C.connectorUrl)}" download>Download the connector plugin</a>
 </details>
 <p id="fco-create-status" role="status" aria-live="polite" tabindex="-1" hidden></p>
 <div class="fco-action-row"><button class="button button-primary" type="submit">Create project</button><button class="button" id="fco-cancel-create" type="button">Cancel</button></div>
 </form>`;
 document.body.appendChild(dialog);
 const form=dialog.querySelector('form'),button=form.querySelector('[type=submit]'),cancel=dialog.querySelector('#fco-cancel-create'),pairing=dialog.querySelector('#fco-create-pairing'),notice=dialog.querySelector('#fco-create-status'),teamNode=dialog.querySelector('#fco-create-collaborators');
 let createTeam=[];
 const memberId=()=>`member_${(crypto.randomUUID?crypto.randomUUID().replaceAll('-',''):String(Date.now())+Math.random().toString(16).slice(2)).slice(0,16)}`;
 const renderCreateTeam=()=>{teamNode.innerHTML=createTeam.map((person,i)=>`<div class="fco-collaborator-row" data-create-index="${i}"><label>Name<input type="text" data-create-collab="name" value="${esc(person.name)}" maxlength="200" required autocomplete="name"></label><label>Email<input type="email" data-create-collab="email" value="${esc(person.email)}" maxlength="254" required autocomplete="email"></label><button type="button" class="button fco-button-danger" data-create-remove="${i}">Remove</button></div>`).join('');};
 dialog.querySelector('#fco-create-add-collaborator').addEventListener('click',()=>{createTeam.push({id:memberId(),name:'',email:''});renderCreateTeam();teamNode.querySelector('[data-create-index]:last-child input')?.focus();label();});
 teamNode.addEventListener('input',e=>{const row=e.target.closest('[data-create-index]');if(!row||!e.target.dataset.createCollab)return;createTeam[Number(row.dataset.createIndex)][e.target.dataset.createCollab]=e.target.value;label();});
 teamNode.addEventListener('click',e=>{const b=e.target.closest('[data-create-remove]');if(!b)return;createTeam.splice(Number(b.dataset.createRemove),1);renderCreateTeam();label();});
 const requestId=crypto.randomUUID?crypto.randomUUID():'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(c)/4).toString(16));
 let pending=false;
 const recipients=()=>[form.elements.email.value.trim(),...createTeam.map(p=>p.email.trim())].filter(Boolean);
 const label=()=>{const invite=form.elements.send_invitation.value==='now',list=recipients();form.elements.email.required=invite;form.elements.contact_name.required=invite;if(!pending)button.textContent=invite?'Create & invite team':pairing.value.trim()?'Create & connect':'Create project';dialog.querySelector('#fco-create-invite-preview').textContent=invite?(list.length?`${list.length} ${list.length===1?'person':'people'} will be invited: ${list.join(', ')}.`:'Enter the primary contact name and email above to invite the team now.'):'No email will be sent. You can invite the team later.';};
 const close=()=>{if(pending)return;pairing.value='';dialog.close();dialog.remove();document.getElementById('fco-create')?.focus();};
 form.addEventListener('input',label);form.addEventListener('change',label);cancel.addEventListener('click',close);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(pending||!form.reportValidity())return;
  const payload=Object.fromEntries(new FormData(form));payload.pairing_code=payload.pairing_code.trim();payload.send_invitation=payload.send_invitation==='now';payload.request_id=requestId;
  payload.collaborators=[];if(payload.email.trim())payload.collaborators.push({id:'',name:payload.contact_name.trim()||payload.client_name.trim(),email:payload.email.trim()});createTeam.forEach(person=>payload.collaborators.push({id:person.id,name:person.name.trim(),email:person.email.trim()}));
  pending=true;button.disabled=true;cancel.disabled=true;pairing.readOnly=true;notice.hidden=false;notice.className='';
  notice.textContent=payload.send_invitation?'Creating the workspace and sending the team invitations…':payload.pairing_code?'Creating the workspace and checking the connection…':'Creating the workspace…';button.textContent='Creating…';
  let created=null;
  try{created=await api('/projects','POST',payload);}catch(error){notice.textContent=(error.message||'Could not confirm creation.')+' Retry in this form; the same request will not create or invite a duplicate project.';notice.className='fco-create-error';notice.focus();}
  finally{payload.pairing_code='';pending=false;button.disabled=false;cancel.disabled=false;pairing.readOnly=false;label();}
  if(!created)return;
  const connectionFailed=created.creation_connection?.status==='failed',invitation=created.creation_invitation||{status:'not_requested'};
  close();tab='overview';document.getElementById('fco-status-filter').value='';
  try{await loadList();await select(created.id);}catch(error){B.notice('Project '+created.id+' was created. Reload the dashboard to open it; do not create it again.',true);return;}
  const message=invitation.status==='accepted'?'Team invitations accepted by the email service.':invitation.status==='failed'?'The project is saved, but its invitations need attention. '+invitation.message:invitation.status==='check'?invitation.message:'No invitation was sent.';
  if(connectionFailed){const warning=document.createElement('div');warning.className='fco-pairing-warning';warning.setAttribute('role','alert');warning.textContent='Project saved. The development site could not be connected: '+created.creation_connection.message+' Retry from the Connection tab. '+message;document.getElementById('fco-detail-body')?.prepend(warning);}
  B.notice((created.creation_reused?'Existing project opened. ':'Project created. ')+message+(created.connection?' Development site connected.':''),connectionFailed||['failed','check'].includes(invitation.status));
 });
 label();dialog.showModal();
}

$(async function(){shell();document.getElementById('fco-close-editor').addEventListener('click',async()=>{if(B.dirty&&!(await A.saveData()))return;A.destroyWpEditor();document.getElementById('fco-editor-panel').hidden=true;document.getElementById('fco-admin-app').hidden=false;await refresh();});try{await loadList();const id=Number(new URLSearchParams(location.search).get('project'));if(id)await select(id);}catch(e){B.notice(e.message,true);}
 setInterval(async()=>{if(tab!=='connection'||!selected||document.hidden)return;try{const d=await api('/projects/'+selected.id);if(selected?.id===d.id){selected.deliveries=d.deliveries;const node=document.getElementById('fco-delivery-list');if(node){node.innerHTML=jobsHTML(d);bindRetries();}}}catch(e){}},15000);
});
})(jQuery);
