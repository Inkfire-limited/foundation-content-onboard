<?php
if (!defined('ABSPATH')) { exit; }
require_once __DIR__.'/brief-renderer.php';
final class FCO_Hub_Brief {
    public static function init() {
        add_action('admin_post_fco_developer_brief',[__CLASS__,'download']);
        add_action('rest_api_init',function(){register_rest_route(FCO_Hub::NS,'/projects/(?P<id>\d+)/brief',['methods'=>'GET','permission_callback'=>['FCO_Hub','manager'],'callback'=>[__CLASS__,'view']]);register_rest_route(FCO_Hub::NS,'/projects/(?P<id>\d+)/brief/email',['methods'=>'POST','permission_callback'=>['FCO_Hub','manager'],'callback'=>[__CLASS__,'email']]);});
    }
    public static function email($r) {
        $id=absint($r['id']);$p=$r->get_json_params();
        if (!FCO_Hub::origin_ok($r))return FCO_Hub::error('Origin not allowed.',403);
        if (!FCO_Hub::valid_project($id))return FCO_Hub::error('Project not found.',404);
        $to=is_string($p['email']??null)?trim($p['email']):'';$key=$p['request_id']??'';
        if (!is_email($to)||strlen($to)>254||!is_string($key)||!preg_match('/^[a-f0-9-]{36}$/D',$key)||empty($p['confirmed']))return FCO_Hub::error('Enter one valid staff email address and confirm sending.');
        $row=FCO_Hub::row($id);if((int)($p['revision']??-1)!==(int)$row['revision'])return FCO_Hub::error('The project changed. Refresh the brief and confirm the new revision before sending.',409);
        $receipt='fco_brief_mail_'.hash('sha256',get_current_user_id().':'.$id.':'.$key);
        $fingerprint=hash('sha256',$to.':'.$row['revision']);$previous=get_transient($receipt);
        if ($previous) {if(!hash_equals($previous['fingerprint'],$fingerprint))return FCO_Hub::error('This send request was already used for a different recipient or revision.',409);return $previous['result'];}
        $lock='_'.$receipt;
        if(!add_option($lock,time(),'',false))return FCO_Hub::error('This send is already in progress. Wait before retrying.',409);
        $path='';
        try {
            if(FCO_Hub::limited('brief-mail:'.get_current_user_id(),10,HOUR_IN_SECONDS))return FCO_Hub::error('Too many PDF sends. Try again later.',429);
            // Persist an uncertain receipt before handing mail to the provider; retries never resend blindly.
            $result=['accepted'=>false,'message'=>'This send needs checking before another attempt.'];
            set_transient($receipt,['fingerprint'=>$fingerprint,'result'=>$result],DAY_IN_SECONDS);
            $context=self::context($id,$row['revision']);$bytes=Inkfire_Onboarding_Brief::pdf(json_decode($row['payload'],true),$context,self::files($id),FCO_PLUGIN_DIR.'vendor-brief/autoload.php');
            $tmp=wp_tempnam('inkfire-brief');if(!$tmp)throw new RuntimeException('Cannot prepare the PDF attachment.');
            $path=$tmp.'.pdf';if(!rename($tmp,$path)){@unlink($tmp);throw new RuntimeException('Cannot prepare the PDF attachment.');}chmod($path,0600);
            if(file_put_contents($path,$bytes)!==strlen($bytes))throw new RuntimeException('Cannot write the PDF attachment.');
            $accepted=wp_mail($to,'Inkfire developer brief: '.sanitize_text_field($context['client_name']).' (revision '.(int)$row['revision'].')',"Attached is the private developer brief for ".$context['client_name'].".\n\nSaved revision: ".(int)$row['revision']."\nThis contains client project information. Share only with staff working on this project.\n\nInkfire",['Content-Type: text/plain; charset=UTF-8'],[$path]);
            $result=['accepted'=>(bool)$accepted,'message'=>$accepted?'PDF accepted by the email service for '.$to.'. Inbox delivery is not confirmed.':'The email service did not accept this PDF. Check mail delivery before trying again.'];
            set_transient($receipt,['fingerprint'=>$fingerprint,'result'=>$result],DAY_IN_SECONDS);
            FCO_Hub::audit($id,$accepted?'Developer PDF accepted by email service':'Developer PDF email failed','Revision '.$row['revision'].' to '.$to);
            return $result;
        } catch (Throwable $e) {
            $result=['accepted'=>false,'message'=>'The PDF could not be sent. Check the mail log before starting another send.'];set_transient($receipt,['fingerprint'=>$fingerprint,'result'=>$result],DAY_IN_SECONDS);return FCO_Hub::error($result['message'],500);
        } finally {if($path&&is_file($path))unlink($path);delete_option($lock);}
    }
    public static function context($id,$revision) {
        $m=FCO_Hub::meta($id);
        return ['client_name'=>$m['client_name'],'contact_name'=>$m['contact_name'],'email'=>$m['email'],'revision'=>(int)$revision,'generated_at'=>gmdate('c')];
    }
    public static function view($r) {
        $id=absint($r['id']);if (!FCO_Hub::valid_project($id))return FCO_Hub::error('Project not found.',404);
        $row=FCO_Hub::row($id);$context=self::context($id,$row['revision']);
        return ['html'=>Inkfire_Onboarding_Brief::body(json_decode($row['payload'],true),$context,self::files($id)),'revision'=>(int)$row['revision'],'pdf_url'=>add_query_arg('_wpnonce',wp_create_nonce('fco_brief_'.$id),admin_url('admin-post.php?action=fco_developer_brief&project_id='.$id))];
    }
    public static function files($id) {
        return array_map(function($a){return array_intersect_key($a,array_flip(['uuid','filename','mime','size','alt','caption','send_to_build','url','checksum']));},FCO_Hub_Assets::listing_for($id));
    }
    public static function download() {
        if (!FCO_Hub::manager())wp_die('Not authorised.',403);
        $id=absint($_GET['project_id']??0);check_admin_referer('fco_brief_'.$id);
        if (!FCO_Hub::valid_project($id))wp_die('Project not found.',404);
        $row=FCO_Hub::row($id);
        $bytes=Inkfire_Onboarding_Brief::pdf(json_decode($row['payload'],true),self::context($id,$row['revision']),self::files($id),FCO_PLUGIN_DIR.'vendor-brief/autoload.php');
        nocache_headers();header('Content-Type: application/pdf');header('X-Content-Type-Options: nosniff');header('Content-Disposition: attachment; filename="inkfire-brief-'.$id.'-r'.(int)$row['revision'].'.pdf"');echo $bytes;exit;
    }
}
FCO_Hub_Brief::init();
