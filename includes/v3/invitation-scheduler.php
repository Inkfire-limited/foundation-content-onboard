<?php
/** One scheduled invitation per project. The access token is never copied into the queue. */
if (!defined('ABSPATH')) { exit; }

final class FCO_Hub_Invitation_Scheduler {
    const META = '_fco_invite_schedule';
    const HOOK = 'fco_hub_invite_dispatch';
    private static $booted = false;

    public static function init() {
        if (self::$booted) { return; }
        self::$booted = true;
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_action(self::HOOK, [__CLASS__, 'dispatch'], 10, 2);
        add_action('updated_post_meta', [__CLASS__, 'meta_changed'], 20, 4);
        add_action('deleted_post_meta', [__CLASS__, 'meta_changed'], 20, 4);
        add_action('before_delete_post', [__CLASS__, 'before_delete'], 5, 2);
    }
    public static function routes() {
        register_rest_route(FCO_Hub::NS, '/projects/(?P<id>\d+)/invitation-schedule', [
            ['methods'=>'GET', 'permission_callback'=>[__CLASS__, 'permission'], 'callback'=>[__CLASS__, 'get']],
            ['methods'=>'POST', 'permission_callback'=>[__CLASS__, 'permission'], 'callback'=>[__CLASS__, 'schedule']],
        ]);
        register_rest_route(FCO_Hub::NS, '/projects/(?P<id>\d+)/invitation-schedule/cancel', [
            'methods'=>'POST', 'permission_callback'=>[__CLASS__, 'permission'], 'callback'=>[__CLASS__, 'cancel'],
        ]);
    }
    public static function permission($r) { return FCO_Hub::manager() && FCO_Hub::origin_ok($r); }
    public static function record($id) {
        $value = get_post_meta((int)$id, self::META, true);
        return is_array($value) ? $value : [];
    }
    public static function public_record($id) {
        $s = self::record($id);
        if (!$s) { return null; }
        $out = array_intersect_key($s, array_flip(['id','status','recipient','recipients','send_at','timezone','created_at','updated_at','attempted_at','accepted_at','cancelled_at','message']));
        $out['local_datetime'] = wp_date('Y-m-d\TH:i', (int)$s['send_at'], new DateTimeZone($s['timezone']));
        $out['display_time'] = wp_date('l j F Y, g:ia T', (int)$s['send_at'], new DateTimeZone($s['timezone']));
        $out['send_at_utc'] = gmdate('c', (int)$s['send_at']);
        $out['overdue'] = $s['status'] === 'scheduled' && (int)$s['send_at'] < time() - 300;
        $out['next_run'] = wp_next_scheduled(self::HOOK, [(int)$id, $s['id']]) ?: null;
        return $out;
    }
    public static function get($r) {
        if (!FCO_Hub::valid_project(absint($r['id']))) { return FCO_Hub::error('Project not found.', 404); }
        return ['schedule'=>self::public_record(absint($r['id']))];
    }
    public static function parse_time($value, $zone) {
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/D', $value) || !is_string($zone) || !in_array($zone, DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC), true)) {
            return FCO_Hub::error('Choose a date, time and recognised time zone.');
        }
        try {
            $dt = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $value, new DateTimeZone($zone));
            $errors = DateTimeImmutable::getLastErrors();
            if (!$dt || ($errors && ($errors['warning_count'] || $errors['error_count'])) || $dt->format('Y-m-d\TH:i') !== $value) {
                return FCO_Hub::error('That local date or time does not exist. Please choose another time.');
            }
            // Refuse ambiguous clock-change times rather than silently choosing an occurrence.
            $ts = $dt->getTimestamp();
            foreach ([-3600, 3600] as $offset) {
                if ($dt->setTimestamp($ts + $offset)->format('Y-m-d\TH:i') === $value) { return FCO_Hub::error('That time occurs twice when the clocks change. Choose a time outside the clock change.'); }
            }
            return $ts;
        } catch (Throwable $e) { return FCO_Hub::error('Please check the scheduled date and time zone.'); }
    }
    private static function fresh($id) { wp_cache_delete((int)$id, 'post_meta'); }
    private static function store($id, array $s) {
        $s['updated_at'] = gmdate('c');
        update_post_meta((int)$id, self::META, $s);
        self::fresh($id);
        return self::record($id) === $s;
    }
    private static function validate_target($id, array $s) {
        if (!FCO_Hub::valid_project($id)) { return 'The project is no longer available.'; }
        $m = FCO_Hub::meta($id);
        if (in_array($m['status'], ['archived','trash'], true) || !$m['active']) { return 'Client access has been disabled or the project archived.'; }
        $current_recipients = FCO_Hub::collaborator_emails($m); $scheduled_recipients = is_array($s['recipients'] ?? null) ? $s['recipients'] : array_filter([(string)($s['recipient'] ?? '')]);
        if (array_map('strtolower',$current_recipients) !== array_map('strtolower',$scheduled_recipients)) { return 'The collaborator list changed. Review the recipients and schedule again.'; }
        if ((string)$m['uuid'] !== (string)$s['project_uuid'] || (int)$m['link_version'] !== (int)$s['link_version']) { return 'The project access link changed. Review and schedule again.'; }
        if ((string)$m['last_invited'] !== (string)$s['previous_invited_at']) { return 'Another invitation has already been sent. Review before sending again.'; }
        if (!get_post_meta($id, '_fco_link_hash', true) || !get_post_meta($id, '_fco_link_encrypted', true)) { return 'The project access link is unavailable.'; }
        return '';
    }
    public static function schedule($r) {
        if (!self::permission($r)) { return FCO_Hub::error('Only Inkfire project managers can schedule invitations.', 403); }
        $id = absint($r['id']); $p = $r->get_json_params();
        if (!FCO_Hub::valid_project($id)) { return FCO_Hub::error('Project not found.', 404); }
        if (!is_array($p) || ($p['confirmed'] ?? null) !== true) { return FCO_Hub::error('Confirm the recipient and sending time first.'); }
        if (!is_string($p['request_id'] ?? null) || !preg_match('/^[a-f0-9-]{36}$/Di', $p['request_id']) || !is_string($p['expected_schedule_id'] ?? null) || !is_array($p['expected_recipients'] ?? null)) { return FCO_Hub::error('Refresh the invitation panel and try again.'); }
        $zone = $p['timezone'] ?? wp_timezone_string();
        $ts = self::parse_time($p['send_at'] ?? '', $zone);
        if (is_wp_error($ts)) { return $ts; }
        if (!FCO_Hub_Lifecycle::acquire($id)) { return FCO_Hub::error('This project is busy. Please retry in a moment.', 409); }
        try {
            self::fresh($id); $old = self::record($id); $m = FCO_Hub::meta($id);
            if ($old && ($old['request_id'] ?? '') === $p['request_id']) {
                $old_recipients = is_array($old['recipients'] ?? null) ? $old['recipients'] : array_filter([(string)($old['recipient'] ?? '')]);
                if ((int)$old['send_at'] !== $ts || array_map('strtolower',$old_recipients) !== array_map('strtolower',$p['expected_recipients'])) { return FCO_Hub::error('This request was already used for a different schedule. Refresh the panel.', 409); }
                return ['success'=>true, 'schedule'=>self::public_record($id), 'message'=>'This scheduling request has already been saved.'];
            }
            if (($old['id'] ?? '') !== $p['expected_schedule_id']) { return FCO_Hub::error('The invitation schedule changed. Refresh before replacing it.', 409); }
            if (in_array($old['status'] ?? '', ['sending','uncertain'], true)) { return FCO_Hub::error('The previous send needs checking before another invitation is scheduled.', 409); }
            if ($ts < time() + 60) { return FCO_Hub::error('Choose a sending time at least one minute in the future.'); }
            if ($ts > time() + 366 * DAY_IN_SECONDS) { return FCO_Hub::error('Choose a sending time within the next year.'); }
            if (in_array($m['status'], ['archived','trash'], true)) { return FCO_Hub::error('Reopen the project before scheduling its invitation.', 409); }
            $current_recipients = FCO_Hub::collaborator_emails($m);
            if (!$current_recipients || array_map('strtolower',$p['expected_recipients']) !== array_map('strtolower',$current_recipients)) { return FCO_Hub::error('The collaborator list changed. Check the recipients before scheduling.', 409); }
            if (!$m['active']) {
                $link = new WP_REST_Request('POST'); $link->set_param('id', $id); $link->set_header('Content-Type', 'application/json'); $link->set_body('{}');
                $created = FCO_Hub::link($link);
                if (is_wp_error($created)) { return $created; }
                unset($created); $m = FCO_Hub::meta($id);
            }
            if (!FCO_Hub::crypt(get_post_meta($id, '_fco_link_encrypted', true), true)) { return FCO_Hub::error('The saved access link is unavailable. Replace it before scheduling.', 409); }
            $s = ['id'=>wp_generate_uuid4(), 'request_id'=>$p['request_id'], 'status'=>'scheduled', 'recipient'=>$current_recipients[0], 'recipients'=>$current_recipients, 'send_at'=>$ts, 'timezone'=>$zone, 'project_uuid'=>$m['uuid'], 'link_version'=>(int)$m['link_version'], 'previous_invited_at'=>$m['last_invited'], 'created_at'=>gmdate('c'), 'created_by'=>get_current_user_id(), 'message'=>'Invitation batch scheduled. No email has been sent.'];
            if (!self::store($id, $s)) { return FCO_Hub::error('The schedule could not be saved.', 500); }
            $queued = wp_schedule_single_event($ts, self::HOOK, [$id, $s['id']], true);
            if (is_wp_error($queued) || !$queued) {
                if ($old) { self::store($id, $old); } else { delete_post_meta($id, self::META); }
                return FCO_Hub::error('WordPress could not queue this invitation. Nothing was sent.', 500);
            }
            if ($old) { wp_clear_scheduled_hook(self::HOOK, [$id, $old['id']]); }
            FCO_Hub::audit($id, 'Invitation scheduled', implode(', ',$current_recipients).' | '.wp_date('j F Y g:ia T', $ts, new DateTimeZone($zone)));
            return ['success'=>true, 'schedule'=>self::public_record($id), 'message'=>'Invitation scheduled. No email has been sent.'];
        } finally { FCO_Hub_Lifecycle::release($id); }
    }
    private static function cancel_record($id, array $s, $reason) {
        $s['status'] = 'cancelled'; $s['cancelled_at'] = gmdate('c'); $s['message'] = $reason;
        if (!self::store($id, $s)) { return false; }
        wp_clear_scheduled_hook(self::HOOK, [(int)$id, $s['id']]);
        FCO_Hub::audit($id, 'Scheduled invitation cancelled', $reason);
        return true;
    }
    public static function cancel($r) {
        if (!self::permission($r)) { return FCO_Hub::error('Only Inkfire project managers can cancel invitations.', 403); }
        $id = absint($r['id']); $p = $r->get_json_params();
        if (!FCO_Hub::valid_project($id)) { return FCO_Hub::error('Project not found.', 404); }
        if (!is_array($p) || ($p['confirmed'] ?? null) !== true || !is_string($p['expected_schedule_id'] ?? null)) { return FCO_Hub::error('Confirm which scheduled invitation to cancel.'); }
        if (!FCO_Hub_Lifecycle::acquire($id)) { return FCO_Hub::error('Sending may already be in progress. Refresh to check its status.', 409); }
        try {
            self::fresh($id); $s = self::record($id);
            if (!$s || $s['id'] !== $p['expected_schedule_id']) { return FCO_Hub::error('The schedule changed. Refresh this project.', 409); }
            if ($s['status'] === 'cancelled') { return ['success'=>true, 'schedule'=>self::public_record($id), 'message'=>'This invitation schedule is already cancelled.']; }
            if ($s['status'] !== 'scheduled') { return FCO_Hub::error('This invitation is no longer waiting to send. Check its status before taking further action.', 409); }
            if (!self::cancel_record($id, $s, 'Cancelled by Inkfire staff. No scheduled invitation will be sent.')) { return FCO_Hub::error('Cancellation could not be saved. Please retry.', 500); }
            return ['success'=>true, 'schedule'=>self::public_record($id), 'message'=>'Scheduled invitation cancelled. The project and its saved answers are unchanged.'];
        } finally { FCO_Hub_Lifecycle::release($id); }
    }
    private static function manual_receipts($id) {
        $records=get_post_meta((int)$id,'_fco_manual_invite_receipts',true);
        return is_array($records)?$records:[];
    }
    private static function store_manual_receipts($id,array $records) {
        if (count($records)>20) { $records=array_slice($records,-20,null,true); }
        update_post_meta((int)$id,'_fco_manual_invite_receipts',$records);
    }
    public static function manual($r) {
        $id = absint($r['id']);
        if (!FCO_Hub::valid_project($id)) { return FCO_Hub::error('Project not found.',404); }
        $p=$r->get_json_params();
        $request_id=is_array($p)?($p['request_id']??''):'';
        if (!is_string($request_id) || !preg_match('/^[a-f0-9-]{36}$/Di',$request_id)) {
            return FCO_Hub::error('Refresh the invitation panel before sending. A unique send request is required.',409,'fco_invite_request_required');
        }
        if (!FCO_Hub_Lifecycle::acquire($id)) { return FCO_Hub::error('An invitation action is in progress. Please wait.', 409); }
        try {
            self::fresh($id); $s = self::record($id);
            if (in_array($s['status'] ?? '', ['scheduled','sending','uncertain'], true)) { return FCO_Hub::error('An invitation is scheduled or needs its sending status checked. Cancel a pending schedule before sending now.', 409); }
            $m=FCO_Hub::meta($id);$recipients=FCO_Hub::collaborator_emails($m);$recipient=implode(', ',$recipients);
            if (!$recipients) { return FCO_Hub::error('Add at least one collaborator before sending.',409); }
            $records=self::manual_receipts($id);
            if (isset($records[$request_id]) && is_array($records[$request_id])) {
                $receipt=$records[$request_id];
                if (strcasecmp((string)($receipt['recipient']??''),$recipient)!==0) {
                    return FCO_Hub::error('This send request belongs to a different recipient. Refresh the invitation panel.',409,'fco_invite_request_mismatch');
                }
                $state=(string)($receipt['status']??'');
                if ($state==='accepted') {
                    return ['success'=>true,'reused'=>true,'request_id'=>$request_id,'message'=>'This invitation request was already accepted by the mail service. No duplicate email was sent.'];
                }
                if ($state==='failed') {
                    return FCO_Hub::error('The previous invitation attempt is recorded as failed before mail-service acceptance. Click Send again to start a new deliberate attempt.',409,'fco_invite_failed_recorded');
                }
                return FCO_Hub::error('The previous invitation attempt has an uncertain sending outcome. Check the mail service before starting a new attempt; this request will not be sent again.',409,'fco_invite_uncertain');
            }
            $records[$request_id]=['status'=>'sending','recipient'=>$recipient,'created_at'=>gmdate('c'),'updated_at'=>gmdate('c')];
            self::store_manual_receipts($id,$records);
            try {
                $result=FCO_Hub::invite_now($r);
            } catch (Throwable $e) {
                $records=self::manual_receipts($id);
                $records[$request_id]=array_merge($records[$request_id]??[],['status'=>'uncertain','updated_at'=>gmdate('c'),'message'=>'Sending outcome could not be confirmed.']);
                self::store_manual_receipts($id,$records);
                FCO_Hub::audit($id,'Manual invitation outcome uncertain',$recipient);
                return FCO_Hub::error('The sending outcome could not be confirmed. Check the mail service before resending; this request will not be sent again.',502,'fco_invite_uncertain');
            }
            $records=self::manual_receipts($id);
            if (is_wp_error($result)) {
                $records[$request_id]=array_merge($records[$request_id]??[],['status'=>'failed','updated_at'=>gmdate('c'),'message'=>$result->get_error_message()]);
                self::store_manual_receipts($id,$records);
                return FCO_Hub::error($result->get_error_message().' This attempt is recorded as failed; a new send needs a new deliberate request.',(int)(($result->get_error_data()['status']??502)),'fco_invite_failed_recorded');
            }
            $records[$request_id]=array_merge($records[$request_id]??[],['status'=>'accepted','updated_at'=>gmdate('c'),'message'=>$result['message']??'Invitation accepted by mail service.']);
            self::store_manual_receipts($id,$records);
            $result['request_id']=$request_id;
            return $result;
        } finally { FCO_Hub_Lifecycle::release($id); }
    }
    /** Safe to call more than once: only the current, due, unattempted schedule can send. */
    public static function dispatch($id, $schedule_id) {
        $id = absint($id);
        if (!$id || !is_string($schedule_id) || !preg_match('/^[a-f0-9-]{36}$/Di', $schedule_id)) { return; }
        if (!FCO_Hub_Lifecycle::acquire($id)) {
            if (!wp_next_scheduled(self::HOOK, [$id, $schedule_id])) { wp_schedule_single_event(time()+60, self::HOOK, [$id, $schedule_id]); }
            return;
        }
        try {
            self::fresh($id); $s = self::record($id);
            if (!$s || $s['id'] !== $schedule_id || $s['status'] !== 'scheduled' || (int)$s['send_at'] > time()) { return; }
            $reason = self::validate_target($id, $s);
            if ($reason !== '') { self::cancel_record($id, $s, $reason); return; }
            if (time() - (int)$s['send_at'] > DAY_IN_SECONDS) {
                $s['status']='failed'; $s['message']='The scheduled time was missed by more than a day. Review and schedule again.'; self::store($id, $s); wp_clear_scheduled_hook(self::HOOK, [$id, $s['id']]); FCO_Hub::audit($id, 'Scheduled invitation needs attention', $s['message']); return;
            }
            $s['status']='sending'; $s['attempted_at']=gmdate('c'); $s['message']='Sending attempt started. Do not resend until its outcome is known.';
            if (!self::store($id, $s)) { return; }
            wp_clear_scheduled_hook(self::HOOK, [$id, $s['id']]);
            $r = new WP_REST_Request('POST'); $r->set_param('id', $id); $r->set_header('Content-Type', 'application/json'); $r->set_body(wp_json_encode(['expected_recipients'=>is_array($s['recipients'] ?? null)?$s['recipients']:array_filter([(string)($s['recipient'] ?? '')])]));
            try {
                $sent = FCO_Hub::invite_now($r);
                if (is_wp_error($sent)) { $s['status']='failed'; $s['message']=$sent->get_error_message(); }
                else { $s['status']='accepted'; $s['accepted_at']=gmdate('c'); $s['message']='Invitation batch accepted by the mail service. Inbox delivery is not confirmed.'; }
            } catch (Throwable $e) { $s['status']='uncertain'; $s['message']='The sending outcome could not be confirmed. Check the email service before resending; no automatic retry will occur.'; }
            self::store($id, $s);
            FCO_Hub::audit($id, $s['status']==='accepted' ? 'Scheduled invitation batch accepted by mail service' : 'Scheduled invitation needs attention', implode(', ',is_array($s['recipients'] ?? null)?$s['recipients']:array_filter([(string)($s['recipient'] ?? '')])).' | '.$s['message']);
        } finally { FCO_Hub_Lifecycle::release($id); }
    }
    public static function meta_changed($meta_id, $id, $key, $value) {
        if (!in_array($key, ['_fco_hub','_fco_link_hash','_fco_link_encrypted'], true)) { return; }
        $s = self::record($id);
        if (($s['status'] ?? '') !== 'scheduled' || !FCO_Hub_Lifecycle::acquire($id)) { return; }
        try {
            self::fresh($id); $s=self::record($id);
            if (($s['status'] ?? '') !== 'scheduled') { return; }
            $reason = self::validate_target($id, $s);
            if ($reason !== '') { self::cancel_record($id, $s, $reason); }
        } finally { FCO_Hub_Lifecycle::release($id); }
    }
    public static function before_delete($id, $post) {
        if ($post->post_type !== 'ink_onboard') { return; }
        $s = self::record($id);
        if ($s) { wp_clear_scheduled_hook(self::HOOK, [(int)$id, $s['id']]); }
    }
}
