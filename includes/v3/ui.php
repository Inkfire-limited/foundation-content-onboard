<?php
if (!defined('ABSPATH')) { exit; }
final class FCO_Hub_UI {
    public static function init() {
        add_action('admin_menu',[__CLASS__,'menu'],40);
        add_action('admin_enqueue_scripts',[__CLASS__,'admin_assets']);
        add_action('admin_init',[__CLASS__,'legacy_admin']);
        add_action('template_redirect',[__CLASS__,'portal'],0);
        add_shortcode('ink_onboard_portal',[__CLASS__,'shortcode']);
        add_shortcode('foundation_onboard',[__CLASS__,'shortcode']);
        add_filter('rank_math/sitemap/entry',function($entry,$type,$object){ return isset($object->ID) && in_array((int)$object->ID,self::private_pages(),true) ? false : $entry; },10,3);
        add_filter('wp_sitemaps_posts_query_args',function($args,$type){ if ($type==='page') { $args['post__not_in']=array_merge($args['post__not_in'] ?? [],self::private_pages()); } return $args; },10,2);
    }
    private static function private_pages() { return array_filter(array_map('intval',array_merge([(int)get_option('fco_portal_page_id')],(array)get_option('fco_legacy_portal_pages',[])))); }
    public static function menu() {
        add_menu_page('Client Onboarding','Client Onboarding','manage_options','fco-onboarding',[__CLASS__,'admin'],'dashicons-welcome-write-blog',31);
        add_submenu_page('foundation-by-inkfire','Client Onboarding','Client Onboarding','manage_options','fco-onboarding',[__CLASS__,'admin']);
    }
    public static function legacy_admin() {
        if (!current_user_can('manage_options') || wp_doing_ajax()) { return; }
        if (($_GET['page'] ?? '')==='foundation-content-onboard') { wp_safe_redirect(admin_url('admin.php?page=fco-onboarding'));exit; }
        if (!empty($_GET['post']) && get_post_type(absint($_GET['post']))==='ink_onboard') { wp_safe_redirect(admin_url('admin.php?page=fco-onboarding&project='.absint($_GET['post'])));exit; }
        if (($_GET['post_type'] ?? '')==='ink_onboard') { wp_safe_redirect(admin_url('admin.php?page=fco-onboarding'));exit; }
    }
    public static function config($admin=false) {
        return ['supportRestNonce'=>is_user_logged_in()?wp_create_nonce('wp_rest'):'','supportNonce'=>wp_create_nonce('fco_support'),'hub'=>true,'hubRoot'=>esc_url_raw(rest_url(FCO_Hub::NS)),'api'=>['root'=>esc_url_raw(rest_url('inkfire/v1')),'nonce'=>$admin?wp_create_nonce('wp_rest'):''],'projectId'=>0,'pluginUrl'=>FCO_PLUGIN_URL,'portalUrl'=>FCO_Hub::portal_url(),'adminUrl'=>admin_url('admin.php?page=fco-onboarding'),'connectorUrl'=>'https://github.com/Inkfire-limited/inkfire-onboard-connector/releases/latest/download/inkfire-onboard-connector.zip','user'=>['name'=>$admin?wp_get_current_user()->display_name:'Your team','can_manage'=>$admin],'isAdmin'=>$admin,'invitationTimezone'=>wp_timezone_string(),'invitationLocalNow'=>wp_date('Y-m-d\TH:i',time()+60),'clientCanEditStructure'=>true,'version'=>FCO_VERSION];
    }
    private static function asset_url($path) {
        $file = FCO_PLUGIN_DIR . $path;
        return add_query_arg(['fco_build' => is_file($file) ? filemtime($file) : FCO_VERSION, '_litespeed_rm_qs' => '0'], FCO_PLUGIN_URL . $path);
    }
    public static function assets($admin=false) {
        $preview_id = !$admin && current_user_can('manage_options') ? absint($_GET['fco_preview'] ?? 0) : 0;
        if ($preview_id) { wp_enqueue_style('fco-project-preview-css',self::asset_url('assets/v3/project-preview.css'),['fco-responsive-css'],FCO_VERSION); }
        wp_enqueue_editor();
        if (!$admin) { wp_enqueue_script('fco-help',self::asset_url('assets/v3/help.js'),['fco-hub-bridge'],FCO_VERSION,true); }
        wp_enqueue_style('fco-client-css',self::asset_url('assets/client.css'),[],FCO_VERSION);
        wp_enqueue_style('fco-hub-css',self::asset_url('assets/v3/hub.css'),['fco-client-css'],FCO_VERSION);
        wp_enqueue_style('fco-responsive-css',self::asset_url('assets/v3/responsive.css'),['fco-hub-css'],FCO_VERSION);
        wp_enqueue_style('fco-guided-css',self::asset_url('assets/v3/guided.css'),['fco-responsive-css'],FCO_VERSION);
        wp_enqueue_style('fco-accessibility-css',self::asset_url('assets/v3/accessibility.css'),['fco-guided-css'],FCO_VERSION);
        if (!$admin) { wp_enqueue_style('fco-controls-css',self::asset_url('assets/v3/controls.css'),['fco-responsive-css'],FCO_VERSION); }
        if ($admin) { wp_enqueue_style('fco-lifecycle-css',self::asset_url('assets/v3/lifecycle.css'),['fco-responsive-css'],FCO_VERSION); }
        if ($admin) { wp_enqueue_style('fco-workflows-css',self::asset_url('assets/v3/workflows.css'),['fco-lifecycle-css'],FCO_VERSION); }
        if ($admin) { wp_enqueue_style('fco-email-history-css',self::asset_url('assets/v3/email-history.css'),['fco-workflows-css'],FCO_VERSION); }
        wp_enqueue_script('fco-client-js',self::asset_url('assets/client.js'),['jquery','jquery-ui-sortable'],FCO_VERSION,true);
        wp_localize_script('fco-client-js','FCO_Config',array_merge(self::config($admin),$preview_id ? ['previewOnly'=>true,'previewProject'=>$preview_id,'previewNonce'=>wp_create_nonce('wp_rest')] : []));
        wp_enqueue_script('fco-hub-bridge',self::asset_url('assets/v3/bridge.js'),['fco-client-js'],FCO_VERSION,true);
        wp_enqueue_script('fco-editor-accessibility',self::asset_url('assets/v3/editor-accessibility.js'),['fco-hub-bridge'],FCO_VERSION,true);
        wp_enqueue_script('fco-review-fixes',self::asset_url('assets/v3/review-fixes.js'),['fco-editor-accessibility'],FCO_VERSION,true);
        wp_enqueue_style('fco-review-fixes-css',self::asset_url('assets/v3/review-fixes.css'),['fco-accessibility-css'],FCO_VERSION);
        wp_enqueue_script('fco-guided',self::asset_url('assets/v3/guided.js'),['fco-review-fixes'],FCO_VERSION,true);
        if (!$admin) { wp_enqueue_script('fco-controls',self::asset_url('assets/v3/controls.js'),['fco-guided'],FCO_VERSION,true); }
        wp_enqueue_script($admin?'fco-hub-admin':'fco-hub-portal',self::asset_url('assets/v3/'.($admin?'admin':($preview_id?'project-preview':'portal')).'.js'),[$admin?'fco-guided':'fco-controls'],FCO_VERSION,true);
        if (!$admin && !$preview_id && current_user_can('manage_options')) { wp_enqueue_script('fco-admin-preview',self::asset_url('assets/v3/preview.js'),['fco-hub-portal'],FCO_VERSION,true); }
    }
    public static function admin_assets($hook) { if (($_GET['page'] ?? '')==='fco-onboarding') { self::assets(true); } }
    public static function admin() {
        if (!current_user_can('manage_options')) { return; }
        echo '<div class="wrap fco-hub-admin"><div id="fco-admin-app"><h1>Client Onboarding</h1><p>Loading projects…</p></div><section id="fco-editor-panel" hidden><button class="button" id="fco-close-editor" type="button">Back to project management</button><p class="fco-hub-save" role="status">Loading content…</p><div id="fco-client-app"></div></section><div id="fco-notice" role="status" aria-live="polite"></div></div>';
    }
    public static function shortcode() { return '<p>Your dedicated project space is ready. <a href="'.esc_url(FCO_Hub::portal_url()).'">Open client onboarding</a>.</p>'; }
    public static function portal() {
        $pid=(int)get_option('fco_portal_page_id');
        $legacy=(array)get_option('fco_legacy_portal_pages',[]);
        if ($legacy && is_page($legacy)) { nocache_headers();wp_safe_redirect(FCO_Hub::portal_url(),302);exit; }
        if (!$pid || !is_page($pid)) { return; }
        if (!defined('DONOTCACHEPAGE')) { define('DONOTCACHEPAGE',true); }
        do_action('litespeed_control_set_nocache', 'Private client onboarding portal');
        header('X-LiteSpeed-Cache-Control: no-cache');
        nocache_headers();header('Cache-Control: no-store, private, max-age=0');header('X-Robots-Tag: noindex, nofollow, noarchive');header('Referrer-Policy: no-referrer');header('X-Content-Type-Options: nosniff');header('X-Frame-Options: SAMEORIGIN');header("Content-Security-Policy: frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'");
        // Keep ordered editor dependencies out of CDN script rewriting.
        ob_start(static function ($html) { return preg_replace('/<script\\b(?![^>]*\\bdata-cfasync=)/i', '<script data-cfasync="false"', $html); });
        // A first-party shell deliberately omits the marketing theme's tracking scripts.
        self::assets(false);
        add_filter('user_can_richedit','__return_true');
        ?><!doctype html><html <?php language_attributes(); ?>><head><meta charset="<?php bloginfo('charset'); ?>"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="base-uri 'self'; object-src 'none'; form-action 'self'"><title>Client onboarding | Inkfire</title><?php wp_print_styles(['dashicons','editor-buttons','fco-client-css','fco-hub-css','fco-responsive-css','fco-controls-css','fco-guided-css','fco-accessibility-css','fco-project-preview-css','fco-review-fixes-css']);wp_print_head_scripts(); ?></head>
        <body class="fco-standalone"><a class="fco-skip" href="#fco-main">Skip to your project</a><header class="fco-sitebar"><div class="fco-sitebar-inner"><a class="fco-wordmark" href="<?php echo esc_url(home_url('/')); ?>" aria-label="Inkfire home"><img src="https://inkfire.co.uk/wp-content/uploads/2024/01/cropped-Primary-Logo-White.png" alt="Inkfire"></a><div class="fco-sitebar-actions"><span id="fco-sitebar-tagline">Your project, in one place</span><span id="fco-project-label" hidden></span><span id="fco-presence" class="fco-presence" role="status" aria-live="polite" hidden></span><button type="button" id="fco-help-open" aria-haspopup="dialog" aria-label="Need help?" title="Need help?"><span class="fco-help-label">Need help?</span><span class="fco-help-icon" aria-hidden="true">?</span></button><button type="button" id="fco-signout" aria-label="Save and exit" title="Save and exit" hidden><span class="fco-signout-label">Save and exit</span><svg class="fco-signout-icon" aria-hidden="true" focusable="false" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2024 Fonticons, Inc. --><path d="M377.9 105.9L500.7 228.7c7.2 7.2 11.3 17.1 11.3 27.3s-4.1 20.1-11.3 27.3L377.9 406.1c-6.4 6.4-15 9.9-24 9.9c-18.7 0-33.9-15.2-33.9-33.9l0-62.1-128 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l128 0 0-62.1c0-18.7 15.2-33.9 33.9-33.9c9 0 17.6 3.6 24 9.9zM160 96L96 96c-17.7 0-32 14.3-32 32l0 256c0 17.7 14.3 32 32 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0c-53 0-96-43-96-96L0 128C0 75 43 32 96 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32z"/></svg></button></div></div></header>
        <main id="fco-main" tabindex="-1"><div id="fco-opening" class="fco-opening" role="status" aria-live="polite">Opening your project…</div><noscript><p class="fco-opening">Please enable JavaScript to open your onboarding workspace.</p></noscript><div id="fco-gateway" class="fco-welcome-card" hidden><div class="fco-welcome-inner"><p class="fco-eyebrow">CLIENT ONBOARDING</p><h1>Let’s make room<br>for your next chapter.</h1><p>One place for your content, images and ideas. Open the private project link in your invitation email to get started.</p><form id="fco-open-form"><label for="fco-invitation">Already have your invitation?</label><div class="fco-inline"><input id="fco-invitation" type="text" autocomplete="off" spellcheck="false" placeholder="Paste your project link" required><button type="submit">Open project</button></div></form><?php if (current_user_can('manage_options')) : ?><p><button type="button" id="fco-admin-preview">Preview the wizard</button></p><?php endif; ?><p id="fco-gateway-status" role="status" aria-live="polite"></p><p class="fco-small">No account needed. Your link can be saved and shared with your project colleagues. Keep it private: anyone holding it can access and edit your project.</p></div></div><section id="fco-portal-project" hidden><div id="fco-client-app"></div><div class="fco-project-strip" role="region" aria-label="Project saving and review"><span class="fco-hub-save" role="status">Loading your saved progress…</span><span id="fco-submission-status" role="status" aria-live="polite"></span><button id="fco-resume-wizard" type="button" hidden>Continue onboarding</button><button id="fco-save-now" type="button" hidden>Save now</button><button id="fco-submit-project" type="button" hidden>Submit for Inkfire review</button></div></section><div id="fco-notice" role="status" aria-live="polite"></div></main><footer class="fco-sitefooter">Made for your team, by Inkfire. <a href="<?php echo esc_url(home_url('/privacy-policy/')); ?>">Privacy</a><span>Do not upload passwords, payment details or identity documents.</span></footer>
        <?php
        // WordPress's own editor assets only. No wp_head/wp_footer marketing callbacks.
        _WP_Editors::enqueue_default_editor();
        // This portal uses its own accessible URL dialog, not WP's authenticated post search.
        // The unused default link dialog is the final block emitted by this core method.
        ob_start();
        _WP_Editors::print_default_editor_scripts();
        $editor_markup = ob_get_clean();
        $legacy_dialog = strpos($editor_markup, '<div id="wp-link-backdrop"');
        echo $legacy_dialog === false ? $editor_markup : substr($editor_markup, 0, $legacy_dialog);
        wp_dequeue_script('wplink');
        wp_dequeue_script('media-upload');
        remove_action('wp_print_footer_scripts', ['_WP_Editors','print_default_editor_scripts'], 45);
        wp_print_footer_scripts();
        ?></body></html><?php ob_end_flush(); exit;
    }
}
