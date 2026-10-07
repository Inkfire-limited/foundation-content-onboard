<?php
if (!defined('ABSPATH')) { exit; }

final class FCO_Hub {
    const NS = 'inkfire-onboard/v1';
    const COOKIE = '__Host-fco_onboarding';
    const SCHEMA = '3.1.0';

    public static function init() {
        add_action('init', [__CLASS__, 'install'], 1);
        add_filter('register_post_type_args', [__CLASS__, 'cpt_args'], 10, 2);
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_filter('rest_post_dispatch', [__CLASS__, 'headers'], 20, 3);
        add_filter('rest_pre_serve_request', [__CLASS__, 'cors'], 20, 4);
    }
    public static function table($suffix) { global $wpdb; return $wpdb->prefix . 'fco_' . $suffix; }
    public static function cpt_args($args, $type) {
        if ($type === 'ink_onboard') {
            $args['show_ui'] = false;
            $args['show_in_rest'] = false;
            $args['supports'] = ['author'];
            $args['capabilities'] = array_fill_keys(['edit_post','read_post','delete_post','edit_posts','edit_others_posts','publish_posts','read_private_posts','delete_posts','create_posts'], 'manage_options');
            $args['map_meta_cap'] = false;
        }
        return $args;
    }
    public static function install() {
        if (get_option('fco_hub_schema') === self::SCHEMA) { return; }
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $collate = $wpdb->get_charset_collate();
        dbDelta('CREATE TABLE ' . self::table('state') . " (
            project_id bigint(20) unsigned NOT NULL,
            revision bigint(20) unsigned NOT NULL DEFAULT 1,
            payload longtext NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (project_id)
        ) $collate;");
        dbDelta('CREATE TABLE ' . self::table('submissions') . " (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            project_id bigint(20) unsigned NOT NULL,
            revision bigint(20) unsigned NOT NULL,
            payload longtext NOT NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY project_revision (project_id,revision)
        ) $collate;");
        dbDelta('CREATE TABLE ' . self::table('assets') . " (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            uuid char(36) NOT NULL,
            project_id bigint(20) unsigned NOT NULL,
            filename varchar(255) NOT NULL,
            mime varchar(100) NOT NULL,
            size bigint(20) unsigned NOT NULL,
            checksum char(64) NOT NULL,
            storage varchar(100) NOT NULL,
            alt text NOT NULL,
            caption text NOT NULL,
            purpose varchar(20) NOT NULL DEFAULT '',
            send_to_build tinyint(1) NOT NULL DEFAULT 0,
            created_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uuid (uuid),
            KEY project_id (project_id)
        ) $collate;");
        dbDelta('CREATE TABLE ' . self::table('deliveries') . " (
            id char(36) NOT NULL,
            project_id bigint(20) unsigned NOT NULL,
            revision bigint(20) unsigned NOT NULL,
            payload longtext NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'pending',
            attempts int unsigned NOT NULL DEFAULT 0,
            report longtext NOT NULL,
            next_at datetime NOT NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY  (id),
            KEY project_id (project_id),
            KEY status (status)
        ) $collate;");
        if (!$wpdb->last_error) {
            update_option('fco_hub_schema', self::SCHEMA, false);
            if (!get_option('fco_hub_uuid')) { add_option('fco_hub_uuid', wp_generate_uuid4(), '', false); }
        }
    }
    public static function error($message, $status = 400, $code = 'fco_error') {
        return new WP_Error($code, $message, ['status' => $status]);
    }
    public static function manager($request = null) { return current_user_can('manage_options'); }
    public static function valid_project($id) {
        return $id > 0 && get_post_type($id) === 'ink_onboard' && get_post_status($id) !== 'trash';
    }
    public static function meta($id) {
        $m = get_post_meta($id, '_fco_hub', true);
        return array_merge(['client_name'=>'','contact_name'=>'','email'=>'','collaborators'=>[],'welcome'=>'','logo_url'=>'','accent'=>'#32b190','status'=>'draft','active'=>false,'uuid'=>'','link_version'=>0,'last_invited'=>'','last_submitted'=>'','note'=>''], is_array($m) ? $m : []);
    }
    public static function set_meta($id, $meta) { update_post_meta($id, '_fco_hub', $meta); }
    public static function collaborators($meta_or_id) {
        $m = is_array($meta_or_id) ? $meta_or_id : self::meta((int)$meta_or_id);
        $raw = is_array($m['collaborators'] ?? null) ? $m['collaborators'] : [];
        if (!$raw && is_email($m['email'] ?? '')) {
            $raw = [['id'=>'primary','name'=>$m['contact_name'] ?? '','email'=>$m['email']]];
        }
        $out = []; $seen = [];
        foreach (array_slice($raw, 0, 30) as $item) {
            if (!is_array($item)) { continue; }
            $email = sanitize_email((string)($item['email'] ?? ''));
            if (!is_email($email)) { continue; }
            $email_key = strtolower($email);
            if (isset($seen[$email_key])) { continue; }
            $seen[$email_key] = true;
            $id = sanitize_key((string)($item['id'] ?? ''));
            if ($id === '') { $id = 'member_' . substr(hash('sha256', $email_key), 0, 12); }
            $out[] = ['id'=>$id,'name'=>sanitize_text_field((string)($item['name'] ?? '')),'email'=>$email];
        }
        return $out;
    }
    private static function normalise_collaborators_input($raw) {
        if (!is_array($raw) || array_values($raw) !== $raw || count($raw) > 30) { return self::error('Add up to 30 named project collaborators.'); }
        $out = []; $seen = [];
        foreach ($raw as $item) {
            if (!is_array($item)) { return self::error('Each collaborator needs a name and email address.'); }
            $name = sanitize_text_field((string)($item['name'] ?? ''));
            $email = sanitize_email((string)($item['email'] ?? ''));
            if ($name === '' || strlen($name) > 200 || !is_email($email)) { return self::error('Each collaborator needs a name and a valid email address.'); }
            $email_key = strtolower($email);
            if (isset($seen[$email_key])) { return self::error('Each collaborator email address can only be added once.'); }
            $seen[$email_key] = true;
            $id = sanitize_key((string)($item['id'] ?? ''));
            if ($id === '') { $id = 'member_' . substr(hash('sha256', $email_key), 0, 12); }
            $out[] = ['id'=>$id,'name'=>$name,'email'=>$email];
        }
        return $out;
    }
    public static function collaborator_emails($meta_or_id) { return array_values(array_map(static function($item){ return $item['email']; }, self::collaborators($meta_or_id))); }
    public static function collaborator_by_id($meta_or_id, $id) {
        $id = sanitize_key((string)$id);
        foreach (self::collaborators($meta_or_id) as $item) { if ($item['id'] === $id) { return $item; } }
        return null;
    }
    public static function recipient_signature($meta_or_id) {
        $emails = self::collaborator_emails($meta_or_id); sort($emails, SORT_STRING | SORT_FLAG_CASE);
        return hash('sha256', implode("\n", array_map('strtolower', $emails)));
    }
    public static function crypt($input, $decrypt = false, $purpose = 'secret') {
        if (!function_exists('openssl_encrypt')) { return false; }
        $key = hash('sha256', wp_salt('auth') . ':fco-v3:' . $purpose, true);
        if ($decrypt) {
            $raw = base64_decode((string) $input, true);
            if ($raw === false || strlen($raw) < 28) { return false; }
            return openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
        }
        $iv = random_bytes(12); $tag = '';
        $encrypted = openssl_encrypt((string) $input, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        return $encrypted === false ? false : base64_encode($iv . $tag . $encrypted);
    }
    public static function origin_ok($request) {
        $origin = $request->get_header('Origin');
        if (!$origin) { return true; }
        $home = wp_parse_url(home_url('/'));
        $expected = $home['scheme'] . '://' . $home['host'] . (isset($home['port']) ? ':' . $home['port'] : '');
        return hash_equals($expected, rtrim($origin, '/'));
    }
    public static function session_record() {
        $cookie = isset($_COOKIE[self::COOKIE]) ? (string) $_COOKIE[self::COOKIE] : '';
        if (!preg_match('/^[a-f0-9]{64}$/D', $cookie)) { return false; }
        $session_key = 'fco_session_' . hash('sha256', $cookie);
        $s = get_transient($session_key);
        if (!is_array($s) || !self::valid_project((int) $s['project_id'])) { return false; }
        if (empty($s['presence_id'])) { $s['presence_id'] = substr(hash('sha256', $cookie), 0, 16); set_transient($session_key, $s, 12 * HOUR_IN_SECONDS); }
        $m = self::meta((int) $s['project_id']);
        if (!$m['active'] || (int) $m['link_version'] !== (int) $s['version'] || $m['status'] === 'archived') { return false; }
        return $s;
    }
    public static function project_access($request) {
        $id = absint($request->get_param('project_id'));
        if (!$id) { $id = absint($request->get_param('id')); }
        if (!self::valid_project($id)) { return self::error('Project not available.', 404); }
        if (!self::origin_ok($request)) { return self::error('Origin not allowed.', 403); }
        if (self::manager()) { return true; }
        $s = self::session_record();
        if (!$s || (int) $s['project_id'] !== $id) { return self::error('Open your invitation link to continue.', 401, 'fco_session_required'); }
        if (!hash_equals($s['csrf'], (string) $request->get_header('X-FCO-CSRF'))) { return self::error('Your project access changed in another tab. Refresh access here before saving.', 403, 'fco_session_stale'); }
        return true;
    }
    public static function routes() {
        register_rest_route(self::NS, '/support', ['methods'=>'POST','permission_callback'=>[__CLASS__,'support_access'],'callback'=>[__CLASS__,'support']]);
        $staff = [__CLASS__, 'manager']; $project = [__CLASS__, 'project_access'];
        register_rest_route(self::NS, '/session', [
            ['methods'=>'POST','permission_callback'=>'__return_true','callback'=>[__CLASS__,'exchange']],
            ['methods'=>'GET','permission_callback'=>'__return_true','callback'=>[__CLASS__,'resume']],
        ]);
        register_rest_route(self::NS, '/logout', ['methods'=>'POST','permission_callback'=>'__return_true','callback'=>[__CLASS__,'logout']]);
        register_rest_route(self::NS, '/presence', ['methods'=>'POST','permission_callback'=>$project,'callback'=>[__CLASS__,'presence']]);
        register_rest_route(self::NS, '/projects', [
            ['methods'=>'GET','permission_callback'=>$staff,'callback'=>[__CLASS__,'projects']],
            ['methods'=>'POST','permission_callback'=>$staff,'callback'=>[__CLASS__,'create']],
        ]);
        register_rest_route(self::NS, '/projects/(?P<id>\d+)', [
            ['methods'=>'GET','permission_callback'=>$staff,'callback'=>[__CLASS__,'detail']],
            ['methods'=>'POST','permission_callback'=>$staff,'callback'=>[__CLASS__,'settings']],
        ]);
        foreach (['link','invite','archive'] as $action) {
            register_rest_route(self::NS, '/projects/(?P<id>\d+)/' . $action, ['methods'=>'POST','permission_callback'=>$staff,'callback'=>[__CLASS__,$action]]);
        }
        register_rest_route(self::NS, '/projects/(?P<id>\d+)/questions', [
            ['methods'=>'GET','permission_callback'=>$staff,'callback'=>[__CLASS__,'questions']],
            ['methods'=>'POST','permission_callback'=>$staff,'callback'=>[__CLASS__,'questions']],
        ]);
        register_rest_route(self::NS, '/question-library', [
            ['methods'=>'GET','permission_callback'=>$staff,'callback'=>[__CLASS__,'question_library']],
            ['methods'=>'POST','permission_callback'=>$staff,'callback'=>[__CLASS__,'question_library']],
        ]);
        register_rest_route(self::NS, '/projects/(?P<project_id>\d+)/submit', ['methods'=>'POST','permission_callback'=>$project,'callback'=>[__CLASS__,'submit']]);
        // Keep the editor's existing URLs, but replace every legacy permission and local-sync callback.
        register_rest_route('inkfire/v1', '/project/current', ['methods'=>'GET','permission_callback'=>$project,'callback'=>[__CLASS__,'current']], true);
        register_rest_route('inkfire/v1', '/project/save', ['methods'=>'POST','permission_callback'=>$project,'callback'=>[__CLASS__,'save']], true);
        register_rest_route('inkfire/v1', '/project/sync_pages', ['methods'=>'POST','permission_callback'=>$staff,'callback'=>function(){ return self::error('Local sync is disabled. Review and send from Client Onboarding.', 409); }], true);
        register_rest_route('inkfire/v1', '/project/email_summary', ['methods'=>'POST','permission_callback'=>$staff,'callback'=>function(){ return self::error('Use the project dashboard to send the client invitation.', 409); }], true);
    }
    public static function support_access($request) {
        if (!self::origin_ok($request)) { return self::error('Origin not allowed.',403); }
        $nonce = $request->get_param('support_nonce');
        if (!is_string($nonce) || !wp_verify_nonce($nonce,'fco_support')) { return self::error('Refresh this page and try again.',403); }
        if (absint($request->get_param('project_id'))) { return self::project_access($request); }
        return true;
    }
    public static function support($request) {
        $p = $request->get_json_params();
        foreach (['name','email','message','topic','slide','website'] as $field) {
            if (isset($p[$field]) && !is_string($p[$field])) { return self::error('Please check the form fields.'); }
        }
        if (!empty($p['website'])) { return self::error('Unable to send this request.'); }
        $name = sanitize_text_field($p['name'] ?? '');
        $email = sanitize_email($p['email'] ?? '');
        $message = sanitize_textarea_field($p['message'] ?? '');
        $topic = sanitize_text_field($p['topic'] ?? '');
        $slide = sanitize_text_field($p['slide'] ?? '');
        if (!$name || strlen($name)>120 || !is_email($email) || strlen($email)>254 || strlen($message)<10 || strlen($message)>5000 || !in_array($topic,['Access problem','Question about a slide','Upload problem','Other'],true) || strlen($slide)>120) { return self::error('Add your name, a valid email and an issue description between 10 and 5,000 characters.'); }
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        if (self::limited('support-ip:'.$ip,5,HOUR_IN_SECONDS) || self::limited('support-email:'.strtolower($email),5,HOUR_IN_SECONDS)) { return self::error('Too many messages. Please email support@inkfire.co.uk directly or try again later.',429); }
        $id = absint($request->get_param('project_id'));
        $project = $id ? self::meta($id)['client_name'] . ' (project ' . $id . ')' : 'Invitation / access page';
        $body = "Onboarding help request\n\nName: $name\nReply email: $email\nProject: $project\nTopic: $topic\nSlide: $slide\n\n$message";
        $sent = wp_mail('support@inkfire.co.uk','Onboarding help: '.$topic,$body,['Content-Type: text/plain; charset=UTF-8','Reply-To: '.$email]);
        if (!$sent) { return self::error('We could not send your message. Please email support@inkfire.co.uk directly.',502); }
        if ($id) { self::audit($id,'Support message accepted','Topic: '.$topic); }
        return ['message'=>'Your message has been sent to Inkfire support. We will reply to the email address you provided.'];
    }
    public static function limited($key, $limit, $window) {
        $k = 'fco_limit_' . hash('sha256', $key);
        $n = (int) get_transient($k);
        if ($n >= $limit) { return true; }
        set_transient($k, $n + 1, $window); return false;
    }
    public static function exchange($request) {
        if (!is_ssl() || !self::origin_ok($request)) { return self::error('A secure, same-site connection is required.', 403); }
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        if (self::limited('exchange:' . $ip, 30, 300)) { return self::error('Too many attempts. Please try again in five minutes.', 429); }
        $p = $request->get_json_params(); $token = is_array($p) ? ($p['token'] ?? '') : ''; $member = is_array($p) ? sanitize_key((string)($p['member'] ?? '')) : '';
        if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)) { return self::error('This invitation is not available. Ask Inkfire for a new link.', 401); }
        $ids = get_posts(['post_type'=>'ink_onboard','post_status'=>['publish','private','draft'],'posts_per_page'=>1,'fields'=>'ids','meta_key'=>'_fco_link_hash','meta_value'=>hash('sha256', $token)]);
        if (!$ids) { return self::error('This invitation is not available. Ask Inkfire for a new link.', 401); }
        $id = (int) $ids[0]; $m = self::meta($id); $collaborator = $member !== '' ? self::collaborator_by_id($m, $member) : null;
        if (!$m['active'] || $m['status'] === 'archived') { return self::error('This invitation is no longer active. Contact Inkfire.', 401); }
        if ($member !== '' && !$collaborator) { return self::error('This personalised invitation is no longer available. Ask Inkfire for a fresh link.', 401); }
        // Reopening this same valid invitation must not invalidate other tabs.
        // Validate the invitation first; reuse only a server-issued, unexpired
        // session for this project and current link version. Do not extend its TTL.
        $existing = self::session_record();
        if ($existing && (int)$existing['project_id'] === $id && (int)$existing['version'] === (int)$m['link_version']) {
            if ($collaborator && (($existing['member_id'] ?? '') !== $collaborator['id'])) {
                $existing['member_id']=$collaborator['id']; $existing['member_name']=$collaborator['name'];
                $cookie=(string)($_COOKIE[self::COOKIE] ?? ''); if (preg_match('/^[a-f0-9]{64}$/D',$cookie)) { set_transient('fco_session_'.hash('sha256',$cookie),$existing,12*HOUR_IN_SECONDS); }
            }
            return self::session_public($existing);
        }
        $sid = bin2hex(random_bytes(32));
        $s = ['project_id'=>$id,'version'=>(int) $m['link_version'],'csrf'=>bin2hex(random_bytes(24)),'presence_id'=>substr(hash('sha256',$sid),0,16),'member_id'=>$collaborator['id'] ?? '','member_name'=>$collaborator['name'] ?? ''];
        set_transient('fco_session_' . hash('sha256', $sid), $s, 12 * HOUR_IN_SECONDS);
        setcookie(self::COOKIE, $sid, ['expires'=>time()+12*HOUR_IN_SECONDS,'path'=>'/','secure'=>true,'httponly'=>true,'samesite'=>'Strict']);
        return self::session_public($s);
    }
    private static function session_public($s) {
        $m = self::meta((int) $s['project_id']);
        $viewer = sanitize_text_field((string)($s['member_name'] ?? ''));
        return ['project_id'=>(int)$s['project_id'],'csrf'=>$s['csrf'],'contact_name'=>$viewer ?: ($m['contact_name'] ?: 'your team'),'viewer_name'=>$viewer,'client_name'=>$m['client_name'],'welcome'=>$m['welcome'],'logo_url'=>$m['logo_url'],'accent'=>$m['accent'],'status'=>$m['status']];
    }
    public static function resume($request) {
        if (!self::origin_ok($request)) { return self::error('Origin not allowed.', 403); }
        $s = self::session_record();
        return $s ? self::session_public($s) : self::error('Open your invitation link to continue.', 401, 'fco_session_required');
    }
    public static function presence($request) {
        $s = self::session_record();
        if (!$s) { return self::error('Open your invitation link to continue.',401,'fco_session_required'); }
        $id = (int)$s['project_id']; $key = 'fco_presence_' . $id; $now = time();
        $rows = get_transient($key); if (!is_array($rows)) { $rows = []; }
        foreach ($rows as $presence_id=>$row) { if (!is_array($row) || (int)($row['seen'] ?? 0) < $now - 75) { unset($rows[$presence_id]); } }
        $presence_id = (string)($s['presence_id'] ?? substr(hash('sha256',(string)($_COOKIE[self::COOKIE] ?? '')),0,16));
        $rows[$presence_id] = ['name'=>sanitize_text_field((string)($s['member_name'] ?? '')) ?: 'A teammate','seen'=>$now];
        set_transient($key, $rows, 2 * MINUTE_IN_SECONDS);
        $others = [];
        foreach ($rows as $pid=>$row) { if ($pid !== $presence_id) { $others[] = ['name'=>$row['name'],'seen'=>$row['seen']]; } }
        return ['active'=>$others,'count'=>count($others)];
    }
    public static function logout($request) {
        $s = self::session_record();
        if (!$s || !self::origin_ok($request) || !hash_equals($s['csrf'], (string)$request->get_header('X-FCO-CSRF'))) { return self::error('Not authorised.',403); }
        $presence_key = 'fco_presence_' . (int)$s['project_id']; $rows = get_transient($presence_key);
        if (is_array($rows) && !empty($s['presence_id'])) { unset($rows[$s['presence_id']]); $rows ? set_transient($presence_key,$rows,2*MINUTE_IN_SECONDS) : delete_transient($presence_key); }
        delete_transient('fco_session_' . hash('sha256', (string)($_COOKIE[self::COOKIE] ?? '')));
        setcookie(self::COOKIE, '', ['expires'=>1,'path'=>'/','secure'=>true,'httponly'=>true,'samesite'=>'Strict']);
        return ['success'=>true];
    }
    public static function audit($id, $event, $detail = '') {
        FCO_Hub_Email_History::preserve_legacy($id);
        $events = get_post_meta($id, '_fco_events', true);
        if (!is_array($events)) { $events = []; }
        array_unshift($events, ['at'=>gmdate('c'),'event'=>sanitize_text_field($event),'detail'=>sanitize_text_field($detail),'actor'=>wp_doing_cron() ? 'Scheduled system task' : (self::manager() ? 'Inkfire staff #' . get_current_user_id() : 'Shared client link')]);
        update_post_meta($id, '_fco_events', array_slice($events, 0, 100));
    }
    public static function row($id) {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table('state') . ' WHERE project_id=%d', $id), ARRAY_A);
        if (!$row && self::valid_project($id)) {
            $data = FCO_CPT::get_project_data($id);
            $wpdb->query($wpdb->prepare('INSERT IGNORE INTO ' . self::table('state') . ' (project_id,revision,payload,updated_at) VALUES (%d,1,%s,%s)', $id, wp_json_encode($data), gmdate('Y-m-d H:i:s')));
            $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table('state') . ' WHERE project_id=%d', $id), ARRAY_A);
        }
        return $row;
    }
    /** Reject broken collection shapes before they reach the editor or page-tree walker. */
    public static function validate_structure(array $data) {
        foreach (['project','branding','content','drafts','comments'] as $key) {
            if (isset($data[$key]) && !is_array($data[$key])) { return self::error('Invalid '.$key.' data. Reload the saved project or check the import.'); }
        }
        $object_lists = ['project'=>['wp_users'], 'branding'=>['assets','socials','fonts','colors'], 'content'=>['staff']];
        foreach ($object_lists as $group=>$keys) {
            foreach ($keys as $key) {
                if (!isset($data[$group][$key])) { continue; }
                $list=$data[$group][$key];
                if (!is_array($list) || array_values($list) !== $list) { return self::error('Invalid '.str_replace('_',' ',$key).' list.'); }
                foreach ($list as $item) {
                    if (!is_array($item)) { return self::error('Every '.str_replace('_',' ',$key).' entry must contain named fields.'); }
                    foreach ($item as $field=>$value) {
                        if (in_array((string)$field,['id','url','name','hex','label','platform','position','bio','image','email','username','first_name','last_name','role','filename','alt','caption'],true) && $value !== null && !is_scalar($value)) { return self::error('Invalid '.str_replace('_',' ',$key).' entry.'); }
                    }
                }
            }
        }
        $text_lists = ['project'=>['features','integration_choices','skipped_steps'], 'branding'=>['inspiration_links','blog_categories','shop_categories']];
        foreach ($text_lists as $group=>$keys) {
            foreach ($keys as $key) {
                if (!isset($data[$group][$key])) { continue; }
                $list=$data[$group][$key];
                if (!is_array($list) || array_values($list) !== $list) { return self::error('Invalid '.str_replace('_',' ',$key).' list.'); }
                foreach ($list as $item) { if (!is_string($item)) { return self::error('Invalid '.str_replace('_',' ',$key).' value.'); } }
            }
        }
        if (isset($data['branding']['contact'])) {
            $contact=$data['branding']['contact'];
            if (!is_array($contact)) { return self::error('Invalid contact details.'); }
            foreach (['emails','phones'] as $key) {
                if (!isset($contact[$key])) { continue; }
                if (!is_array($contact[$key]) || array_values($contact[$key]) !== $contact[$key]) { return self::error('Invalid contact '.$key.' list.'); }
                foreach ($contact[$key] as $value) { if (!is_string($value)) { return self::error('Invalid contact '.$key.' value.'); } }
            }
        }
        foreach (($data['drafts'] ?? []) as $draft) {
            if (!is_array($draft)) { return self::error('Invalid page content record.'); }
            if (isset($draft['content']) && !is_string($draft['content'])) { return self::error('Page content must be text.'); }
            if (isset($draft['images'])) {
                if (!is_array($draft['images']) || array_values($draft['images']) !== $draft['images']) { return self::error('Invalid page image list.'); }
                foreach ($draft['images'] as $image) { if (!is_array($image) || (isset($image['url']) && !is_string($image['url']))) { return self::error('Invalid page image reference.'); } }
            }
        }
        foreach (($data['comments'] ?? []) as $comments) {
            if (!is_array($comments)) { return self::error('Invalid page discussion.'); }
            foreach ($comments as $comment) { if (!is_array($comment)) { return self::error('Invalid discussion entry.'); } }
        }
        return true;
    }
    public static function clean($data, $id) {
        if (!is_array($data)) { return self::error('Invalid project data.'); }
        $encoded = wp_json_encode($data);
        if ($encoded === false) { return self::error('Project data could not be encoded safely. Check imported characters or structure.'); }
        if (strlen($encoded) > 4*1024*1024) { return self::error('Project text exceeds the 4 MB limit. Upload documents separately.',413); }
        if (!isset($data['pages']) || !is_array($data['pages']) || count($data['pages']) > 200) { return self::error('A project can contain up to 200 pages.'); }
        $shape = self::validate_structure($data);
        if (is_wp_error($shape)) { return $shape; }

        // Validate complexity before sanitising. Never silently truncate an answer because
        // a future field, import, or nested structure exceeded the supported contract.
        $nodes = 0;
        $inspect = function($value, $depth = 0) use (&$inspect, &$nodes) {
            if (++$nodes > 30000) { return FCO_Hub::error('This project contains too many individual values. Reduce the imported data and try again.',413,'fco_project_nodes'); }
            if ($depth > 12) { return FCO_Hub::error('This project contains data nested more deeply than the onboarding format supports.',413,'fco_project_depth'); }
            if (is_object($value)) { $value = (array)$value; }
            if (is_array($value)) {
                foreach ($value as $item) {
                    $check = $inspect($item,$depth+1);
                    if (is_wp_error($check)) { return $check; }
                }
                return true;
            }
            if (is_string($value) && strlen($value) > 1000000) { return FCO_Hub::error('One project answer exceeds the 1 MB per-field limit. Upload long documents separately.',413,'fco_project_field_size'); }
            return true;
        };
        $complexity = $inspect($data);
        if (is_wp_error($complexity)) { return $complexity; }

        // Known containers remain first-class. Unknown/future top-level containers are
        // retained under _extensions so the save -> snapshot -> receiver -> brief pipeline
        // cannot silently erase questionnaire evolution.
        $known = ['project','branding','content','pages','drafts','comments','_legacy','_extensions','_provenance'];
        $extensions = is_array($data['_extensions'] ?? null) ? $data['_extensions'] : [];
        foreach ($data as $key=>$value) {
            if (in_array((string)$key,$known,true)) { continue; }
            // _hub is response metadata, never questionnaire data.
            if ((string)$key==='_hub') { continue; }
            if (in_array((string)$key,['__proto__','constructor','prototype'],true)) { continue; }
            $safe = preg_replace('/[^a-zA-Z0-9_:.\-]/','',(string)$key);
            if ($safe === '') { $safe='field_'.substr(hash('sha256',(string)$key),0,12); }
            if (!array_key_exists($safe,$extensions)) { $extensions[$safe]=$value; }
        }
        $data = array_intersect_key($data, array_flip($known));
        if ($extensions) { $data['_extensions']=$extensions; }

        $walk = function($value, $key = '') use (&$walk, $id) {
            if (is_object($value)) { $value = (array)$value; }
            if (is_array($value)) {
                $out = [];
                foreach ($value as $k=>$v) {
                    if (in_array((string)$k, ['__proto__','constructor','prototype'], true)) { continue; }
                    $safe = is_int($k) ? $k : preg_replace('/[^a-zA-Z0-9_:.\-]/','', (string)$k);
                    if ($safe === '') { $safe='field_'.substr(hash('sha256',(string)$k),0,12); }
                    $out[$safe] = $walk($v, (string)$k);
                }
                return $out;
            }
            if (is_bool($value) || is_int($value) || is_float($value) || $value === null) { return $value; }
            $v = (string)$value;
            if ($key === 'hex' || $key === 'accent') { return sanitize_hex_color($v) ?: '#cccccc'; }
            if (in_array($key,['url','image','featured_image','logo_url','existing_website'],true)) {
                $url = esc_url_raw($v, ['https','http']);
                if (preg_match('~/inkfire-onboard/v1/projects/(\d+)/assets/~',$url,$m) && (int)$m[1] !== $id) { return ''; }
                return $url;
            }
            if (in_array($key, ['content','email_signature'],true)) { return wp_kses_post($v); }
            return sanitize_textarea_field($v);
        };
        $data = $walk($data);
        $data['project'] = is_array($data['project'] ?? null) ? $data['project'] : [];
        $data['project']['id'] = $id;
        $data['project']['wizard_complete'] = !empty($data['project']['wizard_complete']);
        $data['drafts'] = is_array($data['drafts'] ?? null) ? $data['drafts'] : [];
        $data['branding'] = is_array($data['branding'] ?? null) ? $data['branding'] : [];
        $data['comments'] = is_array($data['comments'] ?? null) ? $data['comments'] : [];
        $data['_provenance'] = is_array($data['_provenance'] ?? null) ? $data['_provenance'] : [];
        $data['_provenance']['sections'] = is_array($data['_provenance']['sections'] ?? null) ? $data['_provenance']['sections'] : [];
        $map = [];
        foreach ($data['pages'] as &$p) {
            if (!is_array($p) || !isset($p['id']) || (!is_string($p['id']) && !is_int($p['id'])) || !preg_match('/^[a-zA-Z0-9_\-]{1,100}$/D',(string)$p['id']) || array_key_exists((string)$p['id'],$map)) { return self::error('Each page needs a unique valid ID.'); }
            $parent = $p['parent'] ?? null;
            if ($parent !== null && !is_string($parent) && !is_int($parent)) { return self::error('Each parent page must be a valid page ID or empty.'); }
            if ($parent !== null && $parent !== '' && !preg_match('/^[a-zA-Z0-9_\-]{1,100}$/D',(string)$parent)) { return self::error('The parent page ID is invalid.'); }
            $p['id'] = (string)$p['id']; $p['parent'] = $parent === null || $parent === '' ? null : (string)$parent;
            $map[$p['id']] = $p['parent'];
            $p['title'] = sanitize_text_field($p['title'] ?? 'Untitled');
            $p['sort'] = (int)($p['sort'] ?? 0);
        } unset($p);
        foreach ($map as $page=>$parent) {
            $seen = [$page=>true]; $cursor = $parent;
            while ($cursor) {
                if (!isset($map[$cursor]) && !array_key_exists($cursor,$map)) { return self::error('A parent page is missing.'); }
                if (isset($seen[$cursor])) { return self::error('Pages cannot be nested inside themselves.'); }
                $seen[$cursor] = true; $cursor = $map[$cursor];
            }
        }
        return $data;
    }
    /** Compare answers, not navigation, autosave revisions or provenance timestamps. */
    public static function answer_snapshot($data) {
        if (!is_array($data)) { $data=[]; }
        unset($data['_hub'],$data['_provenance']);
        foreach (['wizard_step','wizard_complete','skipped_steps'] as $key) { unset($data['project'][$key]); }
        if (empty($data['project']['pending_inputs'])) { unset($data['project']['pending_inputs']); }
        foreach (($data['pages'] ?? []) as $i=>$page) { $data['pages'][$i]['sort']=$i; }
        $sort=function($value) use (&$sort) {
            if (!is_array($value)) { return $value; }
            if (array_keys($value) !== range(0,count($value)-1)) { ksort($value); }
            foreach ($value as &$item) { $item=$sort($item); } unset($item);
            return $value;
        };
        return wp_json_encode($sort($data));
    }
    public static function submission_state($id, $data) {
        global $wpdb;
        $last=$wpdb->get_row($wpdb->prepare('SELECT revision,payload,created_at FROM '.self::table('submissions').' WHERE project_id=%d ORDER BY revision DESC LIMIT 1',$id),ARRAY_A);
        if (!$last) { return null; }
        return ['revision'=>(int)$last['revision'],'submitted_at'=>$last['created_at'].'Z','current'=>self::answer_snapshot(json_decode($last['payload'],true))===self::answer_snapshot($data)];
    }
    public static function current($request) {
        $id = absint($request->get_param('project_id')); $row = self::row($id);
        if (!$row) { return self::error('Project could not be loaded.',500); }
        $data = self::clean(json_decode($row['payload'],true),$id);
        if (is_wp_error($data)) { return $data; }
        foreach (($data['pages'] ?? []) as $page) {
            $pid=$page['id'];
            if (in_array($data['drafts'][$pid]['status'] ?? 'empty',['','empty'],true) && trim(wp_strip_all_tags($data['drafts'][$pid.'::main']['content'] ?? '')) !== '') { $data['drafts'][$pid]['status']='draft'; }
        }
        $data['_hub'] = ['revision'=>(int)$row['revision'],'updated_at'=>$row['updated_at'],'status'=>self::meta($id)['status'],'submission'=>self::submission_state($id,$data)];
        foreach (['branding','drafts','comments'] as $key) { if (empty($data[$key])) { $data[$key] = (object)[]; } }
        return $data;
    }
    public static function save($request) {
        // Correlate a failed save without recording its content, token, cookie or email.
        $reference = 'FCO-SAVE-' . strtoupper(substr(str_replace('-', '', wp_generate_uuid4()), 0, 12));
        $exception = null;
        try { $result = self::save_checked($request); }
        catch (Throwable $error) {
            $exception = ['class'=>get_class($error),'file'=>basename($error->getFile()),'line'=>$error->getLine()];
            $result = self::error('We could not confirm this save. Your changes are still in this browser. Download your copy before reloading, or retry saving.',500,'fco_save_failed');
        }
        if (is_wp_error($result)) {
            $details = $result->get_error_data(); $details = is_array($details) ? $details : ['status'=>500];
            $details['request_id'] = $reference; $result->add_data($details);
            if ((int)($details['status'] ?? 500) >= 500) {
                error_log('[FCO save] ' . wp_json_encode(['at'=>gmdate('c'),'request_id'=>$reference,'project_id'=>absint($request->get_param('project_id')),'status'=>(int)($details['status'] ?? 500),'code'=>$result->get_error_code(),'exception'=>$exception]));
            }
        } elseif (is_array($result)) { $result['request_id'] = $reference; }
        return $result;
    }
    private static function normalize_provenance($incoming, $current, $manager) {
        $incoming=is_array($incoming)?$incoming:[];
        $current=is_array($current)?$current:[];
        $existing=is_array($current['sections']??null)?$current['sections']:[];
        $proposed=is_array($incoming['sections']??null)?$incoming['sections']:[];
        $allowed=['staff_prefilled','client_confirmed','client_changed','skipped','unanswered'];
        $staff_allowed=['staff_prefilled','skipped','unanswered'];
        $client_allowed=['client_confirmed','client_changed','skipped','unanswered'];
        $out=[];
        $ids=array_unique(array_merge(array_keys($existing),array_keys($proposed)));
        foreach ($ids as $raw_id) {
            $id=preg_replace('/[^a-zA-Z0-9_:\-]/','',(string)$raw_id);
            if ($id==='') { continue; }
            $old=is_array($existing[$raw_id]??null)?$existing[$raw_id]:[];
            $old_state=in_array((string)($old['state']??''),$allowed,true)?(string)$old['state']:'';
            if ($old_state) {
                $out[$id]=[
                    'state'=>$old_state,
                    'actor'=>in_array((string)($old['actor']??''),['staff','client'],true)?(string)$old['actor']:($old_state==='staff_prefilled'?'staff':'client'),
                    'updated_at'=>sanitize_text_field((string)($old['updated_at']??'')),
                ];
            }
            $new=is_array($proposed[$raw_id]??null)?$proposed[$raw_id]:[];
            $state=(string)($new['state']??'');
            if (!in_array($state,$allowed,true)) { continue; }
            $permitted=$manager?in_array($state,$staff_allowed,true):in_array($state,$client_allowed,true);
            if (!$permitted) {
                // A client may round-trip an existing staff state and staff may round-trip
                // existing client evidence, but neither may manufacture the other actor's state.
                if ($old_state===$state) { continue; }
                continue;
            }
            $changed=!isset($out[$id]) || $out[$id]['state']!==$state || $out[$id]['actor']!==($manager?'staff':'client');
            if ($changed) {
                $out[$id]=['state'=>$state,'actor'=>$manager?'staff':'client','updated_at'=>gmdate('c')];
            }
        }
        $defaults=is_array($current['defaults']??null)?$current['defaults']:[];
        $incoming_defaults=is_array($incoming['defaults']??null)?$incoming['defaults']:[];
        if (!empty($incoming_defaults['brand_colors'])) { $defaults['brand_colors']=true; }
        return ['version'=>1,'sections'=>$out,'defaults'=>$defaults];
    }

    private static function save_checked($request) {
        $id = absint($request->get_param('project_id')); $p = $request->get_json_params();
        if (!isset($p['revision']) || !is_numeric($p['revision'])) { return self::error('Refresh the editor before saving.',409,'fco_conflict'); }
        if (self::meta($id)['status'] === 'archived') { return self::error('This project is archived.',403); }
        $row=self::row($id);
        if (!$row) { return self::error('The project could not be loaded for saving. Your changes are still in this browser.',503,'fco_save_storage'); }
        $current=json_decode($row['payload'],true);$current=is_array($current)?$current:[];
        $data = self::clean($p['data'] ?? null,$id); if (is_wp_error($data)) { return $data; }
        $data['_provenance']=self::normalize_provenance($data['_provenance']??[], $current['_provenance']??[], self::manager());
        // Old/future clients must not erase fields they do not understand merely by omitting them.
        if (!empty($current['_extensions']) && is_array($current['_extensions'])) {
            $data['_extensions']=array_replace_recursive($current['_extensions'],is_array($data['_extensions']??null)?$data['_extensions']:[]);
        }
        global $wpdb;
        if ((int)$p['revision'] !== (int)$row['revision']) { return self::error('Another tab or person saved this project. Your unsaved work is still here.',409,'fco_conflict'); }
        if ($data === $current) { return ['success'=>true,'revision'=>(int)$row['revision'],'updated_at'=>$row['updated_at'],'submission'=>self::submission_state($id,$data)]; }
        $now = gmdate('Y-m-d H:i:s');
        $updated = $wpdb->query($wpdb->prepare('UPDATE ' . self::table('state') . ' SET payload=%s, revision=revision+1, updated_at=%s WHERE project_id=%d AND revision=%d',wp_json_encode($data),$now,$id,(int)$p['revision']));
        if ($updated === false) { return self::error('The save service is temporarily unavailable. Your changes are still in this browser. Please retry.',503,'fco_save_storage'); }
        if ($updated !== 1) { return self::error('Someone else saved this project. Your unsaved work is still in this browser. Download it before reloading.',409,'fco_conflict'); }
        // The new state table is authoritative; keep legacy storage readable for rollback.
        FCO_CPT::update_project_data($id,$data);
        $m = self::meta($id);
        if (in_array($m['status'],['draft','invited','submitted','approved'],true) && !((self::submission_state($id,$data)['current'] ?? false) && $m['status']==='submitted')) { $m['status']='in_progress'; self::set_meta($id,$m); }
        return ['success'=>true,'revision'=>(int)$p['revision']+1,'updated_at'=>$now,'submission'=>self::submission_state($id,$data)];
    }
    public static function projects($request = null) {
        $statuses = ['publish','private','draft'];
        if ($request instanceof WP_REST_Request && rest_sanitize_boolean($request->get_param('include_trash'))) { $statuses[] = 'trash'; }
        $posts = get_posts(['post_type'=>'ink_onboard','post_status'=>$statuses,'posts_per_page'=>200,'orderby'=>'modified','order'=>'DESC']);
        $out = [];
        foreach ($posts as $p) {
            $m = self::meta($p->ID); $r = self::row($p->ID); $d = $r ? json_decode($r['payload'],true) : [];
            $pages = is_array($d['pages'] ?? null) ? $d['pages'] : []; $filled=0;
            foreach ($pages as $page) { if (trim(wp_strip_all_tags($d['drafts'][$page['id'].'::main']['content'] ?? '')) !== '') { $filled++; } }
            $collaborators = self::collaborators($m);
            $out[] = ['id'=>$p->ID,'name'=>$m['client_name'] ?: html_entity_decode($p->post_title,ENT_QUOTES,'UTF-8'),'contact'=>$m['contact_name'],'email'=>$m['email'],'collaborators'=>$collaborators,'collaborator_count'=>count($collaborators),'status'=>$p->post_status==='trash'?'trash':$m['status'],'active'=>$p->post_status==='trash'?false:$m['active'],'pages'=>count($pages),'filled'=>$filled,'updated_at'=>$r['updated_at'] ?? $p->post_modified_gmt,'revision'=>(int)($r['revision'] ?? 0),'invitation_schedule'=>FCO_Hub_Invitation_Scheduler::public_record($p->ID)];
        }
        return $out;
    }
    public static function create($request) {
        // Retrying the same creation request must not create or invite a second project.
        $p = $request->get_json_params();
        $request_id = is_array($p) ? ($p['request_id'] ?? '') : '';
        if (!is_string($request_id) || ($request_id !== '' && !preg_match('/^[a-f0-9-]{36}$/Di', $request_id))) { return self::error('Please reopen the new-project form and try again.'); }
        if ($request_id === '') { return self::create_new($request); }
        global $wpdb;
        $key = hash('sha256', get_current_user_id().':'.$request_id);
        $lock = 'fco_create_'.substr(hash('sha256', $wpdb->prefix.':'.$key), 0, 40);
        if ((int)$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s,0)', $lock)) !== 1) { return self::error('This project is still being created. Wait a moment, then retry in this form.', 409); }
        try {
            $ids = get_posts(['post_type'=>'ink_onboard','post_status'=>['private','draft','publish','trash'],'fields'=>'ids','posts_per_page'=>1,'meta_key'=>'_fco_creation_key','meta_value'=>$key]);
            if ($ids) {
                $id = (int)$ids[0];
                if (get_post_status($id)==='trash') { return self::error('This project was already created and is now in Trash. Restore it from the project list.', 409); }
                $read = new WP_REST_Request('GET'); $read->set_param('id', $id);
                $detail = self::detail($read);
                $outcome = get_post_meta($id, '_fco_creation_outcome', true);
                if (is_array($outcome)) { $detail = array_merge($detail, $outcome); }
                else { $detail['creation_invitation']=['status'=>'check','message'=>'The project was already created. Check its invitation status before sending again.']; }
                $detail['creation_reused'] = true;
                return $detail;
            }
            $detail = self::create_new($request, $key);
            if (is_array($detail) && !empty($detail['id'])) { update_post_meta($detail['id'], '_fco_creation_outcome', array_intersect_key($detail, array_flip(['creation_connection','creation_invitation']))); }
            return $detail;
        } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); }
    }
    private static function create_new($request, $creation_key = '') {
        $p = $request->get_json_params();
        if (!is_array($p)) { return self::error('Enter the project details.'); }
        $limits = ['client_name'=>200,'contact_name'=>200,'email'=>254,'welcome'=>5000,'note'=>10000,'logo_url'=>2048,'accent'=>20,'pairing_code'=>2000];
        foreach ($limits as $key=>$limit) {
            if (isset($p[$key]) && (!is_string($p[$key]) || strlen($p[$key])>$limit)) { return self::error('Please check the '.str_replace('_',' ',$key).' field.'); }
        }
        $name = sanitize_text_field($p['client_name'] ?? '');
        if ($name === '') { return self::error('Enter the client or company name.'); }
        if (!empty($p['email']) && !is_email($p['email'])) { return self::error('Enter a valid contact email.'); }
        $collaborators = array_key_exists('collaborators',$p) ? self::normalise_collaborators_input($p['collaborators']) : [];
        if (is_wp_error($collaborators)) { return $collaborators; }
        if (isset($p['send_invitation']) && !is_bool($p['send_invitation'])) { return self::error('Choose whether to send the invitation now.'); }
        $send_invitation = ($p['send_invitation'] ?? false) === true;
        if ($send_invitation && !$collaborators && !is_email($p['email'] ?? '')) { return self::error('Add at least one collaborator with a valid email address before sending the invitation.'); }
        $pairing = trim($p['pairing_code'] ?? '');
        $id = wp_insert_post(['post_type'=>'ink_onboard','post_status'=>'private','post_title'=>$name,'post_author'=>get_current_user_id()],true);
        if (is_wp_error($id)) { return $id; }
        if ($creation_key !== '') { update_post_meta($id, '_fco_creation_key', $creation_key); }
        $m = self::meta($id); $m['client_name']=$name; $m['uuid']=wp_generate_uuid4(); self::set_meta($id,$m);
        FCO_CPT::update_project_data($id,['project'=>['id'=>$id,'company_name'=>$name,'wizard_complete'=>false],'branding'=>['company_name'=>$name],'pages'=>[],'drafts'=>[],'comments'=>[]]);
        self::row($id); self::audit($id,'Project created');
        $request->set_param('id',$id);
        $detail = self::settings($request);
        if (is_wp_error($detail)) { return $detail; }
        $creation_connection = null;
        if ($pairing !== '') {
        // Pairing is a handshake only. Delivery still requires separate staff approval.
        // Keep the created project if the destination is offline; never persist the raw code.
        $pair_request = new WP_REST_Request('POST');
        $pair_request->set_param('id',$id);
        $pair_request->set_header('Content-Type','application/json');
        $pair_request->set_body(wp_json_encode(['pairing_code'=>$pairing]));
        $result = FCO_Hub_Delivery::connect($pair_request);
        if (is_wp_error($result)) {
            self::audit($id,'Project created; connection needs attention');
            $creation_connection = ['status'=>'failed','message'=>$result->get_error_message()];
        } else {
            $creation_connection = ['status'=>'connected'];
        }
        }
        // An invitation opens the Inkfire workspace, independently of build pairing.
        $invitation = ['status'=>'not_requested','message'=>'Project created without sending an invitation.'];
        if ($send_invitation) {
            try {
                $mail_request = new WP_REST_Request('POST');
                $mail_request->set_param('id',$id);
                $mail_request->set_header('Content-Type','application/json');
                $mail_request->set_body(wp_json_encode(['expected_recipients'=>self::collaborator_emails($id)]));
                // Project creation already has its own idempotency key and stored outcome,
                // so call the transport directly instead of the manual resend receipt layer.
                $sent = self::invite_now($mail_request);
                $invitation = is_wp_error($sent)
                    ? ['status'=>'failed','message'=>$sent->get_error_message()]
                    : ['status'=>'accepted','message'=>$sent['message']];
            } catch (Throwable $e) {
                $invitation = ['status'=>'failed','message'=>'The project was saved, but its invitation could not be confirmed. Check the invitation panel before retrying.'];
                self::audit($id, 'Project created; invitation needs attention');
            }
        }
        $detail = self::detail($request);
        if ($creation_connection !== null) { $detail['creation_connection']=$creation_connection; }
        $detail['creation_invitation']=$invitation;
        return $detail;
    }
    public static function settings($request) {
        $id = absint($request['id']); if (!self::valid_project($id)) { return self::error('Project not found.',404); }
        $p = $request->get_json_params(); $m = self::meta($id); $old_name = $m['client_name'];
        foreach (['client_name','contact_name','welcome','note'] as $k) { if (isset($p[$k])) { $m[$k]=sanitize_textarea_field($p[$k]); } }
        if (array_key_exists('collaborators',$p)) {
            $collaborators = self::normalise_collaborators_input($p['collaborators']);
            if (is_wp_error($collaborators)) { return $collaborators; }
            $m['collaborators'] = $collaborators;
            $m['email'] = $collaborators[0]['email'] ?? '';
        } elseif (isset($p['email'])) {
            if ($p['email'] !== '' && !is_email($p['email'])) { return self::error('Enter a valid contact email.'); }
            $m['email']=sanitize_email($p['email']);
        }
        if (isset($p['logo_url'])) { $m['logo_url']=esc_url_raw($p['logo_url'],['https']); }
        if (isset($p['accent'])) { $m['accent']=sanitize_hex_color($p['accent']) ?: '#32b190'; }
        if (!$m['uuid']) { $m['uuid']=wp_generate_uuid4(); }
        if ($old_name !== $m['client_name'] && empty($m['last_invited'])) {
            $row = self::row($id); $data = json_decode($row['payload'],true);
            if (empty($data['branding']['company_name']) || $data['branding']['company_name'] === $old_name) {
                $data['branding']['company_name'] = $m['client_name'];
                global $wpdb;
                $updated = $wpdb->query($wpdb->prepare('UPDATE '.self::table('state').' SET payload=%s,revision=revision+1,updated_at=%s WHERE project_id=%d AND revision=%d',wp_json_encode($data),gmdate('Y-m-d H:i:s'),$id,(int)$row['revision']));
                if (!$updated) { return self::error('This project changed. Refresh and save the settings again.',409); }
            }
        }
        self::set_meta($id,$m);
        if ($m['client_name']) { wp_update_post(['ID'=>$id,'post_title'=>$m['client_name']]); }
        self::audit($id,'Project settings saved');
        return self::detail($request);
    }
    public static function detail($request) {
        $id = absint($request['id']); if (get_post_type($id) !== 'ink_onboard') { return self::error('Project not found.',404); }
        $m = self::meta($id); $r = self::row($id);
        if (get_post_status($id) === 'trash') { $m['status'] = 'trash'; $m['active'] = false; }
        global $wpdb;
        $subs = $wpdb->get_results($wpdb->prepare('SELECT id,revision,created_at FROM ' . self::table('submissions') . ' WHERE project_id=%d ORDER BY id DESC LIMIT 20',$id),ARRAY_A);
        $jobs = $wpdb->get_results($wpdb->prepare('SELECT id,revision,status,attempts,report,created_at FROM ' . self::table('deliveries') . ' WHERE project_id=%d ORDER BY created_at DESC LIMIT 20',$id),ARRAY_A);
        foreach ($jobs as &$job) { $job['report']=json_decode($job['report'],true) ?: []; } unset($job);
        $link = ''; $encrypted = get_post_meta($id,'_fco_link_encrypted',true);
        if ($m['active'] && $encrypted) { $token=self::crypt($encrypted,true); if ($token) { $link=self::portal_url().'#access='.$token; } }
        return ['id'=>$id,'settings'=>$m,'link'=>$link,'revision'=>(int)($r['revision'] ?? 0),'data'=>$r ? json_decode($r['payload'],true) : [],'submissions'=>$subs,'deliveries'=>$jobs,'events'=>get_post_meta($id,'_fco_events',true) ?: [],'connection'=>FCO_Hub_Delivery::public_connection($id),'assets'=>FCO_Hub_Assets::listing_for($id),'invitation_schedule'=>FCO_Hub_Invitation_Scheduler::public_record($id),'email_history'=>FCO_Hub_Email_History::for_project($id)];
    }
    public static function portal_url() { $id=(int)get_option('fco_portal_page_id'); return $id ? get_permalink($id) : home_url('/onboarding/'); }
    public static function link($request) {
        $id = absint($request['id']); if (!self::valid_project($id)) { return self::error('Project not found.',404); }
        $m=self::meta($id); $p=$request->get_json_params();
        if (($p['action'] ?? '') === 'revoke') {
            $m['active']=false; $m['link_version']++; self::set_meta($id,$m);
            delete_post_meta($id,'_fco_link_hash'); delete_post_meta($id,'_fco_link_encrypted');
            self::audit($id,'Invitation revoked'); return ['success'=>true,'link'=>''];
        }
        if ($m['status']==='archived') { return self::error('Archived projects cannot be invited.'); }
        $token=bin2hex(random_bytes(32)); $cipher=self::crypt($token);
        if (!$cipher) { return self::error('Secure link storage is unavailable.',500); }
        $m['active']=true; $m['link_version']++; $m['last_invite_status']='not_sent';
        update_post_meta($id,'_fco_link_hash',hash('sha256',$token)); update_post_meta($id,'_fco_link_encrypted',$cipher); self::set_meta($id,$m);
        self::audit($id,'Invitation link created or replaced');
        return ['success'=>true,'link'=>self::portal_url().'#access='.$token];
    }
    public static function invite($request) {
        return FCO_Hub_Invitation_Scheduler::manual($request);
    }
    /** Internal transport path; scheduled callers must hold the project lock. */
    public static function invite_now($request) {
        $id=absint($request['id']); if (!self::valid_project($id)) { return self::error('Project not found.',404); }
        $m=self::meta($id); $collaborators=self::collaborators($m);
        if ($m['status']==='archived') { return self::error('Reopen this project before inviting the client.',409); }
        if (!$collaborators) { return self::error('Add at least one project collaborator with a valid email address first.'); }
        $expected = $request->get_param('expected_recipients');
        if ($expected !== null) {
            if (!is_array($expected) || array_values($expected) !== $expected) { return self::error('The collaborator list changed. Refresh before sending.',409); }
            $expected = array_map('strtolower', array_map('sanitize_email', $expected));
            $current = array_map('strtolower', self::collaborator_emails($m));
            if ($expected !== $current) { return self::error('The collaborator list changed. Check the recipients before sending.',409); }
        }
        $legacy_expected = $request->get_param('expected_email');
        if ($legacy_expected !== null && count($collaborators)===1 && (!is_string($legacy_expected) || strcasecmp(trim($legacy_expected),$collaborators[0]['email'])!==0)) { return self::error('The client email changed. Check the current recipient before sending.',409); }
        if (!$m['active']) { $generated=self::link($request); if (is_wp_error($generated)) { return $generated; } $m=self::meta($id); }
        $token=self::crypt(get_post_meta($id,'_fco_link_encrypted',true),true);
        if (!$token) { return self::error('Replace the invitation link before sending.'); }
        if (self::limited('invite:'.$id,5,HOUR_IN_SECONDS)) { return self::error('Five invitation batches have already been sent for this project in the last hour.',429); }
        $link=self::portal_url().'#access='.$token;
        $subject='Your Inkfire onboarding space: '.$m['client_name'];
        $m['last_invite_attempt']=gmdate('c');
        $m['last_invite_status']='pending'; self::set_meta($id,$m);
        $accepted=[]; $failed=[];
        foreach ($collaborators as $collaborator) {
            $email_receipt=FCO_Hub_Email_History::begin($id,$collaborator['email'],$subject,!empty($m['last_invited']));
            if (is_wp_error($email_receipt)) { $failed[]=$collaborator['email']; continue; }
            $recipient_meta=$m; $recipient_meta['contact_name']=$collaborator['name'];
            $member_link=$link.'&member='.rawurlencode($collaborator['id']);
            try { $sent=FCO_Hub_Invitation_Email::send($collaborator['email'],$subject,$recipient_meta,$member_link); }
            catch (Throwable $error) { FCO_Hub_Email_History::finish($email_receipt,'uncertain'); throw $error; }
            FCO_Hub_Email_History::finish($email_receipt,$sent?'accepted':'failed');
            if ($sent) { $accepted[]=$collaborator['email']; } else { $failed[]=$collaborator['email']; }
        }
        if (!$accepted) { $m['last_invite_status']='failed'; self::set_meta($id,$m); self::audit($id,'Invitation email batch failed',implode(', ',$failed)); return self::error('The email service did not accept any invitations. Your project is saved; check Email history before retrying.',502); }
        $m['last_invited']=gmdate('c'); $m['last_invited_email']=$accepted[0]; $m['last_invited_recipients']=$accepted; $m['last_invite_status']=$failed?'partial':'accepted'; $m['last_invited_version']=(int)$m['link_version'];
        if ($m['status']==='draft') { $m['status']='invited'; } self::set_meta($id,$m);
        self::audit($id,$failed?'Invitation batch partially accepted by mail service':'Invitation batch accepted by mail service',implode(', ',$accepted));
        $message=count($accepted).' invitation'.(count($accepted)===1?'':'s').' accepted by the mail service.';
        if ($failed) { $message.=' '.count($failed).' recipient'.(count($failed)===1?'':'s').' need attention in Email history.'; }
        return ['success'=>true,'accepted'=>$accepted,'failed'=>$failed,'partial'=>(bool)$failed,'message'=>$message.' Inbox delivery is not confirmed.'];
    }
    private static function normalise_extra_questions($questions) {
        if (!is_array($questions) || array_values($questions) !== $questions) { return self::error('Project-specific questions must be a list.'); }
        if (count($questions) > 100) { return self::error('A project can contain up to 100 project-specific questions.'); }
        $out = []; $seen = [];
        foreach ($questions as $question) {
            if (!is_array($question)) { return self::error('Each project-specific question must contain named fields.'); }
            $id = sanitize_key((string)($question['id'] ?? ''));
            if ($id === '') { $id = 'q_' . str_replace('-', '', wp_generate_uuid4()); }
            if (!preg_match('/^[a-z0-9_\-]{3,80}$/D',$id) || isset($seen[$id])) { return self::error('Each project-specific question needs a unique valid ID.'); }
            $seen[$id] = true;
            $title = sanitize_text_field((string)($question['title'] ?? ''));
            $help = sanitize_textarea_field((string)($question['help'] ?? ''));
            $type = sanitize_key((string)($question['type'] ?? 'textarea'));
            if ($title === '' || strlen($title) > 240) { return self::error('Each project-specific question needs a title of 240 characters or fewer.'); }
            if (strlen($help) > 2000) { return self::error('Project-specific question guidance must be 2,000 characters or fewer.'); }
            if (!in_array($type,['text','textarea','single','multi'],true)) { return self::error('Choose a supported project-specific question type.'); }
            $options = [];
            if (in_array($type,['single','multi'],true)) {
                $raw_options = $question['options'] ?? [];
                if (!is_array($raw_options) || array_values($raw_options) !== $raw_options || count($raw_options) > 30) { return self::error('Choice questions can contain up to 30 options.'); }
                foreach ($raw_options as $option) {
                    if (!is_string($option)) { return self::error('Choice options must be text.'); }
                    $option = sanitize_text_field($option);
                    if ($option === '' || strlen($option) > 200) { return self::error('Choice options must be between 1 and 200 characters.'); }
                    $options[] = $option;
                }
                $options = array_values(array_unique($options));
                if (count($options) < 2) { return self::error('Choice questions need at least two different options.'); }
            }
            $library_id = sanitize_key((string)($question['library_id'] ?? ''));
            if ($library_id !== '' && !preg_match('/^lib_[a-z0-9]{12,64}$/D',$library_id)) { $library_id = ''; }
            $row = ['id'=>$id,'title'=>$title,'help'=>$help,'type'=>$type,'options'=>$options];
            if ($library_id !== '') { $row['library_id'] = $library_id; }
            $out[] = $row;
        }
        return $out;
    }
    private static function question_library_rows() {
        $rows = get_option('fco_question_library_v1', []);
        if (!is_array($rows)) { return []; }
        $out=[];
        foreach ($rows as $row) {
            if (!is_array($row)) { continue; }
            $row['fingerprint']=self::question_library_fingerprint($row);
            $out[]=$row;
        }
        return array_values($out);
    }
    private static function question_library_fingerprint($question) {
        $copy = [
            'title'=>(string)($question['title'] ?? ''),
            'help'=>(string)($question['help'] ?? ''),
            'type'=>(string)($question['type'] ?? 'textarea'),
            'options'=>array_values(is_array($question['options'] ?? null)?$question['options']:[]),
        ];
        return hash('sha256', wp_json_encode($copy));
    }
    private static function touch_question_library_usage(&$item, $project_id) {
        $project_id = absint($project_id);
        if (!$project_id || !self::valid_project($project_id)) { return false; }
        $client = sanitize_text_field(self::meta($project_id)['client_name'] ?: get_the_title($project_id));
        $now = gmdate('c');
        $usage = is_array($item['usage'] ?? null) ? $item['usage'] : [];
        $found = false; $changed = false;
        foreach ($usage as &$record) {
            if (!is_array($record) || (int)($record['project_id'] ?? 0) !== $project_id) { continue; }
            $found = true;
            if (($record['client_name'] ?? '') !== $client) { $record['client_name']=$client; $changed=true; }
            $record['last_used_at']=$now; $changed=true;
            if (empty($record['first_used_at'])) { $record['first_used_at']=$now; }
            break;
        } unset($record);
        if (!$found) {
            $usage[]=['project_id'=>$project_id,'client_name'=>$client,'first_used_at'=>$now,'last_used_at'=>$now];
            $changed=true;
        }
        $item['usage']=array_slice(array_values($usage),-100);
        if ($changed) { $item['updated_at']=$now; }
        return $changed;
    }
    private static function mark_question_library_usage($project_id, $questions) {
        $ids=[];
        foreach ((array)$questions as $question) {
            $library_id=sanitize_key((string)($question['library_id'] ?? ''));
            if ($library_id!=='') { $ids[$library_id]=true; }
        }
        if (!$ids) { return; }
        $rows=self::question_library_rows(); $changed=false;
        foreach ($rows as &$item) {
            if (!isset($ids[(string)($item['id'] ?? '')])) { continue; }
            if (self::touch_question_library_usage($item,$project_id)) { $changed=true; }
        } unset($item);
        if ($changed) { update_option('fco_question_library_v1',$rows,false); }
    }
    public static function question_library($request) {
        $rows=self::question_library_rows();
        if ($request->get_method()==='GET') {
            usort($rows,static function($a,$b){ return strcmp((string)($b['updated_at']??''),(string)($a['updated_at']??'')); });
            return ['items'=>$rows,'count'=>count($rows)];
        }
        $p=$request->get_json_params();
        if (!is_array($p)) { return self::error('Add a project and question to save to the library.'); }
        $project_id=absint($p['project_id'] ?? 0);
        if (!self::valid_project($project_id)) { return self::error('Project not found.',404); }
        $normalised=self::normalise_extra_questions([is_array($p['question'] ?? null)?$p['question']:[]]);
        if (is_wp_error($normalised)) { return $normalised; }
        $question=$normalised[0]; unset($question['id'],$question['library_id']);
        $fingerprint=self::question_library_fingerprint($question);
        $now=gmdate('c'); $match=null;
        foreach ($rows as $i=>&$item) {
            if (($item['fingerprint'] ?? '')!==$fingerprint) { continue; }
            self::touch_question_library_usage($item,$project_id);
            $match=$i; break;
        } unset($item);
        if ($match===null) {
            if (count($rows)>=500) { return self::error('The question library has reached 500 items. Archive or consolidate old items before adding more.',409); }
            $item=array_merge([
                'id'=>'lib_'.bin2hex(random_bytes(12)),
                'fingerprint'=>$fingerprint,
                'created_at'=>$now,
                'updated_at'=>$now,
                'created_by'=>get_current_user_id(),
                'usage'=>[],
            ],$question);
            self::touch_question_library_usage($item,$project_id);
            $rows[]=$item; $match=count($rows)-1;
        }
        if (!update_option('fco_question_library_v1',$rows,false) && get_option('fco_question_library_v1',[])!==$rows) {
            return self::error('The question library could not be saved. Please try again.',503);
        }
        self::audit($project_id,'Question saved to reusable library',sanitize_text_field($rows[$match]['title'] ?? ''));
        return ['success'=>true,'item'=>$rows[$match],'library_id'=>$rows[$match]['id'],'count'=>count($rows)];
    }
    public static function questions($request) {
        $id = absint($request['id']);
        if (!self::valid_project($id)) { return self::error('Project not found.',404); }
        $row = self::row($id);
        if (!$row) { return self::error('The project could not be loaded.',503); }
        $data = json_decode($row['payload'],true); $data = is_array($data) ? $data : [];
        $project = is_array($data['project'] ?? null) ? $data['project'] : [];
        if ($request->get_method() === 'GET') {
            return ['revision'=>(int)$row['revision'],'questions'=>array_values(is_array($project['extra_questions'] ?? null)?$project['extra_questions']:[]),'answers'=>is_array($project['extra_question_answers'] ?? null)?$project['extra_question_answers']:(object)[]];
        }
        $p = $request->get_json_params();
        if (!is_array($p) || !isset($p['revision']) || !is_numeric($p['revision'])) { return self::error('Refresh the project before saving questions.',409,'fco_conflict'); }
        if ((int)$p['revision'] !== (int)$row['revision']) { return self::error('This project changed in another tab. Refresh before saving questions.',409,'fco_conflict'); }
        $questions = self::normalise_extra_questions($p['questions'] ?? []);
        if (is_wp_error($questions)) { return $questions; }
        $data['project'] = $project;
        $data['project']['extra_questions'] = $questions;
        if (!isset($data['project']['extra_question_answers']) || !is_array($data['project']['extra_question_answers'])) { $data['project']['extra_question_answers'] = []; }
        $clean = self::clean($data,$id); if (is_wp_error($clean)) { return $clean; }
        global $wpdb; $now = gmdate('Y-m-d H:i:s');
        $updated = $wpdb->query($wpdb->prepare('UPDATE '.self::table('state').' SET payload=%s,revision=revision+1,updated_at=%s WHERE project_id=%d AND revision=%d',wp_json_encode($clean),$now,$id,(int)$row['revision']));
        if ($updated !== 1) { return self::error('This project changed while the questions were being saved. Refresh and try again.',409,'fco_conflict'); }
        FCO_CPT::update_project_data($id,$clean);
        self::mark_question_library_usage($id,$questions);
        self::audit($id,'Project-specific questions updated',count($questions).' optional question'.(count($questions)===1?'':'s'));
        return ['success'=>true,'revision'=>(int)$row['revision']+1,'questions'=>$questions,'updated_at'=>$now];
    }
    public static function archive($request) {
        return FCO_Hub_Lifecycle::archive($request);
    }
    public static function submit($request) {
        $id=absint($request['project_id']); $r=self::row($id); $p=$request->get_json_params();
        if (!$r || (int)($p['revision'] ?? 0)!==(int)$r['revision']) { return self::error('Save the latest changes before submitting.',409,'fco_conflict'); }
        $existing=self::submission_state($id,json_decode($r['payload'],true));
        if ($existing && $existing['current']) { return ['success'=>true,'revision'=>$existing['revision'],'already_submitted'=>true,'submission'=>$existing]; }
        global $wpdb;
        $wpdb->query($wpdb->prepare('INSERT IGNORE INTO '.self::table('submissions').' (project_id,revision,payload,created_at) VALUES (%d,%d,%s,%s)',$id,$r['revision'],$r['payload'],gmdate('Y-m-d H:i:s')));
        if ($wpdb->last_error) { return self::error('Submission could not be saved.',500); }
        $m=self::meta($id); $m['status']='submitted'; $m['last_submitted']=gmdate('c'); self::set_meta($id,$m); self::audit($id,'Content submitted for review','Revision '.$r['revision']);
        try { $accepted=wp_mail('support@inkfire.co.uk','Onboarding submitted: '.sanitize_text_field($m['client_name']),
            "A client has submitted onboarding content for Inkfire review.\n\nProject: ".sanitize_text_field($m['client_name'])."\nRevision: ".(int)$r['revision']."\nReview: ".admin_url('admin.php?page=fco-onboarding&project='.$id)."\n\nContent remains private. Submission does not publish or approve delivery.",['Content-Type: text/plain; charset=UTF-8']); } catch (Throwable $error) { $accepted=false; }
        self::audit($id,$accepted?'Submission notification accepted by mail service':'Submission notification failed','Revision '.$r['revision']);
        return ['success'=>true,'revision'=>(int)$r['revision'],'submission'=>self::submission_state($id,json_decode($r['payload'],true))];
    }
    public static function is_route($route) { return strpos($route,'/'.self::NS.'/')===0 || strpos($route,'/inkfire/v1/project/')===0; }
    public static function headers($response,$server,$request) {
        if (self::is_route($request->get_route()) && $response instanceof WP_REST_Response) {
            if (!defined('DONOTCACHEPAGE')) { define('DONOTCACHEPAGE', true); }
            do_action('litespeed_control_set_nocache', 'Private onboarding project API');
            $response->header('X-LiteSpeed-Cache-Control', 'no-cache');
            $response->header('Cache-Control','no-store, private, max-age=0'); $response->header('X-Robots-Tag','noindex, nofollow, noarchive'); $response->header('Referrer-Policy','no-referrer'); $response->header('X-Content-Type-Options','nosniff');
        }
        return $response;
    }
    public static function cors($served,$result,$request,$server) {
        if (self::is_route($request->get_route())) { header_remove('Access-Control-Allow-Origin'); header_remove('Access-Control-Allow-Credentials'); }
        return $served;
    }
}
