<?php
/** Client onboarding hub. Existing projects are migrated lazily, never deleted. */
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/invitation-email.php';
require_once __DIR__ . '/core.php';
require_once __DIR__ . '/email-history.php';
require_once __DIR__ . '/assets.php';
require_once __DIR__ . '/delivery.php';
require_once __DIR__ . '/ui.php';
require_once __DIR__ . '/brief.php';
require_once __DIR__ . '/lifecycle.php';
require_once __DIR__ . '/project-preview.php';
require_once __DIR__ . '/invitation-scheduler.php';
FCO_Hub::init();
FCO_Hub_Assets::init();
FCO_Hub_Delivery::init();
FCO_Hub_UI::init();
FCO_Hub_Lifecycle::init();
FCO_Hub_Project_Preview::init();
FCO_Hub_Invitation_Scheduler::init();
