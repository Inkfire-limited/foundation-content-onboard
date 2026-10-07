<?php
if (!defined('ABSPATH')) { exit; }

final class FCO_Hub_Delivery {
    public static function init() {
        add_action('rest_api_init',[__CLASS__,'routes']);
        add_action('fco_hub_delivery',[__CLASS__,'run']);
    }
    public static function routes() {
        foreach (['connect','disconnect','preview','send','retry'] as $action) {
            register_rest_route(FCO_Hub::NS,'/projects/(?P<id>\d+)/'.$action,['methods'=>'POST','permission_callback'=>['FCO_Hub','manager'],'callback'=>[__CLASS__,$action]]);
        }
        register_rest_route(FCO_Hub::NS,'/projects/(?P<id>\d+)/submissions/(?P<submission_id>\d+)',['methods'=>'GET','permission_callback'=>['FCO_Hub','manager'],'callback'=>function($r){
            global $wpdb;
            $s=$wpdb->get_row($wpdb->prepare('SELECT revision,payload,created_at FROM '.FCO_Hub::table('submissions').' WHERE id=%d AND project_id=%d',absint($r['submission_id']),absint($r['id'])),ARRAY_A);
            if (!$s) { return FCO_Hub::error('Submission not found.',404); }
            $s['data']=json_decode($s['payload'],true); unset($s['payload']); return $s;
        }]);
    }
    public static function connection($id) { $c=get_post_meta($id,'_fco_connection',true); return is_array($c)?$c:[]; }
    public static function public_connection($id) {
        $c=self::connection($id);
        return $c ? array_intersect_key($c,array_flip(['url','site_id','version','connected_at','connector_version','environment','site_name','builder','capabilities'])) : null;
    }
    public static function valid_url($url) {
        $p=wp_parse_url($url); $home=wp_parse_url(home_url('/'));
        if (!$p || ($p['scheme'] ?? '')!=='https' || empty($p['host']) || isset($p['user']) || isset($p['pass']) || isset($p['query']) || isset($p['fragment']) || (isset($p['port']) && $p['port']!==443)) { return false; }
        if (strtolower($p['host'])===strtolower($home['host'])) { return false; }
        return (bool)wp_http_validate_url($url);
    }
    public static function request($connection,$payload) {
        $secret=FCO_Hub::crypt($connection['secret'] ?? '',true);
        if (!$secret || !self::valid_url($connection['url'] ?? '')) { return FCO_Hub::error('The destination or connection credentials are invalid. Re-pair the build.',409); }
        $body=wp_json_encode($payload); $time=(string)time(); $nonce=bin2hex(random_bytes(16));
        $signature=hash_hmac('sha256',$time."\n".$nonce."\n".$body,$secret);
        $response=wp_safe_remote_post(trailingslashit($connection['url']).'wp-json/inkfire-onboard-connector/v1/receive',[
            'timeout'=>45,'redirection'=>0,'sslverify'=>true,'limit_response_size'=>1048576,
            'headers'=>['Content-Type'=>'application/json','X-FCO-Site'=>$connection['site_id'],'X-FCO-Time'=>$time,'X-FCO-Nonce'=>$nonce,'X-FCO-Signature'=>$signature],
            'body'=>$body,
        ]);
        if (is_wp_error($response)) { return FCO_Hub::error('The development site could not be reached. The saved content is safe; delivery can be retried.',502); }
        $code=wp_remote_retrieve_response_code($response); $data=json_decode(wp_remote_retrieve_body($response),true);
        if ($code<200 || $code>=300 || !is_array($data)) {
            $message=is_array($data) ? sanitize_text_field($data['message'] ?? '') : '';
            return FCO_Hub::error('Development site returned HTTP '.$code.($message ? ': '.$message : '. Check its connector, maintenance screen and firewall.'),502);
        }
        if (($data['site_id'] ?? '')!==$connection['site_id']) { return FCO_Hub::error('The receiving site identity did not match. Nothing further will be sent.',409); }
        return $data;
    }
    public static function envelope($id,$op) {
        return ['protocol'=>1,'operation'=>$op,'hub_id'=>get_option('fco_hub_uuid'),'project_id'=>FCO_Hub::meta($id)['uuid']];
    }
    public static function connect($request) {
        $id=absint($request['id']); if (!FCO_Hub::valid_project($id)) { return FCO_Hub::error('Project not found.',404); }
        $p=$request->get_json_params(); $code=trim((string)($p['pairing_code'] ?? ''));
        if (strlen($code)>2000) { return FCO_Hub::error('Invalid pairing code.'); }
        $decoded=base64_decode(strtr($code,'-_','+/'),true); $c=$decoded ? json_decode($decoded,true) : null;
        if (!is_array($c) || !self::valid_url($c['url'] ?? '') || !preg_match('/^[a-f0-9-]{36}$/D',(string)($c['site_id'] ?? '')) || !preg_match('/^[a-f0-9]{64}$/D',(string)($c['secret'] ?? ''))) { return FCO_Hub::error('Paste the pairing code from the connector on the separate HTTPS development site. Inkfire itself cannot be a destination.'); }
        $m=FCO_Hub::meta($id); if (!$m['uuid']) { $m['uuid']=wp_generate_uuid4(); FCO_Hub::set_meta($id,$m); }
        $c['url']=untrailingslashit(esc_url_raw($c['url'])); $c['secret']=FCO_Hub::crypt($c['secret']); $c['version']=wp_generate_uuid4();
        $res=self::request($c,self::envelope($id,'hello')); if (is_wp_error($res)) { return $res; }
        $c['connected_at']=gmdate('c'); $c['connector_version']=sanitize_text_field($res['version'] ?? ''); $c['environment']=sanitize_key($res['environment'] ?? ''); $c['site_name']=sanitize_text_field($res['site_name'] ?? '');
        $builder=is_array($res['builder'] ?? null)?$res['builder']:[];$c['builder']=['type'=>sanitize_key($builder['type'] ?? ''),'label'=>sanitize_text_field($builder['label'] ?? ''),'version'=>sanitize_text_field($builder['version'] ?? ''),'native_branding'=>sanitize_key($builder['native_branding'] ?? '')];
        $c['capabilities']=array_values(array_filter(array_map('sanitize_key',is_array($res['capabilities'] ?? null)?$res['capabilities']:[])));
        update_post_meta($id,'_fco_connection',$c); FCO_Hub::audit($id,'Development site connected',$c['url']); return self::public_connection($id);
    }
    public static function disconnect($request) {
        $id=absint($request['id']); delete_post_meta($id,'_fco_connection'); FCO_Hub::audit($id,'Development site disconnected'); return ['success'=>true];
    }
    public static function preview($request) {
        $id=absint($request['id']); if (!FCO_Hub::valid_project($id)) { return FCO_Hub::error('Project not found.',404); }
        $row=FCO_Hub::row($id); $data=json_decode($row['payload'],true); $files=FCO_Hub_Assets::listing_for($id);
        $project=is_array($data['project'] ?? null)?$data['project']:[];
        $branding=is_array($data['branding'] ?? null)?$data['branding']:[];
        $languages=$project['languages'] ?? '';
        if (is_array($languages)) {
            $languages=implode(', ',array_values(array_filter(array_map('sanitize_text_field',$languages))));
        } else {
            $languages=sanitize_text_field((string)$languages);
        }
        $selected=array_values(array_filter($files,function($a){return !empty($a['send_to_build']);}));
        $selected_files=array_map(function($a){return ['id'=>(int)$a['id'],'filename'=>sanitize_file_name($a['filename']??''),'mime'=>sanitize_text_field($a['mime']??''),'purpose'=>sanitize_key($a['purpose']??'')];},$selected);
        return [
            'revision'=>(int)$row['revision'],
            'pages'=>count($data['pages'] ?? []),
            'files'=>count($selected),
            'selected_files'=>$selected_files,
            'users'=>count($project['wp_users'] ?? []),
            'admin_email'=>sanitize_email($project['admin_email'] ?? ''),
            'site_title'=>sanitize_text_field($branding['company_name'] ?? ($project['company_name'] ?? '')),
            'tagline'=>sanitize_text_field($branding['tagline'] ?? ''),
            'language'=>$languages,
            'brand_colours'=>count(is_array($branding['colors'] ?? null)?$branding['colors']:[]),
            'brand_fonts'=>count(is_array($branding['fonts'] ?? null)?$branding['fonts']:[]),
            'connection'=>self::public_connection($id),
            'message'=>'Every delivery category is approved separately. Pages remain drafts. Only files explicitly marked Send to build are eligible for transfer. Existing published, designed or independently edited work is protected. Connector 1.2.3 performs a signed preflight before any file transfer and reports unsupported work for developer follow-up.',
        ];
    }
    public static function send($request) {
        $id=absint($request['id']); if (!FCO_Hub::valid_project($id) || FCO_Hub::meta($id)['status']==='archived') { return FCO_Hub::error('Project is unavailable.',404); }
        $p=$request->get_json_params(); $c=self::connection($id); $row=FCO_Hub::row($id);
        if (!$c) { return FCO_Hub::error('Connect a development site before sending.',409); }
        if (version_compare($c['connector_version'] ?? '0','1.2.3','<')) { return FCO_Hub::error('Update the development site to Connector 1.2.3 and reconnect before sending. This release adds signed preflight, scoped builder authorisation and stronger preservation checks.',409); }
        foreach (['pages','media','terms'] as $key) {
            if (!is_array($p) || !array_key_exists($key,$p) || !is_bool($p[$key])) { return FCO_Hub::error('Refresh the delivery panel and explicitly choose whether to send pages, approved files and terms.',409,'fco_delivery_scope'); }
        }
        if (!empty($p['admin_email']) && !is_email(json_decode($row['payload'],true)['project']['admin_email'] ?? '')) { return FCO_Hub::error('Save a valid website contact email before approving an admin-email change.',400); }
        if (empty($p['approved']) || (int)($p['revision'] ?? 0)!==(int)$row['revision']) { return FCO_Hub::error('Review and approve the current saved revision first.',409); }
        $data=FCO_Hub::clean(json_decode($row['payload'],true),$id); if (is_wp_error($data)) { return $data; }
        $assets=!empty($p['media'])?array_values(array_filter(FCO_Hub_Assets::listing_for($id),function($a){return !empty($a['send_to_build']);})):[];
        $options=[
            'pages'=>$p['pages'],
            'media'=>$p['media'],
            'terms'=>$p['terms'],
            'users'=>!empty($p['users']),
            'branding'=>!empty($p['branding']),
            'account_emails'=>!empty($p['account_emails']) && !empty($p['users']),
            'admin_email'=>!empty($p['admin_email'])
        ];
        $snapshot=['brief_context'=>FCO_Hub_Brief::context($id,$row['revision']),'file_inventory'=>FCO_Hub_Brief::files($id),'connection_version'=>$c['version'],'data'=>$data,'assets'=>$assets,'options'=>$options];
        $job=wp_generate_uuid4(); global $wpdb;
        $ok=$wpdb->insert(FCO_Hub::table('deliveries'),['id'=>$job,'project_id'=>$id,'revision'=>$row['revision'],'payload'=>wp_json_encode($snapshot),'status'=>'pending','attempts'=>0,'report'=>'{}','next_at'=>gmdate('Y-m-d H:i:s'),'created_at'=>gmdate('Y-m-d H:i:s')]);
        if (!$ok) { return FCO_Hub::error('Could not queue the delivery.',500); }
        $m=FCO_Hub::meta($id); $m['status']='approved'; FCO_Hub::set_meta($id,$m);
        $scope=[];foreach($options as $key=>$enabled){if($enabled)$scope[]=$key;}
        FCO_Hub::audit($id,'Revision approved for delivery','Revision '.$row['revision'].' · '.implode(', ',$scope));
        wp_schedule_single_event(time()+5,'fco_hub_delivery',[$job]);
        return ['success'=>true,'job_id'=>$job,'status'=>'pending','revision'=>(int)$row['revision'],'options'=>$options];
    }
    public static function retry($request) {
        $id=absint($request['id']);
        if (!FCO_Hub::valid_project($id) || FCO_Hub::meta($id)['status']==='archived') { return FCO_Hub::error('Restore or reopen this project before reviewing a new delivery.',409); }
        $p=$request->get_json_params(); $job=sanitize_text_field($p['job_id'] ?? ''); global $wpdb;
        $row=$wpdb->get_row($wpdb->prepare('SELECT * FROM '.FCO_Hub::table('deliveries').' WHERE id=%s AND project_id=%d',$job,$id),ARRAY_A);
        if (!$row || in_array($row['status'],['complete','cancelled'],true)) { return FCO_Hub::error('No retryable delivery found. Cancelled or completed deliveries require a new approval.'); }
        $report=json_decode($row['report'],true) ?: [];
        if (!empty($report['result']['partial'])) {
            return FCO_Hub::error('This receiver recorded a partial delivery outcome. Review the destination and approve a new delivery after the cause is fixed; the same delivery ID will not be replayed.',409,'fco_partial_delivery');
        }
        if ($row['status']==='running' && strtotime($row['next_at'].' UTC')>time()) { return FCO_Hub::error('This delivery is already running.',409); }
        $wpdb->update(FCO_Hub::table('deliveries'),['status'=>'pending','attempts'=>0,'next_at'=>gmdate('Y-m-d H:i:s')],['id'=>$job]);
        FCO_Hub::audit($id,'Delivery batch requested'); self::run($job); return ['success'=>true];
    }
    public static function run($job_id) {
        global $wpdb;
        $row=$wpdb->get_row($wpdb->prepare('SELECT project_id,status FROM '.FCO_Hub::table('deliveries').' WHERE id=%s',$job_id),ARRAY_A);
        if (!$row || !in_array($row['status'],['pending','running'],true)) { return; }
        $id=(int)$row['project_id'];
        if (!FCO_Hub_Lifecycle::acquire($id)) { wp_schedule_single_event(time()+30,'fco_hub_delivery',[$job_id]); return; }
        try { self::run_locked($job_id); } finally { FCO_Hub_Lifecycle::release($id); }
    }
    private static function run_locked($job_id) {
        global $wpdb; $table=FCO_Hub::table('deliveries');
        $job=$wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id=%s",$job_id),ARRAY_A);
        if (!$job || !in_array($job['status'],['pending','running'],true)) { return; }
        $now=gmdate('Y-m-d H:i:s');
        $claimed=$wpdb->query($wpdb->prepare("UPDATE $table SET status='running',next_at=%s WHERE id=%s AND next_at<=%s AND status IN ('pending','running')",gmdate('Y-m-d H:i:s',time()+600),$job_id,$now));
        if ($claimed!==1) { return; }
        wp_schedule_single_event(time()+610,'fco_hub_delivery',[$job_id]);
        $id=(int)$job['project_id']; $snapshot=json_decode($job['payload'],true); $report=json_decode($job['report'],true) ?: []; $c=self::connection($id);
        if (!FCO_Hub::valid_project($id) || !$c || $c['version']!==($snapshot['connection_version'] ?? '') || FCO_Hub::meta($id)['status']==='archived') { self::finish($job,'failed',['error'=>'Destination changed, disconnected, or project archived. Review a new delivery.']); return; }
        try {
            if (empty($report['preflight']) || empty($report['preflight']['ok'])) {
                $payload=self::envelope($id,'preflight');$payload['delivery_id']=$job_id;$payload['revision']=(int)$job['revision'];$payload['options']=$snapshot['options']??[];
                $res=self::request($c,$payload);
                if (is_wp_error($res)) { self::fail($job,$report,$res); return; }
                $preflight=is_array($res['preflight']??null)?$res['preflight']:[];
                $report['preflight']=$preflight;$wpdb->update($table,['report'=>wp_json_encode($report)],['id'=>$job_id]);
                if (empty($preflight['ok'])) {
                    $blocking=array_values(array_filter(array_map('sanitize_text_field',(array)($preflight['blocking']??[]))));
                    $report['error']='Destination preflight blocked delivery before any new file transfer.'.($blocking?' '.implode(' ',$blocking):'');
                    self::finish($job,'failed',$report);
                    FCO_Hub::audit($id,'Delivery blocked by destination preflight','Revision '.$job['revision']);
                    return;
                }
            }
            $report['asset_results']=$report['asset_results'] ?? []; $processed=0;
            foreach ($snapshot['assets'] as $a) {
                if (isset($report['asset_results'][$a['uuid']])) { continue; }
                $stored=FCO_Hub_Assets::get((int)$a['id'],$id); $bytes=$stored ? FCO_Hub_Assets::bytes($stored) : false;
                if ($bytes===false) { self::finish($job,'failed',['error'=>'A saved file failed its integrity check.','preflight'=>$report['preflight']??[]]); return; }
                $payload=self::envelope($id,'asset'); $payload['delivery_id']=$job_id;
                $payload['asset']=array_merge($a,['base64'=>base64_encode($bytes)]);
                $res=self::request($c,$payload);
                if (is_wp_error($res)) { self::fail($job,$report,$res); return; }
                $report['asset_results'][$a['uuid']]=$res['asset']; $processed++;
                $wpdb->update($table,['report'=>wp_json_encode($report)],['id'=>$job_id]);
                if ($processed>=3) {
                    $left=count($snapshot['assets'])-count($report['asset_results']);
                    if ($left>0) { self::schedule($job,$report,30); return; }
                }
            }
            $payload=self::envelope($id,'apply'); $payload['delivery_id']=$job_id; $payload['revision']=(int)$job['revision'];
            $payload['brief_context']=$snapshot['brief_context'] ?? []; $payload['file_inventory']=$snapshot['file_inventory'] ?? [];
            $payload['data']=$snapshot['data']; $payload['options']=$snapshot['options']; $payload['assets']=array_values($report['asset_results']);
            $res=self::request($c,$payload);
            if (is_wp_error($res)) { self::fail($job,$report,$res); return; }
            $report['result']=is_array($res['report']??null)?$res['report']:[]; $report['finished_at']=gmdate('c');
            $requires_setup=(array)($report['result']['items']['requires_setup']??[]);
            $attention=!empty($report['result']['conflicts']) || !empty($report['result']['errors']) || !empty($report['result']['partial']) || !empty($requires_setup);
            foreach ($report['asset_results'] as $asset) { if (!empty($asset['error'])) { $attention=true; } }
            self::finish($job,$attention?'attention':'complete',$report);
            FCO_Hub::audit($id,$attention?'Delivery imported with developer follow-up':'Delivery completed','Revision '.$job['revision']);
        } catch (Throwable $e) { self::fail($job,$report,FCO_Hub::error('The delivery worker stopped unexpectedly. Retry is available.',500)); }
    }
    private static function finish($job,$status,$report) { global $wpdb; $wpdb->update(FCO_Hub::table('deliveries'),['status'=>$status,'report'=>wp_json_encode($report)],['id'=>$job['id']]); wp_clear_scheduled_hook('fco_hub_delivery',[$job['id']]); }
    private static function schedule($job,$report,$delay) {
        global $wpdb; $wpdb->update(FCO_Hub::table('deliveries'),['status'=>'pending','report'=>wp_json_encode($report),'next_at'=>gmdate('Y-m-d H:i:s',time()+$delay)],['id'=>$job['id']]);
        wp_clear_scheduled_hook('fco_hub_delivery',[$job['id']]); wp_schedule_single_event(time()+$delay+1,'fco_hub_delivery',[$job['id']]);
    }
    private static function fail($job,$report,$error) {
        global $wpdb; $n=(int)$job['attempts']+1; $report['last_error']=$error->get_error_message();
        $wpdb->update(FCO_Hub::table('deliveries'),['attempts'=>$n],['id'=>$job['id']]);
        if ($n>=5) { self::finish($job,'failed',$report); return; }
        self::schedule($job,$report,[60,300,900,3600,21600][$n-1]);
    }
}
