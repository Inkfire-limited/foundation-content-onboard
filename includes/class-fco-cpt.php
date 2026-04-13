<?php
if (!defined('ABSPATH')) exit;

class FCO_CPT {

    const META_KEY = 'ink_onboard_data';

    public static function init() {
        add_action('init', [__CLASS__, 'register_cpt']);
    }

    public static function register_cpt() {

        register_post_type('ink_onboard', [
            'labels' => [
                'name'               => 'Onboarding Projects',
                'singular_name'      => 'Project',
                'add_new'            => 'New Project',
                'add_new_item'       => 'Add New Onboarding Project',
                'edit_item'          => 'Edit Project',
                'new_item'           => 'New Project',
                'view_item'          => 'View Project',
                'search_items'       => 'Search Projects',
                'not_found'          => 'No projects found',
                'not_found_in_trash' => 'No projects found in Trash',
            ],

            // Data-only CPT
            'public'              => false,
            'publicly_queryable'  => false,
            'exclude_from_search' => true,
            'show_ui'             => true,
            'show_in_menu'        => false,
            'show_in_admin_bar'   => false,

            'rewrite'             => false,
            'query_var'           => false,

            // Staff-only: standard WP permissions
            'capability_type'     => 'post',
            'map_meta_cap'        => true,

            // Minimal supports (your app renders the UI)
            'supports'            => ['author', 'custom-fields'],

            'menu_icon'           => 'dashicons-clipboard',
        ]);
    }

    /**
     * Read + normalise + migrate any legacy JSON into the current structure.
     */
    public static function get_project_data($post_id) {

        $post_id = (int) $post_id;
        if (!$post_id) {
            return self::blank_schema(0);
        }

        $json = get_post_meta($post_id, self::META_KEY, true);
        $data = is_string($json) && $json !== '' ? json_decode($json, true) : null;

        if (!$data || !is_array($data)) {
            $data = self::blank_schema($post_id);
            return $data;
        }

        // Migrate older payloads (v1 JSON import, older saved meta etc.)
        $data = self::migrate_legacy_payload($data, $post_id);

        // Harden types (JS safety)
        $data['project']  = (isset($data['project'])  && is_array($data['project']))  ? $data['project']  : [];
        $data['pages']    = (isset($data['pages'])    && is_array($data['pages']))    ? $data['pages']    : [];
        $data['comments'] = (isset($data['comments']) && is_array($data['comments'])) ? $data['comments'] : [];

        // These should behave like objects in JS
        $data['drafts']   = (isset($data['drafts'])   && (is_array($data['drafts'])   || is_object($data['drafts'])))   ? $data['drafts']   : (object)[];
        $data['branding'] = (isset($data['branding']) && (is_array($data['branding']) || is_object($data['branding']))) ? $data['branding'] : (object)[];

        // If they came through as empty arrays from old saves, cast to object
        if (is_array($data['drafts']) && empty($data['drafts']))     $data['drafts'] = (object)[];
        if (is_array($data['branding']) && empty($data['branding'])) $data['branding'] = (object)[];

        // Ensure project core fields exist
        $data['project']['id'] = isset($data['project']['id']) ? (int) $data['project']['id'] : (int) $post_id;
        if (empty($data['project']['status'])) $data['project']['status'] = 'not_started';
        if (!isset($data['project']['wizard_complete'])) $data['project']['wizard_complete'] = false;

        // Ensure sort keys exist for pages (needed for ordering)
        foreach ($data['pages'] as $i => $p) {
            if (!is_array($p)) continue;
            if (!isset($data['pages'][$i]['sort'])) $data['pages'][$i]['sort'] = $i;
            if (!isset($data['pages'][$i]['parent'])) $data['pages'][$i]['parent'] = null;
        }

        return $data;
    }

    /**
     * Save current structure back to meta (REST save uses this).
     */
    public static function update_project_data($post_id, $data) {

        $post_id = (int) $post_id;
        if (!$post_id || !is_array($data)) return false;

        // Always normalise before save so future loads are stable
        $data = self::migrate_legacy_payload($data, $post_id);

        $encoded = wp_json_encode($data);
        if (!$encoded) return false;

        update_post_meta($post_id, self::META_KEY, $encoded);
        return true;
    }

    /**
     * Build the current blank schema.
     */
    private static function blank_schema($post_id) {
        return [
            'project' => [
                'id'              => (int) $post_id,
                'company_name'    => $post_id ? get_the_title($post_id) : '',
                'status'          => 'not_started',
                'wizard_complete' => false,
            ],
            'pages'     => [],
            'drafts'    => (object)[],
            'branding'  => (object)[],
            'comments'  => [],
        ];
    }

    /**
     * Migrates older payloads to the current schema.
     * Handles:
     * - Legacy import JSON (top-level: drafts, images, pageState, pages)
     * - Missing project/branding/comments keys
     * - Keeps legacy keys under a "_legacy" namespace so nothing is lost.
     */
    private static function migrate_legacy_payload($data, $post_id) {

        // Detect v1 import shape: has drafts+pages but no project
        $is_v1 = (!isset($data['project']) && isset($data['pages']) && isset($data['drafts']));

        if ($is_v1) {

            // Create the expected top-level keys if missing
            $data['project'] = [
                'id'              => (int) $post_id,
                'company_name'    => get_the_title($post_id),
                'status'          => 'not_started',
                'wizard_complete' => false,
            ];

            // Branding didn’t exist in v1: create it and tuck images inside
            if (!isset($data['branding'])) {
                $data['branding'] = (object)[];
            }

            // Preserve legacy "images" (logo uploads etc) rather than dropping
            if (isset($data['images']) && (is_array($data['images']) || is_object($data['images']))) {
                $branding = is_object($data['branding']) ? (array) $data['branding'] : (array) $data['branding'];
                $branding['assets'] = $data['images'];
                $data['branding'] = (object) $branding;
                unset($data['images']);
            }

            // Preserve pageState (UI state) if present
            if (isset($data['pageState']) && (is_array($data['pageState']) || is_object($data['pageState']))) {
                $data['_legacy'] = isset($data['_legacy']) && is_array($data['_legacy']) ? $data['_legacy'] : [];
                $data['_legacy']['pageState'] = $data['pageState'];
                unset($data['pageState']);
            }

            if (!isset($data['comments'])) $data['comments'] = [];
        }

        // If project is missing even in odd cases, enforce it
        if (!isset($data['project']) || !is_array($data['project'])) {
            $data['project'] = [
                'id'              => (int) $post_id,
                'company_name'    => get_the_title($post_id),
                'status'          => 'not_started',
                'wizard_complete' => false,
            ];
        }

        // Ensure required containers exist
        if (!isset($data['pages']) || !is_array($data['pages'])) $data['pages'] = [];
        if (!isset($data['drafts']))   $data['drafts']   = (object)[];
        if (!isset($data['branding'])) $data['branding'] = (object)[];
        if (!isset($data['comments']) || !is_array($data['comments'])) $data['comments'] = [];

        // Ensure drafts/branding come through as objects when empty
        if (is_array($data['drafts']) && empty($data['drafts'])) $data['drafts'] = (object)[];
        if (is_array($data['branding']) && empty($data['branding'])) $data['branding'] = (object)[];

        // Ensure page sort keys exist
        foreach ($data['pages'] as $i => $p) {
            if (!is_array($p)) continue;
            if (!isset($data['pages'][$i]['sort'])) $data['pages'][$i]['sort'] = $i;
            if (!array_key_exists('parent', $data['pages'][$i])) $data['pages'][$i]['parent'] = null;
        }

        return $data;
    }
}
