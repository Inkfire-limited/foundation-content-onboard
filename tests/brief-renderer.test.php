<?php
define('ABSPATH',__DIR__.'/');
function esc_html($value){return htmlspecialchars((string)$value,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');}
function wp_strip_all_tags($value){return strip_tags((string)$value);}
require dirname(__DIR__).'/includes/v3/brief-renderer.php';
function check($condition,$message){if(!$condition)throw new RuntimeException($message);echo "PASS: $message\n";}
$data=['project'=>['extra_questions'=>[
    ['id'=>'first','title'=>'Where is product data?'],['id'=>'second','title'=>'Is there a shop?'],['id'=>'third','title'=>'Remaining question'],
], 'extra_question_answers'=>['first'=>'0','second'=>false,'old'=>'Retained answer token'],'features'=>['forms']],
'branding'=>['company_name'=>'Fixture Company'],
'pages'=>[['id'=>'home','title'=>'Home'],['id'=>'empty','title'=>'Empty']],
'drafts'=>['home::main'=>['content'=>'<p>Page copy token</p>'],'empty'=>['content'=>'<p>&nbsp;</p>']],
'_extensions'=>['future'=>'Future retained token']];
$files=[['filename'=>'approved-logo.png','send_to_build'=>true,'purpose'=>'logo'],['filename'=>'reference.png','send_to_build'=>false]];
$before=serialize($data);
$sections=Inkfire_Onboarding_Brief::sections($data,$files);
check(isset($sections['Project-specific questions & answers']),'Custom questions have their own named brief section');
check($sections['Project-specific questions & answers']['1. Where is product data?']==='0','A zero answer is preserved');
check($sections['Project-specific questions & answers']['2. Is there a shop?']===false,'A false answer is preserved');
check($sections['Project-specific questions & answers']['3. Remaining question']===null,'Missing answers remain explicitly empty');
check($sections['Retained answers to earlier project questions']['old']==='Retained answer token','Answers to removed questions remain in the brief');
$summary=Inkfire_Onboarding_Brief::summary($data,$files);
check($summary['questions_answered']===2&&$summary['questions_unanswered']===1,'Only populated question answers count as answered');
check($summary['pages_with_copy']===1&&$summary['pages_without_copy']===1,'Blank rich-text markup is not mistaken for page copy');
check($summary['files_approved']===1&&$summary['files_total']===2,'File approvals are counted separately from uploaded files');
$body=Inkfire_Onboarding_Brief::body($data,['client_name'=>'Fixture <img src=x onerror=alert(1)>','revision'=>7],$files);
foreach(['Page copy token','Retained answer token','Future retained token','Remaining question','approved-logo.png'] as $token)check(str_contains($body,$token),'Brief includes '.$token);
check(!str_contains($body,'<img src=x'),'Client-supplied headings are escaped');
check(str_contains($body,'href="#inkfire-brief-section-'),'Brief contents link to the rendered sections');
check(serialize($data)===$before,'Rendering and summarising do not mutate saved data');
