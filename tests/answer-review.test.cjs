const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync(require('node:path').join(__dirname,'../assets/v3/review-fixes.js'),'utf8');
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(data,steps,config={}){
 let html='',writes=0;const handlers={};
 const chain={html(v){html=v;return this;},off(){return this;},on(event,selector,fn){handlers[selector]=fn;return this;}};
 const jquery=()=>chain;
 const A={data,renderAssetManager(){},renderEditor(){},switchMode(){},saveData(){writes++;},debouncedSave(){writes++;}};
 const B={escape,state(){}};
 const context={window:{FCO_App:A,FCO_HubBridge:B,FCO_Config:{previewOnly:true,...config},location:new URL('https://inkfire.co.uk/onboarding/?fco_preview=42')},jQuery:jquery,URL,document:{addEventListener(){}},Map};
 vm.runInNewContext(code,context);let destination;
 A.renderAnswerReview(chain,steps,id=>destination=id);
 return {html,writes,view(id){handlers['[data-review-step]']({currentTarget:{dataset:{reviewStep:id}}});return destination;}};
}
const fixture=()=>({project:{skipped_steps:[],extra_question_answers:{}},branding:{company_name:'Example brand',assets:[],colors:[],fonts:[]},content:{staff:[]},pages:[],drafts:{}});
test('renders saved brand references as images, labelled swatches and font roles without mutating data',()=>{
 const d=fixture();d.branding.assets=[{type:'image',mime:'image/png',filename:'White mark.png',url:'https://inkfire.co.uk/wp-json/private/7/file',send_to_build:false}];
 d.branding.colors=[{name:'Primary',hex:'#061A44',pantone:'282 C'},{name:'White',hex:'#fff'}];d.branding.fonts=[{label:'Body text',name:'Poppins'}];
 const before=JSON.stringify(d),r=render(d,[{id:'logos',title:'Brand assets'},{id:'brand_colours',title:'Brand colours'},{id:'typography',title:'Typography'}]);
 assert.match(r.html,/Brand overview/);assert.match(r.html,/<img src="https:\/\/inkfire.co.uk\/wp-json\/private\/7\/file"/);assert.match(r.html,/background-color:#061A44/);assert.match(r.html,/<code>#061A44<\/code>/);assert.match(r.html,/Pantone: 282 C/);assert.match(r.html,/Body text<\/dt><dd><span[^>]*>Poppins/);assert.match(r.html,/Suggested use: Inkfire to advise/);assert.doesNotMatch(r.html,/Approved|data:image/);
 assert.equal(JSON.stringify(d),before);assert.equal(r.writes,0);assert.equal(r.view('logos'),'logos');assert.doesNotMatch(r.html,/id="fco-review-submit"/);
});
test('rejects injected swatch CSS, unsafe links and external image loads while retaining entered values as text',()=>{
 const d=fixture();d.branding.colors=[{name:'<img onerror=alert(1)>',hex:'#fff;background:url(https://evil.test/x)'}];
 d.branding.assets=[{type:'image',mime:'image/png',filename:'" onerror="alert(1)',url:'javascript:alert(1)'},{type:'image',url:'https://external.test/private.png'},{type:'image',url:'https://inkfire.co.uk/x.svg',mime:'image/svg+xml'},{type:'image'}];
 d.branding.fonts=[{name:'<script>alert(1)</script>',url:'javascript:alert(1)'}];
 const {html}=render(d,[{id:'logos',title:'Assets'},{id:'brand_colours',title:'Colours'},{id:'typography',title:'Fonts'}]);
 assert.doesNotMatch(html,/<img|<script|style="background-color:|href="javascript:|src="https:\/\/external/);assert.match(html,/&lt;script&gt;/);assert.match(html,/Check colour value/);assert.match(html,/#fff;background:url/);assert.doesNotMatch(html,/href="https:\/\/inkfire.co.uk\/onboarding/);
});
test('keeps false, zero, multiline answers and skipped saved answers visible; folds only empty sections',()=>{
 const d=fixture();d.project.extra_question_answers={first:false,second:0,third:'First line\nSecond line',fourth:''};d.project.skipped_steps=['q3'];
 const steps=['first','second','third','fourth'].map((id,i)=>({id:'q'+(i+1),title:'Question '+(i+1),type:'extra_question',question:{id}}));
 const {html}=render(d,steps);
 assert.match(html,/>No<\/span>/);assert.match(html,/>0<\/span>/);assert.match(html,/First line\nSecond line/);
 assert.match(html,/Marked for later; saved answers are shown below/);assert.match(html,/2 sections to revisit/);assert.match(html,/1 have no saved answer/);
 assert.equal((html.match(/<section class="fco-guided-card">/g)||[]).length,3);assert.match(html,/Question 4<small>No saved answer yet/);
});
test('retains nested record labels, escapes answers, and links valid saved URLs',()=>{
 const d=fixture();d.branding.socials=[{platform:'Research & news',url:'https://example.com/?a=1&b=2'}];d.branding.contact={address:'<b>Not markup</b>',phones:['01234','05678']};
 const {html}=render(d,[{id:'socials',title:'Social media'},{id:'contact_info',title:'Contact details'}]);
 assert.match(html,/<dt>Platform<\/dt>/);assert.match(html,/Research &amp; news/);assert.match(html,/rel="noopener noreferrer"/);assert.match(html,/&lt;b&gt;Not markup&lt;\/b&gt;/);assert.match(html,/>01234<\/span>/);
});
test('client review still offers the existing explicit submission action; admin review does not',()=>{
 const d=fixture();assert.match(render(d,[],{previewOnly:false,isAdmin:false}).html,/id="fco-review-submit"/);
 assert.doesNotMatch(render(d,[],{previewOnly:false,isAdmin:true}).html,/id="fco-review-submit"/);
});
