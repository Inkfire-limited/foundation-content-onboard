/* Project-scoped editor controls. No WordPress post search or guest admin AJAX. */
(function ($) {
'use strict';
const A=window.FCO_App,B=window.FCO_HubBridge,C=window.FCO_Config;
if(!A||!B||!C)return;
const esc=B.escape;
let nextId=0;
function safeLink(value){
 const raw=String(value||'').trim();
 if(!raw||/[\u0000-\u0020\u007f\\]/.test(raw))return '';
 if(raw.startsWith('#'))return raw;
 if(raw.startsWith('/')&&!raw.startsWith('//'))return raw;
 const candidate=/^www\./i.test(raw)?'https://'+raw:raw;
 try{const u=new URL(candidate);if(!['https:','http:','mailto:','tel:'].includes(u.protocol))return '';if(['https:','http:'].includes(u.protocol)&&(!u.hostname||u.username||u.password))return '';if(['mailto:','tel:'].includes(u.protocol)&&!u.pathname)return '';return candidate;}catch(e){return '';}
}
function openLink(id,onChange){
 const el=document.getElementById(id);if(!el||document.querySelector('.fco-link-dialog[open]'))return;
 const opener=document.activeElement;
 const ed=window.tinymce?.get(id);
 const visual=!!ed&&!ed.isHidden();
 const anchor=visual?ed.dom.getParent(ed.selection.getNode(),'a[href]'):null;
 const bookmark=visual?ed.selection.getBookmark(2,true):null;
 const start=el.selectionStart||0,end=el.selectionEnd||start;
 const selected=visual?ed.selection.getContent({format:'text'}):el.value.slice(start,end);
 const dialog=document.createElement('dialog');dialog.className='fco-link-dialog';
 dialog.setAttribute('aria-labelledby','fco-link-heading');
 dialog.innerHTML=`<form class="fco-link-form"><div class="fco-link-head"><h2 id="fco-link-heading">${anchor?'Edit link':'Add a link'}</h2><button type="button" data-link-close aria-label="Close link editor">×</button></div><p id="fco-link-help">Paste a website address, email link or phone link. This does not search Inkfire’s website.</p><label for="fco-link-address">Link address</label><input id="fco-link-address" type="text" required maxlength="2048" autocomplete="off" spellcheck="false" placeholder="https://example.com" aria-describedby="fco-link-help fco-link-error"><label for="fco-link-label">Link text</label><input id="fco-link-label" type="text" required maxlength="2000" aria-describedby="fco-link-text-help"><p id="fco-link-text-help">Describe the destination, for example “View our opening times”, rather than “click here”.</p><label class="fco-link-check"><input id="fco-link-newtab" type="checkbox"> Open in a new tab</label><p id="fco-link-error" role="alert"></p><div class="fco-link-actions"><button type="submit">${anchor?'Save link':'Insert link'}</button>${anchor?'<button type="button" data-link-remove>Remove link</button>':''}<button type="button" data-link-close>Cancel</button></div></form>`;
 const url=dialog.querySelector('#fco-link-address'),label=dialog.querySelector('#fco-link-label'),newtab=dialog.querySelector('#fco-link-newtab'),error=dialog.querySelector('#fco-link-error');
 url.value=anchor?ed.dom.getAttrib(anchor,'href'):'';label.value=anchor?anchor.textContent:selected;newtab.checked=!!anchor&&ed.dom.getAttrib(anchor,'target')==='_blank';
 document.body.appendChild(dialog);
 let closed=false;
 const close=(returnToEditor=false)=>{if(closed)return;closed=true;dialog.close();dialog.remove();if(returnToEditor&&document.getElementById(id)===el){if(visual){ed.focus();}else el.focus();}else if(opener?.isConnected){opener.focus();}else if(el.isConnected){el.focus();}};
 const edit=fn=>{if(document.getElementById(id)!==el){error.textContent='This editor has changed. Close this window and reopen the link editor.';return false;}if(visual){ed.focus();ed.selection.moveToBookmark(bookmark);ed.undoManager.transact(fn);ed.nodeChanged();onChange(ed.getContent());}else{fn();onChange(el.value);}return true;};
 dialog.querySelector('form').addEventListener('submit',event=>{
  event.preventDefault();const href=safeLink(url.value),text=label.value.trim();
  url.removeAttribute('aria-invalid');label.removeAttribute('aria-invalid');
  if(!href){error.textContent='Use an https:// or http:// website address, a mailto: email link, a tel: phone link or a page anchor. Script and file links are not allowed.';url.setAttribute('aria-invalid','true');url.focus();return;}
  if(!text){error.textContent='Add some meaningful link text.';label.setAttribute('aria-invalid','true');label.focus();return;}
  const attrs={href,target:newtab.checked?'_blank':null,rel:newtab.checked?'noopener noreferrer':null};
  const html='<a href="'+esc(href)+'"'+(newtab.checked?' target="_blank" rel="noopener noreferrer"':'')+'>'+esc(text)+'</a>';
  if(edit(()=>{if(visual){if(anchor){ed.dom.setAttribs(anchor,attrs);if(anchor.textContent!==text)ed.dom.setHTML(anchor,esc(text));}else if(selected&&text===selected){ed.execCommand('mceInsertLink',false,attrs);}else ed.insertContent(html);}else{el.setRangeText(html,start,end,'end');}}))close(true);
 });
 dialog.querySelector('[data-link-remove]')?.addEventListener('click',()=>{if(edit(()=>ed.dom.remove(anchor,true)))close(true);});
 dialog.querySelectorAll('[data-link-close]').forEach(button=>button.addEventListener('click',()=>close()));
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('close',()=>close());
 dialog.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const fields=Array.from(dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')).filter(node=>!node.disabled&&node.tabIndex>=0&&node.getClientRects().length);
  const first=fields[0],last=fields[fields.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 });
 dialog.showModal();url.focus();
}
// TinyMCE 4 wraps a native button in another role=button. Make the native
// control the sole semantic/focus target, including the model's later state updates.
// This is per-editor, never a patch to WordPress/TinyMCE globally.
function repairToolbar(ed){
 const panel=ed.theme?.panel;
 if(!panel?.find)return;
 const icons={bold:'Bold',italic:'Italic',bullist:'Bulleted list',numlist:'Numbered list',blockquote:'Block quote',link:'Add or edit link',unlink:'Remove link',removeformat:'Clear formatting',undo:'Undo',redo:'Redo'};
 panel.find('*').each(control=>{
  const wrap=control.getEl?.();
  if(!wrap?.matches('.mce-btn')||control._fcoNativeButton)return;
  const buttons=Array.from(wrap.children).filter(child=>child.tagName==='BUTTON');
  if(buttons.length!==1)return;
  const button=buttons[0],suffix=button.id.startsWith(wrap.id+'-')?button.id.slice(wrap.id.length+1):'';
  if(!suffix)return;
  const originalAria=Object.assign({},control._aria||{});
  const label=wrap.getAttribute('aria-label')||originalAria.label||control.settings?.tooltip||icons[control.settings?.icon]||button.textContent.trim()||'Editor action';
  control._fcoNativeButton=true;
  control.ariaTarget=suffix;
  control.focus=function(){if(!button.disabled)button.focus();return this;};
  const set=(name,value)=>{if(value===null){if(button.hasAttribute(name))button.removeAttribute(name);}else if(button.getAttribute(name)!==String(value))button.setAttribute(name,String(value));};
  const sync=()=>{
   // The listbox opens TinyMCE's existing format menu; it is a menu button,
   // not a nested combobox. Names and pressed/disabled/expanded states belong here.
   const format=wrap.classList.contains('mce-listbox');
   const text=button.querySelector('.mce-txt')?.textContent?.trim();
   const name=format?'Text format'+(text?': '+text:''):label;
   control.aria('role','button');control.aria('label',name);
   delete control._aria.labelledby;set('aria-labelledby',null);
   const icon=control.settings?.icon||button.querySelector('.mce-ico')?.className.match(/mce-i-([a-z]+)/)?.[1]||'';
   set('aria-pressed',['bold','italic','bullist','numlist','blockquote'].includes(icon)?String(!!control.active()):null);
   set('aria-disabled',String(!!control.disabled()));button.disabled=!!control.disabled();
   if(originalAria.haspopup!==undefined||format||wrap.classList.contains('mce-menubtn'))set('aria-haspopup','menu');
   button.querySelectorAll('i').forEach(icon=>icon.setAttribute('aria-hidden','true'));
   Array.from(wrap.attributes).forEach(attr=>{if(attr.name==='role'||attr.name==='tabindex'||attr.name.startsWith('aria-')||attr.name==='data-mce-tabstop')wrap.removeAttribute(attr.name);});
   set('data-fco-toolbar-control',wrap.id);
  };
  Object.entries(originalAria).forEach(([key,value])=>{if(!['role','label','labelledby'].includes(key))control.aria(key,value);});
  control.state?.on('change:active change:disabled change:text',sync);
  sync();
 });
 const toolbar=ed.getContainer()?.querySelector('.mce-toolbar');
 if(toolbar&&!toolbar.dataset.fcoNativeToolbar){
  toolbar.dataset.fcoNativeToolbar='true';toolbar.setAttribute('aria-label','Text formatting');
  const buttons=()=>Array.from(toolbar.querySelectorAll('button[data-fco-toolbar-control]')).filter(button=>!button.disabled);
  const first=buttons()[0];if(first)first.tabIndex=0;
  toolbar.addEventListener('focusin',event=>{if(!event.target.matches('button[data-fco-toolbar-control]'))return;buttons().forEach(button=>{button.tabIndex=button===event.target?0:-1;});});
 }
}
A.initWpEditor=function(id,conf){
 A.wpEditorId=id;const el=document.getElementById(id);if(!el)return;
 el.setAttribute('aria-label','Page content in HTML');
 const action=document.createElement('button');action.type='button';action.className='fco-btn ghost small fco-rich-link-action';action.textContent='Add / edit link';action.addEventListener('click',()=>openLink(id,conf.onChange));el.before(action);
 $(el).off('input.fcoWp keydown.fcoLink').on('input.fcoWp',()=>conf.onChange(el.value)).on('keydown.fcoLink',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openLink(id,conf.onChange);}});
 if(!window.wp?.editor?.initialize)return;
 try{wp.editor.remove(id);}catch(e){}
 wp.editor.initialize(id,{
  tinymce:{wpautop:true,menubar:false,toolbar1:'formatselect,bold,italic,bullist,numlist,blockquote,fco_link,fco_unlink,removeformat,undo,redo',plugins:'lists,paste,wordpress',setup:ed=>{
   ed.addButton('fco_link',{icon:'link',tooltip:'Add or edit link',onclick:()=>openLink(id,conf.onChange)});
   ed.addButton('fco_unlink',{icon:'unlink',tooltip:'Remove link',onclick:()=>{ed.execCommand('unlink');conf.onChange(ed.getContent());}});
   ed.addShortcut('Meta+K','Add or edit link',()=>openLink(id,conf.onChange));
   ed.on('Change KeyUp SetContent',()=>conf.onChange(ed.getContent()));
   ed.on('PostRender init',()=>repairToolbar(ed));
   ed.on('init',()=>{const frame=document.getElementById(id+'_ifr');if(frame)frame.title='Page content editor';});
  }},quicktags:C.isAdmin?{buttons:'strong,em,ul,ol,li,code,close'}:false,mediaButtons:false
 });
};
// Move a whole page branch amongst its siblings, retaining parent relationships.
A.reorderBranch=function(list,id,direction,levelOf){
 const i=list.findIndex(p=>String(p.id)===String(id));if(i<0)return list;
 const level=levelOf(list[i]);let end=i+1;while(end<list.length&&levelOf(list[end])>level)end++;
 if(direction<0){let prev=i-1;while(prev>=0&&levelOf(list[prev])>level)prev--;if(prev<0||levelOf(list[prev])!==level)return list;return [...list.slice(0,prev),...list.slice(i,end),...list.slice(prev,i),...list.slice(end)];}
 const next=end;if(next>=list.length||levelOf(list[next])!==level)return list;let nextEnd=next+1;while(nextEnd<list.length&&levelOf(list[nextEnd])>level)nextEnd++;return [...list.slice(0,i),...list.slice(next,nextEnd),...list.slice(i,end),...list.slice(nextEnd)];
};
function enhance(root){
 if(!root)return;
 root.querySelectorAll('.fco-field-group').forEach(group=>{const label=group.querySelector('label'),field=group.querySelector('input,textarea,select');if(label&&field&&!label.contains(field)&&!label.htmlFor){if(!field.id)field.id='fco-labelled-'+(++nextId);label.htmlFor=field.id;}});
 root.querySelectorAll('input:not([type=hidden]),textarea,select').forEach(field=>{if(field.labels?.length||field.hasAttribute('aria-label')||field.hasAttribute('aria-labelledby'))return;const name=field.id==='header-status'?'Page content status':field.id==='new-comment-text'?'New discussion comment':field.id==='dash-feat-img-url'?'Main project image address':field.placeholder;if(name)field.setAttribute('aria-label',name);});
 root.querySelectorAll('.fco-media-item img:not([alt])').forEach(img=>img.alt='Selected page image');
 root.querySelectorAll('.fco-summary-section img:not([alt])').forEach(img=>img.alt='Brand logo');
 root.querySelectorAll('button.fco-media-x:not([aria-label]),button.staff-del:not([aria-label]),button.del-soc:not([aria-label]),button.fco-chip-x:not([aria-label])').forEach(button=>{const row=button.closest('.fco-chip,.fco-typo-row,.fco-media-item');const item=row?.querySelector('input')?.value||row?.querySelector('img')?.alt||row?.textContent?.replace('×','').trim()||'item';button.setAttribute('aria-label','Remove '+item.slice(0,80));button.type='button';});
 root.querySelectorAll('[data-act=indent],[data-act=outdent],[data-act=delete]').forEach(button=>{if(button.hasAttribute('aria-label'))return;const row=button.closest('.fco-node,.fco-pageitem');const title=row?.querySelector('.fco-node-title,.fco-title')?.textContent||'page';button.setAttribute('aria-label',({indent:'Nest ',outdent:'Unnest ',delete:'Remove '})[button.dataset.act]+title);});
 root.querySelectorAll('#wiz-pages .fco-title').forEach((field,i)=>{if(!field.hasAttribute('aria-label'))field.setAttribute('aria-label','Page '+(i+1)+' title');});
 root.querySelectorAll('.fco-wiz-choice').forEach(button=>{const pressed=String(button.classList.contains('active'));if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);});
 const menu=root.querySelector('#fco-menu-toggle'),panel=root.querySelector('#fco-main-menu');
 if(menu&&panel){menu.setAttribute('aria-controls','fco-main-menu');const open=panel.classList.contains('show');menu.setAttribute('aria-expanded',String(open));if(panel.hidden===open)panel.hidden=!open;}
 root.querySelectorAll('.fco-tab-btn').forEach(button=>{if(button.classList.contains('active'))button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
 root.querySelector('.fco-tab-nav')?.setAttribute('aria-label','Content dashboard sections');
 const toggle=root.querySelector('#comments-toggle'),body=root.querySelector('#comments-body');if(toggle&&body){toggle.setAttribute('aria-controls','comments-body');toggle.setAttribute('aria-expanded',String(body.classList.contains('open')));}
}
let pending=false;
$(function(){
 const root=document.getElementById('fco-client-app');if(!root)return;
 new MutationObserver(()=>{if(pending)return;pending=true;queueMicrotask(()=>{pending=false;enhance(root);});}).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});enhance(root);
 root.addEventListener('keydown',event=>{if(event.key==='Escape'){const panel=root.querySelector('#fco-main-menu');if(panel?.classList.contains('show')){panel.classList.remove('show');root.querySelector('#fco-menu-toggle')?.focus();event.preventDefault();}}});
});
window.FCO_Editor_Accessibility={safeLink,openLink,enhance,repairToolbar};
})(jQuery);
