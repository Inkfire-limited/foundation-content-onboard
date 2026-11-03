=== Foundation: Content Onboard ===
Contributors: inkfire
Tags: onboarding, content, client portal, editorial workflow
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 8.0
Stable tag: 3.0.9
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Content onboarding portal with an admin editor, token-based client wizard, and a simple structured handoff flow.

== Description ==

Foundation: Content Onboard helps teams collect and manage client content through a guided portal experience.

== Installation ==

1. Upload the `foundation-content-onboard` folder to `/wp-content/plugins/`.
2. Activate the plugin through the WordPress Plugins screen.
3. Open the Foundation content onboarding tools in wp-admin.

== Changelog ==

= 3.0.9 =
* Keep the workspace/save bar above the form as a sticky header.
* Add labelled review-section navigation with keyboard focus and measured sticky-header offsets.
* Compact staff preview actions into a Workspace menu on smaller screens; retain invitation URL fragments and read-only guards.

= 3.0.8 =
* Use available desktop review space with two-column answers and a wider branding overview.
* Replace the revisit disclosure with explicit Skipped and Not answered labels.
* Follow system light and dark mode throughout the answer review and its surrounding controls.

= 3.0.7 =
* Rebuilt the answer review as a left-aligned document with visual brand assets, labelled colour swatches, typography and compact unanswered sections.
* Kept staff previews read-only and preserved saved answers, skipped content and file approval boundaries.

= 3.0.6 =
* Add a read-only developer review with searchable saved answers, PDF access and explicit handoff checks.
* Present project-specific questions and missing answers clearly in the shared browser/PDF brief.
* Separate page titles, status badges and page actions; show all colour swatches and improve file previews.

= 3.0.5 =
* Restore the dark background behind admin wizard previews so saved answers stay readable.
* Improve save-status contrast on the light WordPress admin background.
* Align admin review answers left and increase answer text size for easier scanning.

= 3.0.4 =
* Preserve project-specific answers through saving, reloading, review and export.
* Keep browser recovery copies and encrypted staff-only save-attempt records, including rejected saves.
* Retain up to 50 server attempts per project for 14 days; never restore over live answers automatically.

= 3.0.3 =
* Preserve the production V3 portal, named collaborators, concurrent sessions, presence, revision conflict protection, invitation controls, private files, lifecycle and developer brief tooling.
* Keep the presence indicator visible within the mobile wizard header and dashboard strip.

= 2.4.4 =
* Added a shared Foundation shell dashboard while preserving the existing Content Onboard CPT editor and REST routes.

= 2.4.3 =
* Added GitHub release updater support and repository metadata.
