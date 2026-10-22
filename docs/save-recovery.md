# Answer persistence and recovery (3.0.4)

Project-specific answers are maps keyed by question ID. PHP may return an empty map as `[]`. Convert that array into an object before serializing it, while preserving existing object identity: input handlers retain references to the answer map. Lists of selected options remain arrays. Final review, save requests and JSON exports use the same answer values.

## Recovery records

- The browser checkpoints entered data into IndexedDB before the autosave request, and while editing after a conflict. A later page load offers a download of an earlier unsaved copy. Nothing is restored automatically. Copies are scoped by project and page instance, expire after 14 days and are capped at 20 per project. Expired browser copies are removed on subsequent checkpoint activity, not by a background service. Browser storage can be unavailable or cleared by the user/browser.
- After the existing project/session/origin/CSRF permission check, the server retains the incoming answer payload **before validation or revision checking**. A rejected validation or conflict still has a recovery record. Permission failures that occur before the save handler cannot create a server record; browser checkpoints cover that path.
- `wp_fco_save_attempts` (using the installation's actual prefix) contains AES-256-GCM encrypted answer copies, a checksum, client/server references, base/saved revisions, outcome code and UTC timestamp. It never contains invitation tokens, cookies or request headers. General PHP logs contain correlation metadata only, not answer text.
- Up to 50 server attempts per project are retained for 14 days. A daily WordPress cron removes expired records while the plugin is active; reads exclude expired records immediately. The answer payload cap is the existing 4 MB project limit. Browser checkpoints remain the fallback for oversized or unreceived requests. Neither browser storage nor unavailable database/disk service can guarantee recovery during a simultaneous storage failure.
- Encryption uses a separate `answer-recovery` purpose derived from the WordPress auth salt. Preserve the site's salts with protected backups; rotating them makes previous encrypted recovery copies unreadable.

## Staff access

Open **Client Onboarding → Save recovery**, enter the project ID, and choose a recovery JSON record. Only WordPress administrators (`manage_options`) can list/decrypt records. REST routes are:

```
GET /wp-json/inkfire-onboard/v1/projects/{project_id}/save-attempts
GET /wp-json/inkfire-onboard/v1/projects/{project_id}/save-attempts/{attempt_id}
```

Normal cookie REST authentication requires its nonce. Project invitation access does not grant recovery-journal access. Reads enforce both project ID and record ID. Responses use the hub's private/no-store headers.

Compare a recovery copy with the current saved revision before applying individual answers. Never replace newer client work wholesale with an older export. Recovery does not submit, email, publish or deliver anything.

## Regression checks

Run `npm ci --ignore-scripts` and `npm test`. The tests exercise the real save bridge and IndexedDB transactions, including serialization, retained input-handler references, rejected/network/session saves, reload recovery, in-flight edits and project isolation. GitHub Actions runs these checks and PHP/JavaScript syntax checks.

For a live release, create a disposable project without sending invitations. Enter text, multiline, single and multiple-choice answers. Confirm the values after a reload and in final review, export and the authoritative database. Advance only that QA project's revision from another session; verify a rejected answer remains available in the browser and encrypted server journal without replacing the newer saved answer. Never use a real client project for write testing.

## Deployment and rollback

Back up the database and plugin before deploying. Version and asset build parameters invalidate stale browser assets on the next page load; already-open old pages keep their old JavaScript until reloaded. Do not tell a client with unsaved old-page answers to reload before preserving them.

Rollback only the changed plugin files. Leave recovery records intact for investigation. A whole-database restore would overwrite unrelated client work and is not an appropriate code rollback.
