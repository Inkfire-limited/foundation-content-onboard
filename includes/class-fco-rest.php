<?php
if (!defined('ABSPATH')) exit;

class FCO_REST {

    public static function init() {
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
    }

    public static function register_routes() {
        $ns = 'inkfire/v1';

        // 1. Get Project Data
        register_rest_route($ns, '/project/current', [
            'methods'             => 'GET',
            'callback'            => [__CLASS__, 'get_current_project'],
            'permission_callback' => [__CLASS__, 'check_read_access'],
        ]);

        // 2. Save Project Data
        register_rest_route($ns, '/project/save', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'save_project_data'],
            'permission_callback' => [__CLASS__, 'check_write_access'],
        ]);

        // 3. Sync Pages to WordPress
        register_rest_route($ns, '/project/sync_pages', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'handle_full_sync_request'],
            'permission_callback' => function () { return current_user_can('edit_pages'); },
        ]);

        // 4. Email Summary
        register_rest_route($ns, '/project/email_summary', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'send_project_summary_email'],
            'permission_callback' => function () { return current_user_can('edit_pages'); },
        ]);
    }

    public static function get_current_project($request) {
        $project_id = self::resolve_project_id($request);
        if (!$project_id) return new WP_Error('no_project', 'No project found.', ['status' => 404]);
        
        $data = FCO_CPT::get_project_data($project_id);
        if (!is_array($data)) $data = [];
        return rest_ensure_response($data);
    }

    public static function save_project_data($request) {
        $project_id = self::resolve_project_id($request);
        if (!$project_id) return new WP_Error('no_project', 'No project found.', ['status' => 404]);

        $params = $request->get_json_params();
        $data = isset($params['data']) ? $params['data'] : [];

        if (empty($data) || !is_array($data)) {
            return new WP_Error('no_data', 'No valid data provided.', ['status' => 400]);
        }

        // 1. Update Meta (Single Source of Truth)
        FCO_CPT::update_project_data($project_id, $data);

        // 2. Force Post Update (Busts Cache & Updates Modified Time)
        wp_update_post([
            'ID' => $project_id,
            'post_date' => current_time('mysql'),
            'post_date_gmt' => current_time('mysql', 1)
        ]);

        return rest_ensure_response(['success' => true]);
    }

    public static function send_project_summary_email($request) {
        $project_id = (int) $request->get_param('project_id');
        if (!$project_id) return new WP_Error('no_pid', 'Missing project ID', ['status' => 400]);

        $data = FCO_CPT::get_project_data($project_id);
        $branding = $data['branding'] ?? [];
        $project = $data['project'] ?? [];
        $content = $data['content'] ?? [];
        
        $site_name = $branding['company_name'] ?? 'Project';
        $current_user = wp_get_current_user();
        $to_email = $current_user->user_email;
        
        $headers = ['Content-Type: text/html; charset=UTF-8'];
        $subject = "Project Summary: $site_name";

        // --- BUILD EMAIL HTML ---
        ob_start();
        ?>
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; border: 1px solid #e1e1e1; }
                h1 { margin-top: 0; color: #111; font-size: 24px; border-bottom: 2px solid #f0f0f0; padding-bottom: 15px; }
                h2 { color: #444; font-size: 18px; margin-top: 25px; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                .item { margin-bottom: 10px; }
                .label { font-weight: bold; font-size: 12px; color: #777; text-transform: uppercase; display: block; }
                .val { font-size: 15px; color: #000; }
                .color-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
                .color-chip { width: 40px; height: 40px; border-radius: 50%; border: 1px solid #ddd; display: inline-block; margin-right: 5px; }
                .page-list { padding-left: 20px; }
                .footer { margin-top: 30px; font-size: 12px; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1><?php echo esc_html($site_name); ?></h1>
                <p>Hello <?php echo esc_html($current_user->display_name); ?>, here is the summary of the content onboard.</p>
                
                <div class="item">
                    <span class="label">Tagline</span>
                    <div class="val"><?php echo esc_html($branding['tagline'] ?? 'N/A'); ?></div>
                </div>
                <div class="item">
                    <span class="label">One Liner</span>
                    <div class="val"><?php echo esc_html($branding['one_liner'] ?? 'N/A'); ?></div>
                </div>

                <h2>Technical</h2>
                <div class="item"><span class="label">Admin Email</span> <span class="val"><?php echo esc_html($project['admin_email'] ?? '-'); ?></span></div>
                <div class="item"><span class="label">Current URL</span> <span class="val"><?php echo esc_html($project['existing_website'] ?? '-'); ?></span></div>

                <h2>Visual Identity</h2>
                <div class="item">
                    <span class="label">Colors</span>
                    <div class="color-row">
                        <?php foreach($branding['colors'] ?? [] as $c): ?>
                            <div class="color-chip" style="background-color:<?php echo esc_attr($c['hex']); ?>;" title="<?php echo esc_attr($c['name']); ?>"></div>
                        <?php endforeach; ?>
                    </div>
                </div>
                
                <div class="item" style="margin-top:15px;">
                    <span class="label">Fonts</span>
                    <ul style="margin:5px 0 0 20px;">
                        <?php foreach($branding['fonts'] ?? [] as $f): if(empty($f['name'])) continue; ?>
                            <li><?php echo esc_html($f['label'] . ': ' . $f['name']); ?></li>
                        <?php endforeach; ?>
                    </ul>
                </div>

                <h2>Site Structure</h2>
                <ul class="page-list">
                    <?php 
                    $pages = $data['pages'] ?? [];
                    usort($pages, function($a, $b) { return ($a['sort']??0) - ($b['sort']??0); });
                    foreach($pages as $p): 
                        $status = $data['drafts'][$p['id']]['status'] ?? 'empty';
                    ?>
                    <li><strong><?php echo esc_html($p['title']); ?></strong> <span style="font-size:11px; color:#888;">(<?php echo ucfirst($status); ?>)</span></li>
                    <?php endforeach; ?>
                </ul>

                <h2>Team</h2>
                <ul class="page-list">
                    <?php foreach($content['staff'] ?? [] as $s): ?>
                        <li><?php echo esc_html($s['name']); ?> - <?php echo esc_html($s['position']); ?></li>
                    <?php endforeach; ?>
                </ul>

                <div class="footer">
                    Generated via Foundation Content Onboard
                </div>
            </div>
        </body>
        </html>
        <?php
        $message = ob_get_clean();

        $sent = wp_mail($to_email, $subject, $message, $headers);

        if ($sent) {
            return rest_ensure_response(['success' => true]);
        } else {
            return new WP_Error('email_failed', 'WordPress could not send the email. Check server settings.', ['status' => 500]);
        }
    }

    /**
     * MASTER SYNC: Pages, Users, Identity, Taxonomies, Colors
     */
    public static function handle_full_sync_request($request) {
        $project_id = (int) $request->get_param('project_id');
        if (!$project_id) return new WP_Error('no_pid', 'Missing project ID', ['status' => 400]);

        $data = FCO_CPT::get_project_data($project_id);
        $report = [
            'pages_created' => 0,
            'terms_created' => 0,
            'users_created' => 0,
            'settings_updated' => []
        ];

        // 1. SYNC BRANDING (Site Title/Tagline)
        $branding = $data['branding'] ?? [];
        if (!empty($branding['company_name'])) {
            update_option('blogname', sanitize_text_field($branding['company_name']));
            $report['settings_updated'][] = 'Site Title';
        }
        if (!empty($branding['tagline'])) {
            update_option('blogdescription', sanitize_text_field($branding['tagline']));
            $report['settings_updated'][] = 'Tagline';
        }

        // 1.5 SYNC COLORS (Save to standardized Option)
        if (!empty($branding['colors'])) {
            update_option('foundation_brand_colors', $branding['colors']);
            $report['settings_updated'][] = 'Brand Colors';
        }

        // 2. SYNC USERS
        $users = $data['project']['wp_users'] ?? [];
        foreach ($users as $u) {
            if (empty($u['username']) || email_exists($u['username']) || username_exists($u['username'])) continue;
            
            $random_password = wp_generate_password(12, false);
            $user_id = wp_create_user($u['username'], $random_password, $u['username'] . '@example.com');
            
            if (!is_wp_error($user_id)) {
                $role = !empty($u['role']) ? $u['role'] : 'editor';
                $user = new WP_User($user_id);
                $user->set_role($role);
                
                if (!empty($u['first_name'])) update_user_meta($user_id, 'first_name', sanitize_text_field($u['first_name']));
                if (!empty($u['last_name']))  update_user_meta($user_id, 'last_name', sanitize_text_field($u['last_name']));
                
                $report['users_created']++;
            }
        }

        // 3. SYNC TAXONOMIES
        if (!empty($branding['blog_categories'])) {
            $report['terms_created'] += self::sync_terms('category', $branding['blog_categories']);
        }
        if (!empty($branding['blog_tags'])) {
            $report['terms_created'] += self::sync_terms('post_tag', $branding['blog_tags']);
        }
        if (class_exists('WooCommerce')) {
            if (!empty($branding['shop_categories'])) {
                $report['terms_created'] += self::sync_terms('product_cat', $branding['shop_categories']);
            }
        }

        // 4. SYNC PAGES
        $pages = isset($data['pages']) ? $data['pages'] : [];
        $drafts = isset($data['drafts']) ? $data['drafts'] : [];
        
        usort($pages, function($a, $b) {
            if (empty($a['parent']) && !empty($b['parent'])) return -1;
            if (!empty($a['parent']) && empty($b['parent'])) return 1;
            return ($a['sort'] ?? 0) - ($b['sort'] ?? 0);
        });

        $id_map = [];

        foreach ($pages as $p) {
            $internal_id = $p['id'];
            $title = $p['title'];
            $parent_internal = $p['parent'] ?? null;
            $contentKey = "{$internal_id}::main";
            $raw_content = isset($drafts[$contentKey]['content']) ? $drafts[$contentKey]['content'] : '';

            $existing = get_page_by_title($title, OBJECT, 'page');
            
            $post_args = [
                'post_type'    => 'page',
                'post_title'   => $title,
                'post_content' => $raw_content,
                'post_status'  => 'draft',
                'post_parent'  => ($parent_internal && isset($id_map[$parent_internal])) ? $id_map[$parent_internal] : 0,
            ];

            if ($existing && $existing->post_status !== 'trash') {
                if($existing->post_status === 'draft') {
                    $post_args['ID'] = $existing->ID;
                    wp_update_post($post_args);
                    $id_map[$internal_id] = $existing->ID;
                } else {
                    $id_map[$internal_id] = $existing->ID;
                }
            } else {
                $new_id = wp_insert_post($post_args);
                if (!is_wp_error($new_id)) {
                    $id_map[$internal_id] = $new_id;
                    $report['pages_created']++;
                }
            }
        }

        return rest_ensure_response([
            'success' => true,
            'report' => $report,
            'message' => 'Sync Complete!'
        ]);
    }

    private static function sync_terms($taxonomy, $terms_array) {
        $count = 0;
        if (!taxonomy_exists($taxonomy)) return 0;
        foreach ($terms_array as $term) {
            if (empty($term)) continue;
            if (!term_exists($term, $taxonomy)) {
                wp_insert_term($term, $taxonomy);
                $count++;
            }
        }
        return $count;
    }

    private static function resolve_project_id($request) {
        $pid = (int) $request->get_param('project_id');
        if ($pid && current_user_can('edit_pages')) return $pid;

        $token = $request->get_param('token') ?: $request->get_header('X-FCO-Token');
        if ($token) {
            $q = new WP_Query([
                'post_type' => 'ink_onboard', 'posts_per_page' => 1,
                'meta_query' => [['key' => 'ink_onboard_token', 'value' => sanitize_text_field($token)]],
                'fields' => 'ids'
            ]);
            return ($q->have_posts()) ? (int) $q->posts[0] : 0;
        }
        return 0;
    }

    public static function check_read_access($request) {
        if (is_user_logged_in() && current_user_can('edit_posts')) return true;
        return (bool) self::resolve_project_id($request);
    }

    public static function check_write_access($request) {
        if (is_user_logged_in() && current_user_can('edit_posts')) return true;
        return (bool) self::resolve_project_id($request);
    }
}
