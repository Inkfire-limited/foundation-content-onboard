<?php
/** Staff-only client preview. No invitation, session exchange or project write. */
if (!defined('ABSPATH')) { exit; }
final class FCO_Hub_Project_Preview {
    public static function init() {
        add_action('template_redirect', [__CLASS__, 'guard'], -1);
        add_action('rest_api_init', static function () {
            register_rest_route(FCO_Hub::NS, '/projects/(?P<id>\d+)/client-preview', [
                'methods'=>'GET', 'permission_callback'=>[__CLASS__, 'permission'], 'callback'=>[__CLASS__, 'read'],
            ]);
        });
    }
    public static function permission($r) { return FCO_Hub::manager() && FCO_Hub::origin_ok($r); }
    public static function guard() {
        if (!isset($_GET['fco_preview']) || !is_page((int)get_option('fco_portal_page_id'))) { return; }
        nocache_headers();
        header('Cache-Control: no-store, private, max-age=0');
        header('X-Robots-Tag: noindex, nofollow, noarchive');
        if (!is_user_logged_in()) { auth_redirect(); exit; }
        if (!current_user_can('manage_options')) { wp_die('This preview is available to Inkfire project managers only.', 'Private preview', ['response'=>403]); }
        if (!FCO_Hub::valid_project(absint($_GET['fco_preview']))) { wp_die('This project is unavailable. Restore it from Trash before previewing.', 'Project unavailable', ['response'=>404]); }
    }
    public static function read($r) {
        if (!self::permission($r)) { return FCO_Hub::error('Staff access is required.',403); }
        $id=absint($r['id']);
        if (!FCO_Hub::valid_project($id)) { return FCO_Hub::error('Project unavailable. Restore it from Trash first.',404); }
        global $wpdb;
        $row=$wpdb->get_row($wpdb->prepare('SELECT revision,payload,updated_at FROM '.FCO_Hub::table('state').' WHERE project_id=%d',$id), ARRAY_A);
        $data=$row ? json_decode($row['payload'],true) : FCO_CPT::get_project_data($id);
        $data=FCO_Hub::clean($data,$id);
        if (is_wp_error($data)) { return $data; }
        $m=FCO_Hub::meta($id);
        $context=array_intersect_key($m,array_flip(['client_name','contact_name','welcome','logo_url','accent','status']));
        $data['_hub']=['revision'=>(int)($row['revision']??1),'updated_at'=>$row['updated_at']??''];
        return ['id'=>$id,'context'=>$context,'data'=>$data,'revision'=>$data['_hub']['revision'],'read_only'=>true];
    }
}
