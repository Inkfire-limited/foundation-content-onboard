<?php
/** Private, bounded answer recovery journal. Never used as authoritative project state. */
if (!defined('ABSPATH')) { exit; }

final class FCO_Hub_Save_Recovery {
    const DAYS = 14;
    const COPIES = 50;
    public static function init() {
        add_action('init', [__CLASS__, 'install'], 2);
        add_action('fco_recovery_cleanup', [__CLASS__, 'cleanup']);
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_action('admin_menu', function() {
            add_submenu_page('fco-onboarding', 'Save recovery', 'Save recovery', 'manage_options', 'fco-save-recovery', [__CLASS__, 'admin']);
        }, 50);
    }
    public static function install() {
        if (get_option('fco_recovery_schema') !== '1') {
            global $wpdb;
            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
            $collate = $wpdb->get_charset_collate();
            dbDelta('CREATE TABLE ' . FCO_Hub::table('save_attempts') . " (
                id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
                project_id bigint(20) unsigned NOT NULL,
                request_id varchar(32) NOT NULL,
                client_id varchar(64) NOT NULL DEFAULT '',
                base_revision bigint(20) unsigned NOT NULL DEFAULT 0,
                saved_revision bigint(20) unsigned NOT NULL DEFAULT 0,
                http_status smallint unsigned NOT NULL DEFAULT 0,
                error_code varchar(100) NOT NULL DEFAULT '',
                payload longtext NOT NULL,
                checksum char(64) NOT NULL,
                created_at datetime NOT NULL,
                PRIMARY KEY  (id),
                KEY project_id (project_id),
                KEY created_at (created_at)
            ) $collate;");
            if (!$wpdb->last_error) { update_option('fco_recovery_schema', '1', false); }
        }
        if (!wp_next_scheduled('fco_recovery_cleanup')) { wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', 'fco_recovery_cleanup'); }
    }
    /** Called only after the existing project/session/CSRF permission check. */
    public static function begin($request, $reference) {
        global $wpdb;
        $p = $request->get_json_params();
        $id = absint($request->get_param('project_id'));
        if (!FCO_Hub::valid_project($id) || !is_array($p['data'] ?? null)) { return false; }
        $data = $p['data'];
        unset($data['_hub']); // Credentials and request headers are never journalled.
        $json = wp_json_encode($data);
        if ($json === false || strlen($json) > 4 * 1024 * 1024) { return false; }
        $encrypted = FCO_Hub::crypt($json, false, 'answer-recovery');
        if (!$encrypted) { return false; }
        $ok = $wpdb->insert(FCO_Hub::table('save_attempts'), [
            'project_id'=>$id, 'request_id'=>$reference,
            'client_id'=>substr(sanitize_key((string)($p['client_save_id'] ?? '')), 0, 64),
            'base_revision'=>absint($p['revision'] ?? 0), 'payload'=>$encrypted,
            'checksum'=>hash('sha256', $json), 'created_at'=>gmdate('Y-m-d H:i:s'),
        ]);
        if (!$ok) { return false; }
        $attempt = (int)$wpdb->insert_id;
        // Bound storage per project as well as by age. Never modify project answers.
        $older = $wpdb->get_col($wpdb->prepare('SELECT id FROM '.FCO_Hub::table('save_attempts').' WHERE project_id=%d ORDER BY id DESC LIMIT 200 OFFSET %d', $id, self::COPIES));
        if ($older) { $wpdb->query('DELETE FROM '.FCO_Hub::table('save_attempts').' WHERE project_id='.(int)$id.' AND id IN ('.implode(',', array_map('absint', $older)).')'); }
        return $attempt;
    }
    public static function finish($attempt, $result) {
        if (!$attempt) { return; }
        global $wpdb;
        $error = is_wp_error($result);
        $detail = $error ? $result->get_error_data() : [];
        $wpdb->update(FCO_Hub::table('save_attempts'), [
            'http_status'=>$error ? (int)($detail['status'] ?? 500) : 200,
            'error_code'=>$error ? sanitize_key($result->get_error_code()) : '',
            'saved_revision'=>$error ? 0 : absint($result['revision'] ?? 0),
        ], ['id'=>(int)$attempt]);
    }
    public static function cleanup() {
        global $wpdb;
        $wpdb->query($wpdb->prepare('DELETE FROM '.FCO_Hub::table('save_attempts').' WHERE created_at < %s', gmdate('Y-m-d H:i:s', time() - self::DAYS * DAY_IN_SECONDS)));
    }
    public static function routes() {
        register_rest_route(FCO_Hub::NS, '/projects/(?P<project_id>\d+)/save-attempts', [
            'methods'=>'GET', 'permission_callback'=>['FCO_Hub','manager'], 'callback'=>[__CLASS__,'listing'],
        ]);
        register_rest_route(FCO_Hub::NS, '/projects/(?P<project_id>\d+)/save-attempts/(?P<attempt_id>\d+)', [
            'methods'=>'GET', 'permission_callback'=>['FCO_Hub','manager'], 'callback'=>[__CLASS__,'read'],
        ]);
    }
    public static function listing($request) {
        if (!FCO_Hub::manager()) { return FCO_Hub::error('Staff access required.', 403); }
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare('SELECT id,project_id,request_id,client_id,base_revision,saved_revision,http_status,error_code,checksum,created_at FROM '.FCO_Hub::table('save_attempts').' WHERE project_id=%d AND created_at >= %s ORDER BY id DESC LIMIT %d', absint($request['project_id']), gmdate('Y-m-d H:i:s', time()-self::DAYS*DAY_IN_SECONDS), self::COPIES), ARRAY_A);
    }
    public static function read($request) {
        if (!FCO_Hub::manager()) { return FCO_Hub::error('Staff access required.', 403); }
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM '.FCO_Hub::table('save_attempts').' WHERE id=%d AND project_id=%d AND created_at >= %s', absint($request['attempt_id']), absint($request['project_id']), gmdate('Y-m-d H:i:s', time()-self::DAYS*DAY_IN_SECONDS)), ARRAY_A);
        if (!$row) { return FCO_Hub::error('Recovery copy unavailable.', 404); }
        $json = FCO_Hub::crypt($row['payload'], true, 'answer-recovery');
        if (!is_string($json) || !hash_equals($row['checksum'], hash('sha256', $json))) { return FCO_Hub::error('Recovery copy could not be verified.', 503); }
        unset($row['payload']);
        return ['attempt'=>$row, 'data'=>json_decode($json, true)];
    }
    public static function admin() {
        if (!FCO_Hub::manager()) { return; }
        nocache_headers();
        $id = absint($_GET['project_id'] ?? 0);
        echo '<div class="wrap"><h1>Onboarding save recovery</h1><p>Private encrypted answer copies: up to 50 attempts per project for 14 days. Failed saves are retained too. These copies never replace project content automatically.</p><form method="get"><input type="hidden" name="page" value="fco-save-recovery"><label>Project ID <input type="number" min="1" name="project_id" value="'.esc_attr($id).'"></label> <button class="button">View copies</button></form>';
        if ($id) {
            $items = self::listing(['project_id'=>$id]);
            echo '<table class="widefat striped"><thead><tr><th>UTC time</th><th>Reference</th><th>Result</th><th>Answers</th></tr></thead><tbody>';
            foreach ($items as $row) {
                $url = rest_url(FCO_Hub::NS.'/projects/'.$id.'/save-attempts/'.$row['id']);
                $url = add_query_arg('_wpnonce', wp_create_nonce('wp_rest'), $url);
                echo '<tr><td>'.esc_html($row['created_at']).'</td><td>'.esc_html($row['request_id']).'</td><td>'.esc_html($row['http_status'].' '.$row['error_code']).'</td><td><a href="'.esc_url($url).'" target="_blank" rel="noopener noreferrer">View recovery JSON</a></td></tr>';
            }
            echo '</tbody></table><p>Compare copies with the current project before restoring any answers. Never import an older copy over newer work without reviewing the differences.</p>';
        }
        echo '</div>';
    }
}
