<?php
if (!defined('ABSPATH')) { exit; }

final class FCO_Hub_Assets {
    const MAX_BYTES = 20971520;
    private static $download = null;
    public static function init() {
        add_action('rest_api_init',[__CLASS__,'routes']);
        add_filter('rest_pre_serve_request',[__CLASS__,'serve'],30,4);
    }
    public static function routes() {
        $base='/projects/(?P<project_id>\d+)/assets';
        register_rest_route(FCO_Hub::NS,$base,[
            ['methods'=>'GET','permission_callback'=>['FCO_Hub','project_access'],'callback'=>function($r){ return self::listing_for(absint($r['project_id'])); }],
            ['methods'=>'POST','permission_callback'=>['FCO_Hub','project_access'],'callback'=>[__CLASS__,'upload']],
        ]);
        register_rest_route(FCO_Hub::NS,$base.'/(?P<asset_id>\d+)', ['methods'=>'POST','permission_callback'=>['FCO_Hub','project_access'],'callback'=>[__CLASS__,'update']]);
        register_rest_route(FCO_Hub::NS,$base.'/(?P<asset_id>\d+)/file', ['methods'=>'GET','permission_callback'=>[__CLASS__,'can_download'],'callback'=>[__CLASS__,'download']]);
    }
    public static function directory() {
        // Encryption remains the privacy boundary even on a host that ignores .htaccess.
        $dir=WP_CONTENT_DIR.'/fco-private-vault';
        if (!is_dir($dir)) {
            if (!wp_mkdir_p($dir)) { return false; }
            file_put_contents($dir.'/.htaccess',"Require all denied\nDeny from all\n");
            file_put_contents($dir.'/index.php',"<?php http_response_code(404); exit;\n");
        }
        return $dir;
    }
    public static function listing_for($id) {
        global $wpdb;
        $rows=$wpdb->get_results($wpdb->prepare('SELECT id,uuid,project_id,filename,mime,size,checksum,alt,caption,purpose,send_to_build,created_at FROM '.FCO_Hub::table('assets').' WHERE project_id=%d ORDER BY id DESC',$id),ARRAY_A);
        return array_map([__CLASS__,'public_asset'],$rows ?: []);
    }
    public static function public_asset($a) {
        $a['id']=(int)$a['id']; $a['project_id']=(int)$a['project_id']; $a['size']=(int)$a['size']; $a['send_to_build']=(bool)$a['send_to_build']; $a['purpose']=sanitize_key($a['purpose'] ?? '');
        $a['url']=rest_url(FCO_Hub::NS.'/projects/'.$a['project_id'].'/assets/'.$a['id'].'/file');
        $a['type']=strpos($a['mime'],'image/')===0 && $a['mime']!=='image/svg+xml' ? 'image' : 'file';
        return $a;
    }
    public static function get($id,$project_id) {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM '.FCO_Hub::table('assets').' WHERE id=%d AND project_id=%d',$id,$project_id),ARRAY_A);
    }
    public static function validate_file($tmp,$name,$size) {
        if (!$size || $size>self::MAX_BYTES) { return FCO_Hub::error('Choose a file between 1 byte and 20 MB.',413); }
        $ext=strtolower(pathinfo($name,PATHINFO_EXTENSION));
        $types=['jpg'=>'image/jpeg','jpeg'=>'image/jpeg','png'=>'image/png','webp'=>'image/webp','gif'=>'image/gif','pdf'=>'application/pdf','txt'=>'text/plain','svg'=>'image/svg+xml','zip'=>'application/zip','docx'=>'application/vnd.openxmlformats-officedocument.wordprocessingml.document','pptx'=>'application/vnd.openxmlformats-officedocument.presentationml.presentation','xlsx'=>'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','woff'=>'font/woff','woff2'=>'font/woff2','ttf'=>'font/ttf','otf'=>'font/otf'];
        if (!isset($types[$ext])) { return FCO_Hub::error('That file type is not accepted. Use images, PDF, text, Office documents, ZIP or font files.'); }
        $mime=$types[$ext];
        if (in_array($ext,['jpg','jpeg','png','webp','gif'],true)) {
            $img=@getimagesize($tmp);
            if (!$img || ($img['mime'] ?? '')!==$mime || $img[0]*$img[1]>40000000) { return FCO_Hub::error('Invalid image or image larger than 40 megapixels.'); }
        }
        $h=fopen($tmp,'rb'); $head=$h ? fread($h,4096) : ''; if ($h) { fclose($h); }
        if ($ext==='pdf' && strpos($head,'%PDF-')!==0) { return FCO_Hub::error('Invalid PDF.'); }
        if (in_array($ext,['zip','docx','pptx','xlsx'],true) && substr($head,0,2)!=='PK') { return FCO_Hub::error('Invalid ZIP or Office document.'); }
        $font_signatures = ['woff'=>['wOFF'],'woff2'=>['wOF2'],'ttf'=>["\x00\x01\x00\x00",'true'],'otf'=>['OTTO']];
        if (isset($font_signatures[$ext]) && (strlen($head)<12 || !in_array(substr($head,0,4),$font_signatures[$ext],true))) { return FCO_Hub::error('This file does not match the selected font format. Use an original WOFF, WOFF2, TTF or OTF file.'); }
        if ($ext==='svg' && stripos($head,'<svg')===false) { return FCO_Hub::error('Invalid SVG.'); }
        $result=apply_filters('fco_hub_validate_upload',true,$tmp,$name,$mime);
        if (is_wp_error($result)) { return $result; }
        if ($result!==true) { return FCO_Hub::error('This upload was rejected by the site file scanner.'); }
        return $mime;
    }
    public static function upload($request) {
        $id=absint($request['project_id']); $files=$request->get_file_params(); $f=$files['file'] ?? null;
        if (!$f || is_array($f['name']) || !isset($f['tmp_name']) || (int)$f['error']!==UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) { return FCO_Hub::error('The file did not upload successfully.'); }
        if (FCO_Hub::meta($id)['status']==='archived') { return FCO_Hub::error('Project is archived.',403); }
        if (FCO_Hub::limited('uploads:'.$id,80,HOUR_IN_SECONDS)) { return FCO_Hub::error('Upload limit reached. Please try later.',429); }
        $name=sanitize_file_name($f['name']); $size=(int)filesize($f['tmp_name']);
        $mime=self::validate_file($f['tmp_name'],$name,$size); if (is_wp_error($mime)) { return $mime; }
        global $wpdb;
        $checksum=hash_file('sha256',$f['tmp_name']);
        $existing=$wpdb->get_var($wpdb->prepare('SELECT id FROM '.FCO_Hub::table('assets').' WHERE project_id=%d AND checksum=%s AND mime=%s LIMIT 1',$id,$checksum,$mime));
        if ($existing) { return self::public_asset(self::get((int)$existing,$id)); }
        $stats=$wpdb->get_row($wpdb->prepare('SELECT COUNT(*) AS n,COALESCE(SUM(size),0) AS bytes FROM '.FCO_Hub::table('assets').' WHERE project_id=%d',$id),ARRAY_A);
        if ((int)$stats['n']>=300 || (int)$stats['bytes']+$size>524288000) { return FCO_Hub::error('This project has reached its 300-file or 500 MB limit. Contact Inkfire.',413); }
        $bytes=file_get_contents($f['tmp_name']);
        $cipher=FCO_Hub::crypt($bytes,false,'asset'); $dir=self::directory();
        if (!$cipher || !$dir) { return FCO_Hub::error('Secure file storage is unavailable.',500); }
        $storage=bin2hex(random_bytes(24)).'.dat';
        if (file_put_contents($dir.'/'.$storage,$cipher,LOCK_EX)===false) { return FCO_Hub::error('Could not save the encrypted file.',500); }
        @chmod($dir.'/'.$storage,0600);
        $uuid=wp_generate_uuid4();
        $ok=$wpdb->insert(FCO_Hub::table('assets'),['uuid'=>$uuid,'project_id'=>$id,'filename'=>$name,'mime'=>$mime,'size'=>$size,'checksum'=>hash('sha256',$bytes),'storage'=>$storage,'alt'=>'','caption'=>'','purpose'=>'','send_to_build'=>0,'created_at'=>gmdate('Y-m-d H:i:s')]);
        if (!$ok) { @unlink($dir.'/'.$storage); return FCO_Hub::error('Could not record the file.',500); }
        $asset_id=(int)$wpdb->insert_id; FCO_Hub::audit($id,'File uploaded',$name);
        return self::public_asset(self::get($asset_id,$id));
    }
    public static function update($request) {
        $id=absint($request['project_id']); $aid=absint($request['asset_id']); $p=$request->get_json_params(); $a=self::get($aid,$id);
        if (!$a) { return FCO_Hub::error('File not found.',404); }
        $fields=[];
        foreach (['alt','caption'] as $k) { if (isset($p[$k])) { $fields[$k]=sanitize_textarea_field($p[$k]); } }
        // Only staff decide whether a private file should leave the hub or receive a website role.
        if (FCO_Hub::manager()) {
            if (isset($p['send_to_build'])) { $fields['send_to_build']=!empty($p['send_to_build']) ? 1 : 0; }
            if (isset($p['purpose'])) {
                $purpose=sanitize_key($p['purpose']);
                $allowed=['','logo','site_icon','brand_image','page_image','document','font'];
                if (!in_array($purpose,$allowed,true)) { return FCO_Hub::error('Choose a recognised website purpose for this file.'); }
                $fields['purpose']=$purpose;
            }
        }
        if ($fields) { global $wpdb; $wpdb->update(FCO_Hub::table('assets'),$fields,['id'=>$aid,'project_id'=>$id]); }
        return self::public_asset(self::get($aid,$id));
    }
    public static function can_download($request) {
        $id=absint($request['project_id']);
        if (!FCO_Hub::valid_project($id)) { return false; }
        // Image tags cannot carry REST headers. Validate the signed WP login cookie for staff reads only.
        if (FCO_Hub::manager()) { return true; }
        $staff_id=wp_validate_auth_cookie('', 'logged_in');
        if ($staff_id && user_can($staff_id,'manage_options')) { return true; }
        $s=FCO_Hub::session_record();
        return $s && (int)$s['project_id']===$id;
    }
    public static function bytes($asset) {
        $dir=self::directory();
        if (!$dir || !preg_match('/^[a-f0-9]{48}\.dat$/D',$asset['storage'])) { return false; }
        $path=$dir.'/'.$asset['storage'];
        if (!is_file($path)) { return false; }
        $bytes=FCO_Hub::crypt(file_get_contents($path),true,'asset');
        return $bytes!==false && hash_equals($asset['checksum'],hash('sha256',$bytes)) ? $bytes : false;
    }
    public static function download($request) {
        $a=self::get(absint($request['asset_id']),absint($request['project_id']));
        if (!$a) { return FCO_Hub::error('File not found.',404); }
        $bytes=self::bytes($a);
        if ($bytes===false) { return FCO_Hub::error('This file is unavailable or failed its integrity check.',500); }
        self::$download=['bytes'=>$bytes,'asset'=>$a]; return new WP_REST_Response(null,200);
    }
    public static function serve($served,$result,$request,$server) {
        if (self::$download===null || $result->get_status()!==200) { return $served; }
        $a=self::$download['asset']; $inline=in_array($a['mime'],['image/jpeg','image/png','image/webp','image/gif'],true);
        header('Cache-Control: no-store, private, max-age=0'); header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer'); header('X-Robots-Tag: noindex, nofollow');
        header("Content-Security-Policy: default-src 'none'; sandbox");
        header('Content-Type: '.$a['mime']);
        header('Content-Disposition: '.($inline?'inline':'attachment')."; filename*=UTF-8''".rawurlencode($a['filename']));
        header('Content-Length: '.strlen(self::$download['bytes']));
        echo self::$download['bytes']; self::$download=null; return true;
    }
}
