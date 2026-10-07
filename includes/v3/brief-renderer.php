<?php
/** Shared read-only developer brief. No project writes, mail or delivery side effects. */
if (!defined('ABSPATH')) { exit; }
if (!class_exists('Inkfire_Onboarding_Brief')) {
final class Inkfire_Onboarding_Brief {
    public static function groups() {
        return [
            'Website basics & audience'=>['branding.company_name','branding.tagline','branding.one_liner','project.goals'],
            'Features & integrations'=>['project.features','project.feature_details','project.specialist_features','project.integration_choices','project.integration_details','project.integrations'],
            'Domain, hosting & existing services'=>['project.existing_website','project.domain','project.domain_registrar','project.hosting','project.business_email_setup','project.analytics_setup'],
            'Language, location & contact'=>['project.languages','project.timezone','project.admin_email','branding.contact','branding.socials','branding.email_signature'],
            'Brand assets, colours & typography'=>['branding.assets','branding.featured_image','branding.colours_by_inkfire','branding.colour_palette_url','branding.colors','branding.fonts'],
            'Design references'=>['branding.inspiration_links','branding.style_notes','branding.brand_doc','branding.inspiration_notes'],
            'Blog & online shop'=>['project.has_blog','branding.blog_categories','branding.blog_tags','project.has_shop','branding.shop_categories','project.products','project.payments','project.shipping','project.tax_invoices'],
            'Bookings & memberships'=>['project.bookables','project.availability','project.booking_payments','project.member_access','project.member_billing'],
            'Team & requested website accounts'=>['content.staff','project.wp_users'],
            'Migration, accessibility & privacy'=>['project.migration','project.accessibility_privacy'],
            'Launch, approvals & aftercare'=>['project.launch_date','project.approvals','project.aftercare'],
            'Progress & unanswered sections'=>['project.wizard_step','project.skipped_steps'],
        ];
    }
    public static function label($key) {
        $labels=['company_name'=>'Business / organisation name','one_liner'=>'What the organisation does','wp_users'=>'Requested website accounts','admin_email'=>'Website notification email','colors'=>'Colour palette','colours_by_inkfire'=>'Ask Inkfire to choose colours','colour_palette_url'=>'Palette reference','has_blog'=>'Blog requested','has_shop'=>'Shop requested','wizard_step'=>'Last visited section (not completion evidence)','skipped_steps'=>'Skipped sections (retained answers still shown)','integration_choices'=>'Selected integrations','feature_details'=>'Feature notes (including retained notes for deselected choices)','integration_details'=>'Integration notes (including retained notes for deselected choices)','sort'=>'Page order key','goal'=>'Page purpose','content'=>'Page copy','status'=>'Content status','url'=>'Link','uuid'=>'File reference','send_to_build'=>'Approved for Media Library transfer','id'=>'Reference'];
        return $labels[$key] ?? ucfirst(str_replace(['_','::','-'],[' ',' / ',' '],(string)$key));
    }
    public static function text($value) {
        if ($value===true) return 'Yes'; if ($value===false) return 'No';
        if ($value===null || $value==='') return 'Not supplied';
        $text=(string)$value;
        $text=preg_replace_callback('~<a\b[^>]*href=[\"\']([^\"\']+)[\"\'][^>]*>(.*?)</a>~is',function($m){return $m[2].' ('.$m[1].')';},$text);
        $text=preg_replace('~<(?:br\s*/?|/p|/div|/li|/h[1-6])>~i',"\n",$text);
        return trim(html_entity_decode(wp_strip_all_tags($text),ENT_QUOTES|ENT_HTML5,'UTF-8'));
    }
    public static function value($v,$depth=0) {
        if (!is_array($v)) return '<p class="answer">'.nl2br(esc_html(self::text($v))).'</p>';
        if (!$v) return '<p class="empty">None supplied</p>';
        if (array_values($v)===$v && !array_filter($v,'is_array')) return '<p class="answer">'.esc_html(implode('; ',array_map([__CLASS__,'text'],$v))).'</p>';
        $html='<div class="record">';
        foreach ($v as $key=>$item) {
            $label=is_int($key)?'Item '.($key+1):self::label($key);
            if (!is_array($item)) $html.='<p class="field answer"><strong>'.esc_html($label).':</strong> '.nl2br(esc_html(self::text($item))).'</p>';
            else $html.='<div class="field"><h3 class="record-heading">'.esc_html($label).'</h3>'.self::value($item,$depth+1).'</div>';
        }
        return $html.'</div>';
    }
    public static function sections($data,$files=[]) {
        $remaining=$data;$sections=[];
        foreach (self::groups() as $title=>$paths) {
            $rows=[];
            foreach ($paths as $path) {
                [$group,$field]=explode('.',$path,2);
                if (array_key_exists($field,(array)($data[$group]??[]))) {
                    $rows[self::label($field)]=$data[$group][$field];unset($remaining[$group][$field]);
                }
            }
            $sections[$title]=$rows;
        }
        $pages=[];
        foreach (($data['pages']??[]) as $page) {
            $id=$page['id']??'';$entry=['Page structure'=>$page,'Page details'=>$data['drafts'][$id]??[],'Page copy & images'=>$data['drafts'][$id.'::main']??[],'Discussion'=>$data['comments'][$id]??[]];
            $pages[($page['title']??'Untitled').' ['.$id.']']=$entry;
            unset($remaining['drafts'][$id],$remaining['drafts'][$id.'::main'],$remaining['comments'][$id]);
        }
        unset($remaining['pages']);$sections['Sitemap, page copy & discussions']=$pages;
        $sections['File inventory & transfer status']=$files;
        if (!empty($remaining['_provenance'])) {
            $sections['Answer provenance & confirmation']=$remaining['_provenance'];
            unset($remaining['_provenance']);
        }
        if (!empty($remaining['_extensions'])) {
            $sections['Preserved future / legacy fields']=$remaining['_extensions'];
            unset($remaining['_extensions']);
        }
        // Never silently omit new or legacy fields when the questionnaire evolves.
        foreach ($remaining as $key=>$value) if ($value!==[] && $value!==null && $value!=='') $sections['Additional saved information'][self::label($key)]=$value;
        return $sections;
    }
    public static function body($data,$context=[],$files=[]) {
        $html='<article class="inkfire-brief"><p class="eyebrow">INKFIRE · DEVELOPER HANDOVER</p><h1>'.esc_html($context['client_name']??'Website project').'</h1><p>Revision '.esc_html($context['revision']??'—').' · '.esc_html($context['generated_at']??gmdate('c')).'</p>';
        $html.='<p class="notice">Private project brief. Client requests are not automatically approved scope. Missing answers and skipped sections need review. Imported pages remain drafts. Accounts, branding and notification email require separate approval; payments, plugins, DNS and integrations are not configured automatically.</p>';
        if (!empty($context['contact_name'])) $html.='<p><strong>Client contact:</strong> '.esc_html($context['contact_name']).'</p>';
        if (!empty($context['email'])) $html.='<p><strong>Contact email:</strong> '.esc_html($context['email']).'</p>';
        $sections=self::sections($data,$files);$html.='<h2>Contents</h2><ol>';
        foreach ($sections as $name=>$rows) $html.='<li>'.esc_html($name).'</li>';
        $html.='</ol>';
        foreach ($sections as $name=>$rows) $html.='<section><h2>'.esc_html($name).'</h2>'.self::value($rows).'</section>';
        return $html.'</article>';
    }
    public static function css() { return 'body{font-family:"DejaVu Sans",sans-serif;font-size:10pt;line-height:1.45;color:#151622;background:#fff;margin:0}.inkfire-brief{max-width:960px;margin:auto;padding:24px}.eyebrow{font-size:9pt;font-weight:bold;letter-spacing:1px;color:#0e5b4e}h1{font-size:25pt;line-height:1.15;margin:6px 0 14px}h2{font-size:15pt;border-bottom:2px solid #fbccbf;padding-bottom:7px;margin-top:28px;page-break-after:avoid}.notice{padding:12px;background:#f4f4f6;border-left:4px solid #0e5b4e}.record-heading{font-size:10pt;margin:6px 0 3px;page-break-after:avoid}.field{margin:6px 0}.field>strong{font-size:10pt;page-break-after:avoid}.record .record{border-left:1px solid #ddd;padding-left:12px;margin:5px 0}.answer{white-space:normal;overflow-wrap:anywhere;word-wrap:break-word;margin:3px 0 9px}.empty{color:#62636c;font-style:italic;margin:3px 0 9px}@page{margin:16mm 14mm 20mm}@media print{.inkfire-brief{padding:0}.brief-tools{display:none}}'; }
    public static function document($data,$context=[],$files=[]) {return '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Inkfire developer brief</title><style>'.self::css().'</style></head><body>'.self::body($data,$context,$files).'</body></html>';}
    public static function pdf($data,$context,$files,$autoload) {
        require_once $autoload;
        $options=new \Dompdf\Options();$options->set('isRemoteEnabled',false);$options->set('isPhpEnabled',false);$options->set('isJavascriptEnabled',false);$options->set('defaultFont','DejaVu Sans');
        $pdf=new \Dompdf\Dompdf($options);$pdf->loadHtml(self::document($data,$context,$files),'UTF-8');$pdf->setPaper('A4');$pdf->render();
        $canvas=$pdf->getCanvas();$canvas->page_text(40,810,'Inkfire · Private brief · Page {PAGE_NUM} of {PAGE_COUNT}',$pdf->getFontMetrics()->getFont('DejaVu Sans'),8,[0.3,0.3,0.3]);
        return $pdf->output();
    }
}
}
