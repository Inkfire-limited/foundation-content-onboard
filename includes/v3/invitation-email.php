<?php
/** Branded invitation email. Visual treatment follows Inkfire's contact acknowledgement. */
if (!defined('ABSPATH')) { exit; }

final class FCO_Hub_Invitation_Email {
    /** Keep a custom salutation, rather than adding a second greeting above it. */
    public static function introduction(array $meta): array {
        $name = trim(sanitize_text_field((string) ($meta['contact_name'] ?? '')));
        $welcome = trim(sanitize_textarea_field((string) ($meta['welcome'] ?? '')));
        $greeting = 'Hi ' . ($name !== '' ? $name : 'there') . ',';
        $default = 'Your project space is ready. Add your website content, branding and images whenever you have time.';
        // Recognise an opening salutation only, never greetings later in the message.
        $pattern = '/\A((?:Hi|Hello|Hey|Dear)(?:[ \t]+[^,\r\n.!:;]{1,80})?)([,!:]|\r?\n|\z)[ \t\r\n]*(.*)\z/isu';
        if ($welcome !== '' && preg_match($pattern, $welcome, $match)) {
            $greeting = trim($match[1]) . (in_array($match[2], [',', '!', ':'], true) ? $match[2] : ',');
            $welcome = trim($match[3]);
            if ($welcome !== '') {
                $welcome = function_exists('mb_strtoupper')
                    ? mb_strtoupper(mb_substr($welcome, 0, 1, 'UTF-8'), 'UTF-8') . mb_substr($welcome, 1, null, 'UTF-8')
                    : ucfirst($welcome);
            }
        }
        return ['greeting' => $greeting, 'welcome' => $welcome !== '' ? $welcome : $default];
    }

    public static function render(array $meta, string $link): array {
        $intro = self::introduction($meta);
        $client = trim(sanitize_text_field((string) ($meta['client_name'] ?? ''))) ?: 'Your website project';
        $greeting = esc_html($intro['greeting']);
        $project = esc_html($client);
        $url = esc_url($link, ['https']);
        $paragraphs = '';
        foreach (preg_split('/\R[ \t]*\R/u', $intro['welcome']) ?: [] as $paragraph) {
            if (trim($paragraph) === '') { continue; }
            $paragraphs .= '<p style="margin:0 0 18px;font-size:16px;line-height:1.75;color:#111827;">' . nl2br(esc_html(trim($paragraph)), false) . '</p>';
        }
        // All layout styles are inline, with solid fallbacks where gradients are unsupported.
        $html = <<<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Your Inkfire onboarding invitation</title>
<style>
@media only screen and (max-width:600px){.fco-mail-outer{padding:16px 10px!important}.fco-mail-pad{padding:26px 20px!important}.fco-mail-title{font-size:26px!important}.fco-mail-card{padding:22px 18px!important}.fco-mail-footer{padding:24px 20px!important}}
</style>
</head>
<body style="margin:0;padding:0;background-color:#15454b;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<div style="display:none!important;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">Your private project space is ready. Add your content and return whenever you need to.</div>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#15454b" style="width:100%;background-color:#15454b;background-image:linear-gradient(115deg,#15454b 0%,#1E6167 35%,#0e8c78 70%,#01AE93 100%);">
<tr><td align="center" class="fco-mail-outer" style="padding:28px 20px;">
<!--[if mso]><table role="presentation" width="680" align="center" border="0" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;border-collapse:separate;border-spacing:0;">
<tr><td style="border-radius:32px;overflow:hidden;border-top:1px solid rgba(255,255,255,.20);border-bottom:1px solid rgba(0,0,0,.14);box-shadow:0 18px 45px rgba(1,174,147,.14),0 10px 24px rgba(0,0,0,.16);">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">
<tr><td align="center" class="fco-mail-pad" bgcolor="#191A28" style="padding:30px 30px 32px;background-color:#191A28;background-image:linear-gradient(115deg,#13141F 0%,#151622 25%,#191A28 50%,#1C1D2D 75%,#232434 100%);border-bottom:1px solid rgba(255,255,255,.08);color:#ffffff;">
<img src="https://inkfire.co.uk/wp-content/uploads/2025/11/IMG_1089.png" alt="Inkfire" width="56" border="0" style="display:block;margin:0 auto 16px;width:56px;max-width:56px;height:auto;">
<p style="margin:0 0 12px;font-size:12px;line-height:1.5;letter-spacing:1.5px;text-transform:uppercase;color:#8ADBD0;font-weight:bold;">Inkfire Website Onboarder</p>
<h1 class="fco-mail-title" style="margin:0;font-size:30px;line-height:1.3;font-weight:bold;color:#ffffff;">Your onboarding invitation</h1>
<p style="margin:12px 0 0;font-size:17px;line-height:1.5;color:#FBCCBF;overflow-wrap:anywhere;word-break:break-word;">{$project}</p>
</td></tr>
<tr><td class="fco-mail-pad" bgcolor="#EEF4F4" style="padding:34px;background-color:#EEF4F4;background-image:linear-gradient(to bottom,#F8FBFB 0%,#EEF4F4 100%);color:#111827;">
<p style="margin:0 0 18px;font-size:17px;line-height:1.6;font-weight:bold;color:#111827;">{$greeting}</p>
{$paragraphs}
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;margin:24px 0;border-collapse:separate;border-spacing:0;">
<tr><td align="center" class="fco-mail-card" bgcolor="#223538" style="padding:26px 24px;background-color:#223538;border-radius:24px;border:1px solid rgba(255,255,255,.10);box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 8px 24px rgba(15,23,42,.10);color:#F8FAFC;">
<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#E5EEF0;">Add your content, images and ideas in one place.</p>
<table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto;border-collapse:separate;">
<tr><td align="center" bgcolor="#1b5d63" style="border-radius:999px;background-color:#1b5d63;background-image:linear-gradient(135deg,#1b5d63 0%,#087969 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 8px 20px rgba(1,174,147,.18);mso-padding-alt:16px 28px;">
<a href="{$url}" style="display:inline-block;padding:16px 28px;font-size:16px;line-height:1.4;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px;border:1px solid rgba(138,219,208,.4);mso-padding-alt:0;">Open your project <span aria-hidden="true">&rarr;</span></a>
</td></tr></table>
<p style="margin:18px 0 0;font-size:14px;line-height:1.65;color:#E5EEF0;">Your progress saves as you work.<br>No WordPress account or password is needed.</p>
</td></tr></table>
<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#374151;"><strong>Keep your project link private.</strong> It has no automatic expiry, so you can bookmark it and return later. Anyone with the link can view and edit the project. Share it only with colleagues working on this website. Inkfire can replace or revoke it.</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#374151;">Please do not upload passwords, payment details or identity documents.</p>
<p style="margin:0;font-size:16px;line-height:1.75;color:#111827;">Best wishes,<br><strong>The Inkfire team</strong></p>
</td></tr>
<tr><td class="fco-mail-footer" bgcolor="#191A28" style="padding:28px 30px;background-color:#191A28;background-image:linear-gradient(115deg,#13141F 0%,#151622 25%,#191A28 50%,#1C1D2D 75%,#232434 100%);color:#E5E7EB;border-top:1px solid rgba(255,255,255,.06);">
<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border-collapse:separate;">
<tr><td valign="middle" style="padding:0 16px 0 0;vertical-align:middle;">
<img src="https://inkfire.co.uk/wp-content/uploads/2025/11/8ea3eae8-6680-4be4-9082-752dd23a2a68-Photoroom-e1764035925813.png" alt="Inkfire logo" height="40" border="0" style="display:block;height:40px;width:auto;max-width:130px;">
</td><td valign="middle" style="padding:10px 12px;background-color:#ffffff;border-radius:12px;vertical-align:middle;">
<img src="https://inkfire.co.uk/wp-content/uploads/2025/11/dc_badge1.png" alt="Disability Confident" height="32" border="0" style="display:block;height:32px;width:auto;max-width:110px;">
</td></tr></table>
<p style="margin:0 0 12px;font-size:12px;line-height:1.5;letter-spacing:1.5px;text-transform:uppercase;color:#8ADBD0;font-weight:bold;">Need a hand?</p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#E5E7EB;"><strong>Email:</strong> <a href="mailto:support@inkfire.co.uk" style="color:#e87b4b;text-decoration:underline;">support@inkfire.co.uk</a></p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#E5E7EB;"><strong>Phone:</strong> <a href="tel:+443336134653" style="color:#e87b4b;text-decoration:none;">+44 (0)333 613 4653</a></p>
<p style="margin:0 0 14px;font-size:13px;line-height:1.65;color:#C7CDD8;">9 Kingswell Road, Ensbury Park<br>Bournemouth, BH10 5DF</p>
<p style="margin:0;font-size:12px;line-height:1.65;color:#C7CDD8;">Inkfire Limited &middot; Company No. 15153305 &middot; VAT GB483189752</p>
</td></tr></table>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>
HTML;
        $text = $intro['greeting'] . "\n\n" . $intro['welcome'] . "\n\nOpen your project:\n" . $link
            . "\n\nYour progress saves as you work. No WordPress account or password is needed."
            . "\n\nKeep your project link private. It has no automatic expiry, so you can bookmark it and return later. Anyone with the link can view and edit the project. Share it only with colleagues working on this website. Inkfire can replace or revoke it."
            . "\n\nPlease do not upload passwords, payment details or identity documents."
            . "\n\nBest wishes,\nThe Inkfire team\n\nNeed a hand? support@inkfire.co.uk\n+44 (0)333 613 4653"
            . "\n9 Kingswell Road, Ensbury Park, Bournemouth, BH10 5DF"
            . "\nInkfire Limited | Company No. 15153305 | VAT GB483189752";
        return ['html' => $html, 'text' => $text];
    }

    /** Scope the plain-text alternative to this message, not other WordPress emails. */
    public static function send(string $to, string $subject, array $meta, string $link): bool {
        $message = self::render($meta, $link);
        $mailer_used = null;
        $previous_alt = '';
        $alternative = static function ($mailer) use ($message, &$mailer_used, &$previous_alt) {
            if ($mailer->Body !== $message['html']) { return; }
            $mailer_used = $mailer;
            $previous_alt = $mailer->AltBody;
            $mailer->AltBody = $message['text'];
        };
        add_action('phpmailer_init', $alternative, 999);
        try {
            return (bool) wp_mail($to, $subject, $message['html'], [
                'Content-Type: text/html; charset=UTF-8',
                'Reply-To: Inkfire Support <support@inkfire.co.uk>',
            ]);
        } finally {
            remove_action('phpmailer_init', $alternative, 999);
            if ($mailer_used !== null) { $mailer_used->AltBody = $previous_alt; }
        }
    }
}
