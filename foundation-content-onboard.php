<?php
/**
 * Plugin Name: Foundation: Content Onboard
 * Plugin URI: https://github.com/hawks010/foundation-content-onboard
 * Description: Content onboarding portal. Admin editor + client wizard via token link.
 * Version: 2.4.4
 * Author: Sonny x Inkfire
 * Update URI: https://github.com/hawks010/foundation-content-onboard
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
define( 'FCO_VERSION', '2.4.4' );
define( 'FCO_PLUGIN_FILE', __FILE__ );
define( 'FCO_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'FCO_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

/**
 * Require helper with a safe fallback.
 * Some hosts or ZIP uploads can lead to slight path differences during updates.
 */
function fco_require_file( $relative_path ) {
    $relative_path = ltrim( $relative_path, '/\\' );

    $primary = FCO_PLUGIN_DIR . $relative_path;
    if ( file_exists( $primary ) ) {
        require_once $primary;
        return true;
    }

    // Fallback 1: if you passed "includes/xyz.php" but the file ended up in root.
    $fallback1 = FCO_PLUGIN_DIR . basename( $relative_path );
    if ( file_exists( $fallback1 ) ) {
        require_once $fallback1;
        return true;
    }

    // Fallback 2: try with "includes/" prefix if caller forgot it.
    $fallback2 = FCO_PLUGIN_DIR . 'includes/' . basename( $relative_path );
    if ( file_exists( $fallback2 ) ) {
        require_once $fallback2;
        return true;
    }

    // Last resort: do not fatal. Show admin notice.
    add_action( 'admin_notices', function () use ( $relative_path ) {
        echo '<div class="notice notice-error"><p>';
        echo esc_html( 'Foundation Content Onboard: missing file ' . $relative_path . '. Please re-upload the plugin.' );
        echo '</p></div>';
    } );

    return false;
}

// -----------------------------------------------------------------------------
// Includes
// -----------------------------------------------------------------------------
fco_require_file( 'includes/class-fco-github-updater.php' );
fco_require_file( 'includes/class-fco-cpt.php' );
fco_require_file( 'includes/class-fco-admin.php' );
fco_require_file( 'includes/class-fco-frontend.php' );
fco_require_file( 'includes/class-fco-rest.php' );

if ( class_exists( 'FCO_Github_Updater' ) && method_exists( 'FCO_Github_Updater', 'instance' ) ) {
	FCO_Github_Updater::instance();
}

// -----------------------------------------------------------------------------
// Boot (your classes use static ::init() pattern, so call init, not new())
// -----------------------------------------------------------------------------
add_action( 'plugins_loaded', function () {

    if ( class_exists( 'FCO_CPT' ) && method_exists( 'FCO_CPT', 'init' ) ) {
        FCO_CPT::init();
    }

    if ( is_admin() && class_exists( 'FCO_Admin' ) && method_exists( 'FCO_Admin', 'init' ) ) {
        FCO_Admin::init();
    }

    if ( class_exists( 'FCO_Frontend' ) && method_exists( 'FCO_Frontend', 'init' ) ) {
        FCO_Frontend::init();
    }

    if ( class_exists( 'FCO_REST' ) && method_exists( 'FCO_REST', 'init' ) ) {
        FCO_REST::init();
    }

}, 5 );

// -----------------------------------------------------------------------------
// Activation: auto-create portal page (so clients don't have to set it up)
// -----------------------------------------------------------------------------
register_activation_hook( __FILE__, function () {

    // 1) Add caps (safe-guarded so it cannot fatal)
    if ( class_exists( 'FCO_Admin' ) && method_exists( 'FCO_Admin', 'add_caps' ) ) {
        FCO_Admin::add_caps();
    }

    // 2) Ensure CPT exists before flushing rewrite rules
    if ( class_exists( 'FCO_CPT' ) && method_exists( 'FCO_CPT', 'register_cpt' ) ) {
        FCO_CPT::register_cpt();
    }

    flush_rewrite_rules();

    // 3) Create a portal page with the shortcode embedded.
    $opt_key     = 'fco_portal_page_id';
    $existing_id = (int) get_option( $opt_key );

    if ( $existing_id && get_post( $existing_id ) ) {
        return;
    }

    // Preferred title/slug (but avoid collisions).
    $desired_title = 'Content';
    $desired_slug  = 'content';

    // If a page already exists with this slug/title, reuse it.
    $found = get_page_by_path( $desired_slug );
    if ( ! $found ) {
        $found = get_page_by_title( $desired_title );
    }

    if ( $found && ! is_wp_error( $found ) ) {
        update_option( $opt_key, (int) $found->ID );
        return;
    }

    // If "content" would collide with an existing route, fall back.
    $slug_to_use = $desired_slug;
    if ( get_page_by_path( $slug_to_use ) ) {
        $slug_to_use = 'content-portal';
    }

    $page_id = wp_insert_post( array(
        'post_title'      => $desired_title,
        'post_name'       => $slug_to_use,
        'post_status'     => 'publish',
        'post_type'       => 'page',
        'post_content'    => "[ink_onboard_portal]",
        'comment_status'  => 'closed',
        'ping_status'     => 'closed',
    ) );

    if ( ! is_wp_error( $page_id ) && $page_id ) {
        update_option( $opt_key, (int) $page_id );
    }
} );
