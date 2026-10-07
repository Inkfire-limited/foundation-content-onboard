<?php
/** Project-scoped invitation receipts. No email bodies, private links or open tracking. */
if (!defined('ABSPATH')) { exit; }

final class FCO_Hub_Email_History {
    const META = '_fco_email_log';

    private static function timestamp($value) {
        if (!is_string($value) || $value === '') { return ''; }
        $time = strtotime($value);
        return $time === false ? '' : gmdate('c', $time);
    }
    private static function clean_row($row) {
        if (!is_array($row) || !is_string($row['id'] ?? null)) { return null; }
        $at = self::timestamp($row['at'] ?? '');
        if (!$at || !in_array($row['status'] ?? '', ['pending','accepted','failed','uncertain'], true)) { return null; }
        // Explicit allowlist: never pass arbitrary metadata or invitation tokens to the UI.
        return [
            'id'=>sanitize_text_field($row['id']), 'at'=>$at,
            'completed_at'=>self::timestamp($row['completed_at'] ?? ''),
            'recipient'=>is_email($row['recipient'] ?? '') ? sanitize_email($row['recipient']) : '',
            'type'=>sanitize_text_field($row['type'] ?? 'Invitation'),
            'subject'=>sanitize_text_field($row['subject'] ?? ''),
            'status'=>$row['status'], 'actor'=>sanitize_text_field($row['actor'] ?? ''),
            'method'=>in_array($row['method'] ?? '', ['manual','scheduled'], true) ? $row['method'] : '',
            'source'=>($row['source'] ?? '') === 'activity' ? 'activity' : 'receipt',
        ];
    }
    private static function stored($id) {
        $out = [];
        foreach (get_post_meta((int)$id, self::META, false) as $value) {
            $row = self::clean_row($value);
            if ($row) { $out[$row['id']] = $row; }
        }
        return $out;
    }
    private static function legacy_row($at, $recipient, $status, $actor = '') {
        $at = self::timestamp($at);
        if (!$at) { return null; }
        $recipient = is_email($recipient) ? sanitize_email($recipient) : '';
        return self::clean_row([
            'id'=>'legacy-'.hash('sha256', $at.'|'.strtolower($recipient).'|'.$status),
            'at'=>$at, 'completed_at'=>$at, 'recipient'=>$recipient,
            'type'=>'Invitation', 'subject'=>'', 'status'=>$status, 'actor'=>$actor,
            'method'=>'', 'source'=>'activity',
        ]);
    }
    /** Read old activity without inventing missing recipients or treating a schedule as a send. */
    private static function legacy($id, array $stored) {
        $cutoff = PHP_INT_MAX;
        foreach ($stored as $row) {
            if ($row['source'] === 'receipt') { $cutoff = min($cutoff, strtotime($row['at'])); }
        }
        $events = get_post_meta((int)$id, '_fco_events', true);
        $events = is_array($events) ? $events : [];
        $out = []; $scheduled = [];
        foreach ($events as $event) {
            if (!is_array($event)) { continue; }
            $at = self::timestamp($event['at'] ?? '');
            if (!$at || strtotime($at) >= $cutoff) { continue; }
            $name = $event['event'] ?? '';
            $detail = is_string($event['detail'] ?? null) ? $event['detail'] : '';
            $recipient = trim(explode(' | ', $detail, 2)[0]);
            if ($name === 'Invitation accepted by mail service') { $status = 'accepted'; }
            elseif ($name === 'Invitation email failed') { $status = 'failed'; }
            elseif ($name === 'Manual invitation outcome uncertain') { $status = 'uncertain'; }
            elseif ($name === 'Scheduled invitation accepted by mail service') { $status = 'accepted'; }
            else { continue; }
            $row = self::legacy_row($at, $recipient, $status, $event['actor'] ?? '');
            if ($name === 'Scheduled invitation accepted by mail service') { $scheduled[] = $row; }
            else { $out[$row['id']] = $row; }
        }
        // The scheduler also logs success after the transport logs it. That is one email.
        foreach ($scheduled as $row) {
            $duplicate = false;
            foreach (array_merge($stored, $out) as $other) {
                $at = $other['completed_at'] ?: $other['at'];
                if ($other['status'] === 'accepted' && strcasecmp($row['recipient'], $other['recipient']) === 0 && abs(strtotime($row['at']) - strtotime($at)) <= 60) { $duplicate = true; break; }
            }
            if (!$duplicate) { $row['method'] = 'scheduled'; $out[$row['id']] = $row; }
        }
        // The last-send field is evidence of acceptance even if its activity entry rolled off.
        // Do not substitute today's recipient for a historical recipient that was not recorded.
        $m = FCO_Hub::meta((int)$id);
        $last = self::legacy_row($m['last_invited'] ?? '', $m['last_invited_email'] ?? '', 'accepted');
        if ($last && strtotime($last['at']) < $cutoff) {
            $duplicate = false;
            foreach (array_merge($stored, $out) as $other) {
                if ($other['status'] === 'accepted' && ($other['completed_at'] ?: $other['at']) === $last['at']) { $duplicate = true; break; }
            }
            if (!$duplicate) { $out[$last['id']] = $last; }
        }
        return $out;
    }
    /** Called before activity is trimmed, never from a read-only project view. */
    public static function preserve_legacy($id) {
        if (get_post_type((int)$id) !== 'ink_onboard') { return; }
        $stored = self::stored($id);
        foreach (self::legacy($id, $stored) as $key=>$row) {
            if (!isset($stored[$key])) { add_post_meta((int)$id, self::META, wp_slash($row)); }
        }
    }
    /** Only managers receive email history; client responses never include it. */
    public static function for_project($id) {
        if (!FCO_Hub::manager() || get_post_type((int)$id) !== 'ink_onboard') { return []; }
        $stored = self::stored($id);
        $rows = array_values(array_replace(self::legacy($id, $stored), $stored));
        usort($rows, static function($a, $b) {
            return strcmp($b['at'], $a['at']) ?: strcmp($b['id'], $a['id']);
        });
        return $rows;
    }
    /** Persist before attempting transport so a timeout cannot disappear from the history. */
    public static function begin($id, $recipient, $subject, $resend = false) {
        self::preserve_legacy($id);
        $row = self::clean_row([
            'id'=>wp_generate_uuid4(), 'at'=>gmdate('c'), 'completed_at'=>'',
            'recipient'=>$recipient, 'subject'=>$subject,
            'type'=>$resend ? 'Invitation resend' : 'Invitation', 'status'=>'pending',
            'actor'=>wp_doing_cron() ? 'Scheduled system task' : 'Inkfire staff #'.get_current_user_id(),
            'method'=>wp_doing_cron() ? 'scheduled' : 'manual', 'source'=>'receipt',
        ]);
        if (!$row || !FCO_Hub::valid_project((int)$id) || !add_post_meta((int)$id, self::META, wp_slash($row))) {
            return FCO_Hub::error('The email history could not be saved. No email was sent. Please retry.', 503, 'fco_email_log_unavailable');
        }
        return ['project_id'=>(int)$id, 'row'=>$row];
    }
    public static function finish(array $handle, $status) {
        if (!in_array($status, ['accepted','failed','uncertain'], true)) { return false; }
        $before = $handle['row']; $after = $before;
        $after['status'] = $status; $after['completed_at'] = gmdate('c');
        // Match this exact attempt. Concurrent activity cannot replace another email's record.
        return (bool) update_post_meta($handle['project_id'], self::META, wp_slash($after), $before);
    }
}
