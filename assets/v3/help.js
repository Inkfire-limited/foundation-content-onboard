(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    const trigger = document.getElementById('fco-help-open');
    if (!trigger) return;
    trigger.addEventListener('click', function () {
      const C = window.FCO_Config, B = window.FCO_HubBridge;
      const dialog = document.createElement('dialog');
      dialog.className = 'fco-help-dialog';
      dialog.setAttribute('aria-labelledby', 'fco-help-title');
      dialog.innerHTML = `<form id="fco-help-form">
        <div class="fco-help-head"><h2 id="fco-help-title">How can we help?</h2><button type="button" id="fco-help-close" aria-label="Close help">×</button></div>
        <p>Tell us where you are stuck. Your message goes to <a href="mailto:support@inkfire.co.uk">support@inkfire.co.uk</a>.</p>
        <div class="fco-help-fields"><label>Your name<input name="name" autocomplete="name" maxlength="120" required></label>
        <label>Your email<input name="email" type="email" autocomplete="email" maxlength="254" required></label></div>
        <label>What do you need help with?<select name="topic"><option>Question about a slide</option><option>Access problem</option><option>Upload problem</option><option>Other</option></select></label>
        <label>Describe the issue<textarea name="message" rows="5" minlength="10" maxlength="5000" required aria-describedby="fco-help-note"></textarea></label>
        <p id="fco-help-note">Include what you expected and what happened. Please do not include passwords, payment details or your private invitation link.</p>
        <div hidden aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <p id="fco-help-status" role="status" aria-live="polite"></p>
        <button type="submit" id="fco-help-send">Send to support</button>
      </form>`;
      document.body.appendChild(dialog);
      const form = dialog.querySelector('form'), status = dialog.querySelector('#fco-help-status');
      form.elements.name.value = B.context.contact_name || (C.user.name === 'Your team' ? '' : C.user.name) || '';
      const close = () => { dialog.close(); dialog.remove(); trigger.focus(); };
      dialog.querySelector('#fco-help-close').addEventListener('click', close);
      dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const button = dialog.querySelector('#fco-help-send');
        if (C.previewOnly) { status.textContent = 'Preview only — no message was sent. Open a client project or close preview to contact support.'; return; }
        button.disabled = true; status.textContent = 'Sending your message…';
        try {
          const payload = Object.fromEntries(new FormData(form));
          payload.project_id = C.projectId || 0;
          payload.support_nonce = C.supportNonce;
          payload.slide = document.querySelector('#fco-client-app [data-wizard-step]')?.getAttribute('data-wizard-step') || document.getElementById('fco-client-app')?.dataset.wizardStep || 'Welcome / invitation';
          const headers = {'Content-Type':'application/json'};
          if (C.supportRestNonce) headers['X-WP-Nonce'] = C.supportRestNonce;
          if (B.csrf) headers['X-FCO-CSRF'] = B.csrf;
          const response = await fetch(C.hubRoot + '/support', {method:'POST',credentials:'same-origin',cache:'no-store',headers,body:JSON.stringify(payload)});
          const result = await response.json();
          if (!response.ok) throw new Error(result.message || 'Unable to send. Please email support@inkfire.co.uk.');
          status.textContent = result.message;
          button.textContent = 'Message sent';
        } catch (error) { status.textContent = error.message; button.disabled = false; }
      });
      dialog.showModal(); form.elements.name.focus();
    });
  });
})();
