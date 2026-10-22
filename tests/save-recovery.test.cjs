const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {IDBFactory}=require('fake-indexeddb');
const root=path.resolve(__dirname,'..');
const recovery=fs.readFileSync(path.join(root,'assets/v3/save-recovery.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'assets/v3/bridge.js'),'utf8');
const save=bridge.slice(bridge.indexOf('A.saveData=function(){'),bridge.indexOf('A.debouncedSave=function(){'));
const debounce=bridge.slice(bridge.indexOf('A.debouncedSave=function(){'),bridge.indexOf('B.downloadJSON=function('));
const data=()=>({project:{extra_question_answers:[],pending_inputs:[]},pages:[],drafts:[],comments:[]});
function app(indexedDB=new IDBFactory()){
 const C={projectId:9981,previewOnly:false,isAdmin:false};
 const A={data:data()};
 const states=[];
 const B={revision:1,conflict:false,state:v=>states.push(v),notice:()=>{},recovery:()=>{},clearRecovery:()=>{}};
 const context={window:{FCO_Config:C,FCO_App:A,indexedDB},crypto:webcrypto,indexedDB,console,Date,JSON,setTimeout,clearTimeout,structuredClone};
 vm.createContext(context);vm.runInContext(recovery,context);
 const R=context.window.FCO_SaveRecovery;
 Object.assign(context,{A,B,C,R});vm.runInContext(save+debounce,context);
 return {A,B,C,R,states,indexedDB};
}
const answers={text:'Quotes " and \\slashes',long:'Two lines\nCafé 日本語',single:'Phase 1',multi:['Dealer','Assessment']};
test('actual save pipeline preserves empty PHP answer maps, every answer type and reloads',async()=>{
 const {A,B,R}=app();Object.assign(A.data.project.extra_question_answers,answers);
 let stored;
 B.request=async(path,method,payload)=>{stored=JSON.parse(JSON.stringify(payload.data));return {revision:2,recovery_recorded:true};};
 assert.equal(await A.saveData(),true);
 assert.deepEqual(stored.project.extra_question_answers,answers);
 assert.equal(Array.isArray(stored.project.extra_question_answers),false);
 assert.equal(B.revision,2);
 const reload=app();reload.A.data=stored;reload.B.request=async(p,m,v)=>{stored=JSON.parse(JSON.stringify(v.data));return {revision:3,recovery_recorded:true};};
 assert.equal(await reload.A.saveData(),true);assert.deepEqual(stored.project.extra_question_answers,answers);
 const journal=await R.list(9981);assert.equal(journal[0].status,'saved');
});
test('normalizing a checkpoint preserves objects held by live input handlers',async()=>{
 const {A,B,R}=app();R.normalize(A.data);const project=A.data.project,answers=project.extra_question_answers;
 let stored;B.request=async(p,m,v)=>{stored=JSON.parse(JSON.stringify(v.data));return {revision:B.revision+1,recovery_recorded:true};};
 answers.multi=['Dealer'];assert.equal(await A.saveData(),true);
 assert.equal(A.data.project,project);assert.equal(A.data.project.extra_question_answers,answers);
 answers.multi=['Dealer','Assessment'];assert.equal(await A.saveData(),true);
 assert.deepEqual(stored.project.extra_question_answers.multi,['Dealer','Assessment']);
});
test('conflict preserves rejected text in durable browser storage after a new page loads',async()=>{
 const {A,B,R,indexedDB}=app();A.data.project.extra_question_answers.conflict='Do not discard rejected answer';
 B.request=async()=>{throw Object.assign(new Error('Conflict'),{code:'fco_conflict',requestId:'FCO-SAVE-123456789ABC'});};
 assert.equal(await A.saveData(),false);assert.equal(B.conflict,true);
 const next=app(indexedDB),copies=await next.R.list(9981);
 assert.equal(copies[0].status,'failed');assert.equal(copies[0].data.project.extra_question_answers.conflict,'Do not discard rejected answer');
 assert.equal(copies[0].request_id,'FCO-SAVE-123456789ABC');
});
test('network and expired-session failures keep entered answers; storage failure does not misreport server save',async()=>{
 for(const code of ['network_error','fco_session_stale']){
  const {A,B,R}=app();A.data.project.extra_question_answers.offline='Offline typed answer';
  B.request=async()=>{throw Object.assign(new Error('Failed'),{code});};
  assert.equal(await A.saveData(),false);
  assert.equal((await R.list(9981))[0].data.project.extra_question_answers.offline,'Offline typed answer');
 }
 const {A,B,R}=app();R.checkpoint=async()=>false;R.confirm=async()=>false;
 B.request=async()=>({revision:2,recovery_recorded:true});assert.equal(await A.saveData(),true);
});
test('typing while a request is in flight saves the newer answer in a second request',async()=>{
 const {A,B}=app();A.data.project.extra_question_answers.text='Before request';
 let release,first=true;const sent=[];
 B.request=async(p,m,v)=>{sent.push(v.data.project.extra_question_answers.text);if(first){first=false;await new Promise(r=>release=r);}return {revision:sent.length+1,recovery_recorded:true};};
 const saving=A.saveData();while(!release)await new Promise(r=>setImmediate(r));
 A.data.project.extra_question_answers.text='Typed during request';release();
 assert.equal(await saving,true);assert.deepEqual(sent,['Before request','Typed during request']);
});
test('confirming an older request never replaces a newer unsaved browser checkpoint',async()=>{
 const {R}=app();const first=data();first.project.extra_question_answers={x:'Old'};
 await R.checkpoint(first,{request_id:'old'});
 const latest=data();latest.project.extra_question_answers={x:'New'};
 await R.checkpoint(latest,{request_id:'new'});await R.confirm(first,'old','FCO-SAVE-123456789ABC');
 const row=(await R.list(9981))[0];assert.equal(row.status,'pending');assert.equal(row.data.project.extra_question_answers.x,'New');
});
test('blocked autosave still checkpoints input and recovery records stay project-scoped',async()=>{
 const {A,B,C,R}=app();B.conflict=true;A.data.project.extra_question_answers.blocked='Typed after conflict';A.debouncedSave();
 assert.equal((await R.list(9981))[0].data.project.extra_question_answers.blocked,'Typed after conflict');
 assert.deepEqual(await R.list(123),[]);C.projectId=123;await R.checkpoint(data());assert.equal((await R.list(9981)).length,1);
});
