<?php
// If uninstall not called from WordPress, exit.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
    exit;
}

// Clean up plugin options only. We intentionally do NOT delete posts/content.

delete_option('fco_portal_page_id');

// Remove the custom role (optional, safe). If you prefer to keep roles, comment out.
remove_role('fco_client');
