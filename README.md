# Foundation: Content Onboard

Content onboarding portal for WordPress. Provides an admin-side content editor, a
token-based client wizard, and a structured handoff flow for collecting client content
without giving clients wp-admin accounts.

Part of the Foundation plugin series by Inkfire Limited.

## Status

| | |
|---|---|
| Current version | 2.4.4 |
| Requires WordPress | 6.0+ |
| Tested up to | 6.9 |
| Requires PHP | 7.4+ |
| Licence | GPLv2 or later |
| Main file | `foundation-content-onboard.php` |

## What it does

- **Admin editor** — build and manage content briefs as a custom post type
- **Token-based client wizard** — clients complete a guided content submission flow using
  a tokenised link, with no WordPress account required
- **Structured handoff** — collected content lands back in wp-admin in a reviewable form
- **REST routes** for the wizard front end
- **Shared Foundation admin shell** for a consistent look across the Foundation suite

## Installation

1. Install the release ZIP via **Plugins → Add New → Upload Plugin**, or upload the
   `foundation-content-onboard` folder to `/wp-content/plugins/`.
2. Activate through the **Plugins** screen.
3. Open the Foundation content onboarding tools in wp-admin.

## Updates

The plugin bundles [Plugin Update Checker](https://github.com/YahnisElsts/plugin-update-checker)
and tracks GitHub releases on this repository. Only published releases are offered to
sites — drafts are ignored.

### Release process

1. Bump the version header in `foundation-content-onboard.php` **and** the `Stable tag` in
   `readme.txt`. Both must match the release tag.
2. Commit and push.
3. Create and push a tag matching that version.
4. Publish a GitHub release against the tag with the plugin ZIP attached as an asset.

## Repository layout

```
assets/                          Admin CSS and JS
includes/                        Plugin logic, CPT registration, REST routes, wizard
plugin-update-checker/           Bundled updater library
foundation-content-onboard.php   Plugin bootstrap
readme.txt                       WordPress-format readme consumed by the updater
uninstall.php                    Cleanup on uninstall
```

`readme.txt` is parsed by the updater for version and changelog data. Keep the changelog
there; this file is the human-readable overview.

## A note on client data

Client submissions are stored in the host WordPress database, not in this repository.
Wizard tokens are per-brief and expire. Nothing client-identifying should be committed
here.

## Why this repository is public

The updater resolves release assets without authentication when the repository is public,
avoiding the need to distribute a read-scoped GitHub token to every site running the
plugin. The code contains no credentials or client data.

## Source of truth

The live installation on inkfire.co.uk is authoritative. This repository was verified
byte-identical to the live copy on 2026-08-05. If they diverge, reconcile from live.

## Licence

GPLv2 or later. See [LICENSE](LICENSE).
