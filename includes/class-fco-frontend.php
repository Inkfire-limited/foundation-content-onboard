<?php
if (!defined('ABSPATH')) exit;

class FCO_Frontend {

    public static function init() {
        add_shortcode('ink_onboard_portal', [__CLASS__, 'render_portal']);
        add_shortcode('foundation_onboard', [__CLASS__, 'render_portal']); // Alias
    }

    public static function render_portal($atts) {
        if (!is_user_logged_in()) {
            return '<div class="fco-error">Please log in to access your portal.</div>';
        }

        $user_id = get_current_user_id();
        $project_id = 0;

        // 1) Find existing project for user
        $projects = get_posts([
            'post_type'   => 'ink_onboard',
            'author'      => $user_id,
            'numberposts' => 1,
            'post_status' => ['publish', 'private', 'draft']
        ]);

        if ($projects) {
            $project_id = (int) $projects[0]->ID;
        } else {
            // 2) Auto-create project
            $project_id = wp_insert_post([
                'post_type'   => 'ink_onboard',
                'post_title'  => wp_get_current_user()->display_name . "'s Project",
                'post_status' => 'publish',
                'post_author' => $user_id
            ]);
        }

        // Needed for TinyMCE + Quicktags + Media modal on the front end
        wp_enqueue_editor();
        wp_enqueue_media();

        $js_abs  = plugin_dir_path(dirname(__FILE__)) . 'assets/client.js';
        $css_abs = plugin_dir_path(dirname(__FILE__)) . 'assets/client.css';

        $ver_js  = file_exists($js_abs)  ? filemtime($js_abs)  : time();
        $ver_css = file_exists($css_abs) ? filemtime($css_abs) : time();

        wp_enqueue_style('fco-client-css', plugins_url('../assets/client.css', __FILE__), [], $ver_css);
        wp_enqueue_script('fco-client-js', plugins_url('../assets/client.js', __FILE__), ['jquery', 'jquery-ui-sortable'], $ver_js, true);

        wp_localize_script('fco-client-js', 'FCO_Config', [
            'api' => [
                'root'  => esc_url_raw(rest_url('inkfire/v1')),
                'nonce' => wp_create_nonce('wp_rest')
            ],
            'projectId' => (int) $project_id,
            'pluginUrl' => plugin_dir_url(dirname(__FILE__)), // Pass root plugin URL
            'user' => [
                'name'       => wp_get_current_user()->display_name ?: wp_get_current_user()->user_login,
                'can_manage' => current_user_can('read')
            ],
            'isAdmin' => false,

            // Clients get the same structure tools as admin (minus import/export/reset)
            'clientCanEditStructure' => true,

            'commonPages' => [
                'Home','About','About Us','Our Story','Our Team','Team',
                'Services','Our Services','Work With Us','Pricing',
                'Case Studies','Portfolio','Client Stories',
                'Blog','Journal','News','FAQ','Contact','Get in Touch',
                'Privacy Policy','Terms','Accessibility Statement'
            ]
        ]);

        // Important: wrapper div only. Elementor controls background outside.
        return '<div id="fco-client-app"></div>';
    }
}