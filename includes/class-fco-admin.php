<?php
if (!defined('ABSPATH')) exit;

class FCO_Admin {

    public static function init() {
        add_action('admin_menu', [__CLASS__, 'register_menu'], 20);
        add_action('add_meta_boxes', [__CLASS__, 'clean_admin_ui'], 99);

        // Force 1-column layout logic
        add_filter('get_user_option_screen_layout_ink_onboard', [__CLASS__, 'force_one_column']);
        add_filter('screen_layout_columns', [__CLASS__, 'register_one_column']);

        // App container injection
        add_action('edit_form_after_title', [__CLASS__, 'render_app_container'], 5);
        add_filter('admin_body_class', [__CLASS__, 'add_admin_body_class'], 10, 1);
        add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue_admin_app']);
    }

    /**
     * Used by activation hook in your main plugin file.
     * Keep it lightweight and safe.
     */
    public static function add_caps() {
        $role = get_role('administrator');
        if (!$role) return;

        // Optional future-proofing capability if you need it later.
        $role->add_cap('manage_fco_portal');
    }

    public static function register_menu() {
        global $admin_page_hooks;

        $parent_slug = 'foundation-by-inkfire';
        $cap_top     = 'manage_options';

        // Your existing capability choice for the CPT submenu
        $cap_manage  = 'edit_pages';

        // Your stored portal page option (created on activation in foundation-content-onboard.php)
        $opt_key     = 'fco_portal_page_id';
        $portal_id   = (int) get_option($opt_key);

        // Ensure top-level menu exists (with a real callback to avoid odd WP behaviour on some installs)
        if (empty($admin_page_hooks[$parent_slug])) {
            add_menu_page(
                'Foundation',
                'Foundation',
                $cap_top,
                $parent_slug,
                [__CLASS__, 'redirect_to_onboard_list'],
                'dashicons-hammer',
                30
            );
        }

        // Existing submenu (this is what you said was working)
        add_submenu_page(
            $parent_slug,
            'Content Onboard',
            'Content Onboard',
            $cap_manage,
            'foundation-content-onboard',
            [__CLASS__, 'render_dashboard_page']
        );

        add_submenu_page(
            $parent_slug,
            'Onboard Projects',
            'Onboard Projects',
            $cap_manage,
            'edit.php?post_type=ink_onboard'
        );

        // Portal Page shortcut (edit the generated "Content" page)
        if ($portal_id && get_post($portal_id)) {
            add_submenu_page(
                $parent_slug,
                'Portal Page',
                'Portal Page',
                $cap_manage,
                'post.php?post=' . $portal_id . '&action=edit'
            );

            // Client Portal shortcut (front-end view of the portal page)
            $portal_url = get_permalink($portal_id);
            if ($portal_url) {
                add_submenu_page(
                    $parent_slug,
                    'Client Portal',
                    'Client Portal',
                    $cap_manage,
                    $portal_url
                );
            }
        }

        // OPTIONAL: remove duplicate first submenu label if WP creates one for the parent slug.
        // Safe to call even if it doesn't exist.
        remove_submenu_page($parent_slug, $parent_slug);
    }

    /**
     * Clicking "Foundation" should take you somewhere useful, not a blank screen.
     */
    public static function redirect_to_onboard_list() {
        if (!current_user_can('manage_options')) {
            wp_die(__('You do not have permission to access this page.'));
        }
        wp_safe_redirect(admin_url('admin.php?page=foundation-content-onboard'));
        exit;
    }

    private static function get_shell_config() {
        $counts = wp_count_posts('ink_onboard');
        $published = isset($counts->publish) ? (int) $counts->publish : 0;
        $drafts = isset($counts->draft) ? (int) $counts->draft : 0;
        $portal_id = (int) get_option('fco_portal_page_id');
        $portal_url = $portal_id ? get_permalink($portal_id) : '';

        return [
            'plugin' => 'content-onboard',
            'rootId' => 'foundation-admin-app',
            'eyebrow' => __('Foundation command centre', 'foundation-content-onboard'),
            'title' => __('Foundation: Content Onboard', 'foundation-content-onboard'),
            'description' => __('A shared Foundation dashboard has been added without changing the existing project editor, CPT storage, or inkfire/v1 REST routes.', 'foundation-content-onboard'),
            'badge' => 'v' . FCO_VERSION,
            'themeStorageKey' => 'foundation-content-onboard-theme',
            'actions' => [
                [
                    'label' => __('Create project', 'foundation-content-onboard'),
                    'href' => admin_url('post-new.php?post_type=ink_onboard'),
                    'variant' => 'solid',
                ],
                [
                    'label' => __('GitHub backup', 'foundation-content-onboard'),
                    'href' => 'https://github.com/hawks010/foundation-content-onboard',
                    'target' => '_blank',
                    'variant' => 'ghost',
                ],
            ],
            'metrics' => [
                [
                    'label' => __('Published projects', 'foundation-content-onboard'),
                    'value' => number_format_i18n($published),
                    'meta' => __('Live Content Onboard projects.', 'foundation-content-onboard'),
                ],
                [
                    'label' => __('Draft projects', 'foundation-content-onboard'),
                    'value' => number_format_i18n($drafts),
                    'meta' => __('Work still being prepared.', 'foundation-content-onboard'),
                ],
                [
                    'label' => __('Portal page', 'foundation-content-onboard'),
                    'value' => $portal_id ? __('Ready', 'foundation-content-onboard') : __('Missing', 'foundation-content-onboard'),
                    'meta' => $portal_url ?: __('The activation-created portal page was not found.', 'foundation-content-onboard'),
                    'tone' => $portal_id ? 'accent' : 'danger',
                ],
            ],
            'sections' => [
                [
                    'id' => 'content-onboard-workspace',
                    'navLabel' => __('Workspace', 'foundation-content-onboard'),
                    'eyebrow' => __('Client content portal', 'foundation-content-onboard'),
                    'title' => __('Projects, portal shortcuts, and editor app', 'foundation-content-onboard'),
                    'description' => __('Use this dashboard to open the existing CPT editor app and the generated client portal.', 'foundation-content-onboard'),
                    'templateId' => 'foundation-content-onboard-workspace',
                ],
            ],
        ];
    }

    public static function render_dashboard_page() {
        $portal_id = (int) get_option('fco_portal_page_id');
        $portal_url = $portal_id ? get_permalink($portal_id) : '';

        ob_start();
        ?>
        <div class="fp-card">
            <h2><?php esc_html_e('Content workspace', 'foundation-content-onboard'); ?></h2>
            <p class="description"><?php esc_html_e('The client content editor is still powered by the existing custom post type and REST app. This dashboard simply gives the plugin the same Foundation entry pattern as the rest of the suite.', 'foundation-content-onboard'); ?></p>
            <div class="foundation-shell-actions">
                <a class="button button-primary" href="<?php echo esc_url(admin_url('edit.php?post_type=ink_onboard')); ?>"><?php esc_html_e('Open projects', 'foundation-content-onboard'); ?></a>
                <a class="button" href="<?php echo esc_url(admin_url('post-new.php?post_type=ink_onboard')); ?>"><?php esc_html_e('Create project', 'foundation-content-onboard'); ?></a>
                <?php if ($portal_url) : ?>
                    <a class="button" href="<?php echo esc_url($portal_url); ?>" target="_blank" rel="noopener noreferrer"><?php esc_html_e('View client portal', 'foundation-content-onboard'); ?></a>
                <?php endif; ?>
            </div>
        </div>
        <?php
        $workspace = ob_get_clean();
        ?>
        <div class="wrap foundation-admin-wrap">
            <div id="foundation-admin-app">
                <p><?php esc_html_e('Loading Foundation shell...', 'foundation-content-onboard'); ?></p>
            </div>
            <template id="foundation-content-onboard-workspace"><?php echo $workspace; ?></template>
        </div>
        <?php
    }

    public static function force_one_column($result) {
        return 1;
    }

    public static function register_one_column($columns) {
        $columns['ink_onboard'] = 1;
        return $columns;
    }

    public static function add_admin_body_class($classes) {
        $screen = function_exists('get_current_screen') ? get_current_screen() : null;
        if ($screen && $screen->base === 'post' && $screen->post_type === 'ink_onboard') {
            $classes .= ' fco-admin-screen';
        }
        return $classes;
    }

    public static function clean_admin_ui() {
        $screen = function_exists('get_current_screen') ? get_current_screen() : null;
        if ($screen && $screen->post_type === 'ink_onboard') {
            // Remove standard WP boxes
            remove_meta_box('submitdiv', 'ink_onboard', 'side');
            remove_meta_box('slugdiv', 'ink_onboard', 'normal');
            remove_meta_box('authordiv', 'ink_onboard', 'normal');
            remove_meta_box('postimagediv', 'ink_onboard', 'side');
            remove_meta_box('commentstatusdiv', 'ink_onboard', 'normal');
            remove_meta_box('commentsdiv', 'ink_onboard', 'normal');

            // Remove 3rd party
            remove_meta_box('external-featured-image', 'ink_onboard', 'side');
            remove_meta_box('nelio_efi', 'ink_onboard', 'side');
            remove_meta_box('fifu_featured_image_meta_box', 'ink_onboard', 'side');

            // Aggressive cleanup of the side container
            global $wp_meta_boxes;
            if (isset($wp_meta_boxes['ink_onboard']['side'])) {
                unset($wp_meta_boxes['ink_onboard']['side']);
            }
        }
    }

    public static function render_app_container($post) {
        if ($post->post_type !== 'ink_onboard') return;
        echo '<div id="fco-admin-wrapper"><div id="fco-client-app"></div></div>';
    }

    public static function enqueue_admin_app($hook) {
        global $post;
        if (false !== strpos((string) $hook, 'foundation-content-onboard')) {
            $asset_version = defined('FCO_VERSION') ? FCO_VERSION : time();
            $asset_base = trailingslashit(FCO_PLUGIN_URL) . 'assets/admin/';

            wp_enqueue_style('foundation-admin-shell', $asset_base . 'foundation-admin-shell.css', [], $asset_version);
            wp_enqueue_script('foundation-admin-shell', $asset_base . 'foundation-admin-shell.js', ['wp-element'], $asset_version, true);
            wp_add_inline_script(
                'foundation-admin-shell',
                'window.foundationAdminShellData = ' . wp_json_encode(self::get_shell_config()) . ';',
                'before'
            );
            return;
        }

        if (($hook !== 'post.php' && $hook !== 'post-new.php') || !$post || $post->post_type !== 'ink_onboard') {
            return;
        }

        $js_path  = plugin_dir_path(dirname(__FILE__)) . 'assets/client.js';
        $css_path = plugin_dir_path(dirname(__FILE__)) . 'assets/client.css';

        $ver_js  = file_exists($js_path) ? filemtime($js_path) : time();
        $ver_css = file_exists($css_path) ? filemtime($css_path) : time();

        wp_enqueue_media();
        wp_enqueue_editor();

        wp_enqueue_style('fco-client-css', plugins_url('../assets/client.css', __FILE__), [], $ver_css);
        wp_enqueue_script('jquery-ui-sortable');
        wp_enqueue_script('fco-client-js', plugins_url('../assets/client.js', __FILE__), ['jquery', 'jquery-ui-sortable'], $ver_js, true);

        wp_localize_script('fco-client-js', 'FCO_Config', [
            'api' => [
                'root'  => esc_url_raw(rest_url('inkfire/v1')),
                'nonce' => wp_create_nonce('wp_rest')
            ],
            'projectId' => (int) $post->ID,
            'pluginUrl' => plugin_dir_url(dirname(__FILE__)), // root plugin URL
            'user' => [
                'name'       => wp_get_current_user()->display_name ?: wp_get_current_user()->user_login,
                'can_manage' => current_user_can('edit_pages')
            ],
            'isAdmin' => true,
            'commonPages' => [
                'Home', 'About', 'Services', 'Contact', 'Blog', 'Shop',
                'Privacy Policy', 'Terms', 'FAQ', 'Portfolio', 'Careers', 'Team'
            ]
        ]);
    }
}
