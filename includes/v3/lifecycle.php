<?php
/** Project lifecycle. Never deletes content already delivered to another website. */
if (!defined('ABSPATH')) { exit; }
final class FCO_Hub_Lifecycle {
    private static $locks = [];
    private static $request_locks = [];
    private static $permanent_id = 0;
    public static function init() {
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_filter('rest_request_before_callbacks', [__CLASS__, 'before_request'], 15, 3);
        add_filter('rest_request_after_callbacks', [__CLASS__, 'after_request'], 15, 3);
        add_action('transition_post_status', [__CLASS__, 'transition'], 10, 3);
        add_filter('wp_untrash_post_status', [__CLASS__, 'restore_private'], 10, 3);
        add_filter('pre_delete_post', [__CLASS__, 'protect_deletion'], 99, 3);
        add_action('before_delete_post', [__CLASS__, 'remove_project_data'], 10, 2);
    }
    public static function routes() {
        foreach (['trash', 'restore', 'unarchive', 'delete'] as $action) {
            register_rest_route(FCO_Hub::NS, '/projects/(?P<id>\d+)/'.$action, [
                'methods'=>'POST', 'permission_callback'=>[__CLASS__, 'permission'],
                'callback'=>[__CLASS__, $action],
            ]);
        }
    }
    public static function permission($r) { return FCO_Hub::manager() && FCO_Hub::origin_ok($r); }
    public static function acquire($id) {
        $id = (int)$id;
        if (isset(self::$locks[$id])) { self::$locks[$id]++; return true; }
        global $wpdb;
        $key = 'fco_project_'.substr(hash('sha256', $wpdb->prefix.':'.$id), 0, 40);
        if ((int)$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s,0)', $key)) !== 1) { return false; }
        self::$locks[$id] = 1; return true;
    }
    public static function release($id) {
        $id = (int)$id;
        if (!isset(self::$locks[$id])) { return; }
        if (--self::$locks[$id] > 0) { return; }
        unset(self::$locks[$id]);
        global $wpdb;
        $key = 'fco_project_'.substr(hash('sha256', $wpdb->prefix.':'.$id), 0, 40);
        $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $key));
    }
    public static function before_request($response, $handler, $r) {
        if ($response !== null || !FCO_Hub::is_route($r->get_route()) || !in_array($r->get_method(), ['POST','PUT','PATCH','DELETE'], true)) { return $response; }
        $id = absint($r->get_param('id') ?: $r->get_param('project_id'));
        if (!$id || get_post_type($id) !== 'ink_onboard') { return $response; }
        if (!self::acquire($id)) { return FCO_Hub::error('This project is being saved or transferred. Please retry in a moment.', 409, 'fco_project_busy'); }
        self::$request_locks[spl_object_hash($r)] = $id; return $response;
    }
    public static function after_request($response, $handler, $r) {
        $key = spl_object_hash($r);
        if (isset(self::$request_locks[$key])) { self::release(self::$request_locks[$key]); unset(self::$request_locks[$key]); }
        return $response;
    }
    private static function pause($id, $reason) {
        $m = FCO_Hub::meta($id);
        $m['active'] = false; $m['link_version'] = (int)$m['link_version'] + 1;
        FCO_Hub::set_meta($id, $m);
        delete_post_meta($id, '_fco_link_hash'); delete_post_meta($id, '_fco_link_encrypted');
        $connection = FCO_Hub_Delivery::connection($id);
        if ($connection) { $connection['version'] = wp_generate_uuid4(); update_post_meta($id, '_fco_connection', $connection); }
        global $wpdb;
        $jobs = $wpdb->get_results($wpdb->prepare('SELECT id,status,report FROM '.FCO_Hub::table('deliveries').' WHERE project_id=%d', $id), ARRAY_A);
        foreach ($jobs as $job) {
            wp_clear_scheduled_hook('fco_hub_delivery', [$job['id']]);
            if (!in_array($job['status'], ['pending','running','failed','attention'], true)) { continue; }
            $report = json_decode($job['report'], true) ?: [];
            $report['cancelled_at'] = gmdate('c'); $report['error'] = $reason;
            $ok = $wpdb->update(FCO_Hub::table('deliveries'), ['status'=>'cancelled','report'=>wp_json_encode($report)], ['id'=>$job['id'],'project_id'=>$id]);
            if ($ok === false) { throw new RuntimeException('Could not cancel the project delivery queue. Please retry.'); }
        }
    }
    public static function transition($new, $old, $post) {
        if ($post->post_type !== 'ink_onboard' || $new === $old) { return; }
        $id = $post->ID; $m = FCO_Hub::meta($id);
        if ($new === 'trash') {
            update_post_meta($id, '_fco_before_trash_status', $m['status']);
            $m['status'] = 'trash'; FCO_Hub::set_meta($id, $m);
            self::pause($id, 'Project moved to Trash. Review a new delivery after restoring it.');
            FCO_Hub::audit($id, 'Project moved to Trash');
        } elseif ($old === 'trash') {
            $previous = get_post_meta($id, '_fco_before_trash_status', true);
            $m['status'] = in_array($previous, ['draft','in_progress','submitted','archived'], true) ? $previous : 'in_progress';
            $m['active'] = false; FCO_Hub::set_meta($id, $m);
            delete_post_meta($id, '_fco_before_trash_status');
            self::pause($id, 'Project restored. Previous deliveries remain cancelled.');
            FCO_Hub::audit($id, 'Project restored from Trash', 'Client access remains disabled until a new invitation is issued.');
        }
    }
    public static function restore_private($status, $id, $previous) { return get_post_type($id) === 'ink_onboard' ? 'private' : $status; }
    public static function protect_deletion($check, $post, $force) {
        if ($post->post_type !== 'ink_onboard' || $check !== null) { return $check; }
        // Project Trash is retained until an explicit permanent deletion in this dashboard.
        return self::$permanent_id === (int)$post->ID && $post->post_status === 'trash' ? null : false;
    }
    public static function remove_project_data($id, $post) {
        if ($post->post_type !== 'ink_onboard' || self::$permanent_id !== (int)$id) { return; }
        global $wpdb;
        $files = $wpdb->get_col($wpdb->prepare('SELECT storage FROM '.FCO_Hub::table('assets').' WHERE project_id=%d', $id));
        $directory = WP_CONTENT_DIR.'/fco-private-vault';
        foreach ($files as $storage) {
            if (!preg_match('/^[a-f0-9]{48}\.dat$/D', $storage)) { throw new RuntimeException('A file record needs review before this project can be permanently deleted.'); }
            $path = $directory.'/'.$storage;
            if (is_link($path) || (file_exists($path) && !is_writable($path))) { throw new RuntimeException('A project file could not be safely removed. The project remains in Trash.'); }
        }
        foreach ($files as $storage) {
            $path = $directory.'/'.$storage;
            if (file_exists($path) && !unlink($path)) { throw new RuntimeException('A project file could not be removed. Please retry permanent deletion.'); }
        }
        foreach (['assets','submissions','deliveries','state'] as $table) {
            if ($wpdb->delete(FCO_Hub::table($table), ['project_id'=>$id]) === false) { throw new RuntimeException('Project cleanup did not complete. Please retry permanent deletion.'); }
        }
    }
    private static function change($r, $action) {
        if (!self::permission($r)) { return FCO_Hub::error('Only Inkfire project managers can do this.', 403); }
        $id = absint($r->get_param('id')); $p = $r->get_json_params(); $post = get_post($id);
        if (!$post || $post->post_type !== 'ink_onboard') { return FCO_Hub::error('Project not found.', 404); }
        if (!is_array($p) || ($p['confirmed'] ?? null) !== true) { return FCO_Hub::error('Confirm this project action before continuing.', 400); }
        if (!self::acquire($id)) { return FCO_Hub::error('A save or transfer is in progress. Please retry in a moment.', 409, 'fco_project_busy'); }
        try {
            global $wpdb;
            $running = $wpdb->get_var($wpdb->prepare("SELECT id FROM ".FCO_Hub::table('deliveries')." WHERE project_id=%d AND status='running' AND next_at>%s LIMIT 1", $id, gmdate('Y-m-d H:i:s')));
            if ($running) { return FCO_Hub::error('A transfer is already running. Wait for this batch to finish before changing the project.', 409, 'fco_project_busy'); }
            $post = get_post($id); $m = FCO_Hub::meta($id);
            if ($action === 'trash') {
                if ($post->post_status === 'trash') { return ['success'=>true,'id'=>$id,'status'=>'trash']; }
                if (!EMPTY_TRASH_DAYS) { return FCO_Hub::error('WordPress Trash is disabled. Enable it before using Delete; the project has not been permanently removed.', 409); }
                $result = wp_trash_post($id);
                if (!$result || get_post_status($id) !== 'trash') { return FCO_Hub::error('Could not move this project to Trash.', 500); }
                return ['success'=>true,'id'=>$id,'status'=>'trash','message'=>'Project moved to Trash. Its client access and queued deliveries are disabled.'];
            }
            if ($action === 'restore') {
                if ($post->post_status !== 'trash') { return FCO_Hub::error('Only a trashed project can be restored.', 409); }
                if (!wp_untrash_post($id) || get_post_status($id) !== 'private') { return FCO_Hub::error('The project could not be restored.', 500); }
                return ['success'=>true,'id'=>$id,'status'=>FCO_Hub::meta($id)['status'],'message'=>'Project restored. Issue a new invitation to reopen client access.'];
            }
            if ($action === 'delete') {
                if ($post->post_status !== 'trash') { return FCO_Hub::error('Move the project to Trash before deleting it permanently.', 409); }
                self::pause($id, 'Project permanently deleted.'); self::$permanent_id = $id;
                $deleted = wp_delete_post($id, true);
                if (!$deleted || get_post($id)) { return FCO_Hub::error('The project could not be permanently deleted.', 500); }
                return ['success'=>true,'id'=>$id,'deleted'=>true,'message'=>'Project permanently deleted from Inkfire. The connected website has not been changed.'];
            }
            if ($post->post_status === 'trash') { return FCO_Hub::error('Restore this project from Trash first.', 409); }
            if ($action === 'archive') {
                if ($m['status'] !== 'archived') {
                    update_post_meta($id, '_fco_before_archive_status', $m['status']);
                    $m['status'] = 'archived'; FCO_Hub::set_meta($id, $m);
                    self::pause($id, 'Project archived. Review a new delivery after reopening it.');
                    FCO_Hub::audit($id, 'Project archived; access disabled and queued deliveries cancelled');
                }
                return ['success'=>true,'id'=>$id,'status'=>'archived','message'=>'Project archived. Its content and files have been kept.'];
            }
            if ($action === 'unarchive') {
                if ($m['status'] !== 'archived') { return FCO_Hub::error('This project is not archived.', 409); }
                $previous = get_post_meta($id, '_fco_before_archive_status', true);
                $m['status'] = in_array($previous, ['draft','in_progress','submitted'], true) ? $previous : 'in_progress';
                $m['active'] = false; FCO_Hub::set_meta($id, $m);
                self::pause($id, 'Project reopened. Previous deliveries remain cancelled.');
                delete_post_meta($id, '_fco_before_archive_status'); FCO_Hub::audit($id, 'Project reopened from Archive');
                return ['success'=>true,'id'=>$id,'status'=>$m['status'],'message'=>'Project reopened. Issue a new invitation to reopen client access.'];
            }
            return FCO_Hub::error('Unknown project action.');
        } catch (Throwable $e) {
            return FCO_Hub::error($e instanceof RuntimeException ? $e->getMessage() : 'The project action did not complete. Please refresh and retry.', 500);
        } finally { self::$permanent_id = 0; self::release($id); }
    }
    public static function archive($r) { return self::change($r, 'archive'); }
    public static function unarchive($r) { return self::change($r, 'unarchive'); }
    public static function trash($r) { return self::change($r, 'trash'); }
    public static function restore($r) { return self::change($r, 'restore'); }
    public static function delete($r) { return self::change($r, 'delete'); }
}
