(function ($) {
'use strict';
const C = window.FCO_Config, B = window.FCO_HubBridge, A = window.FCO_App;
if (!C || !B || !A || C.isAdmin) return;
let saveState = 'saved';
function refreshControls() {
  // Staff previews own their own read-only dock. Never change their controls.
  if (!document.body.classList.contains('fco-standalone')) return;
  const app = document.getElementById('fco-client-app');
  const dock = document.querySelector('#fco-portal-project > .fco-project-strip');
  if (C.previewOnly) { if (dock) dock.hidden = false; return; }
  const save = document.getElementById('fco-save-now');
  const submit = document.getElementById('fco-submit-project');
  if (!app || !dock || !save || !submit) return;
  const wizard = app.classList.contains('mode-wizard');
  const editor = app.classList.contains('mode-editor');
  dock.hidden = !(wizard || editor);
  submit.hidden = !(editor || (wizard && app.dataset.wizardStep === 'outro'));
  // Recovery owns the retry action, including after a later edit or mode switch.
  save.hidden = !!document.getElementById('fco-recovery') || !['dirty', 'error'].includes(saveState);
  save.textContent = saveState === 'error' ? 'Retry save' : 'Save now';
  save.disabled = saveState === 'saving' || B.conflict || B.accessRequired;
  dock.dataset.saveState = saveState;
  if (save.hidden && document.activeElement === save) {
    const status = dock.querySelector('.fco-hub-save');
    if (status) { status.tabIndex = -1; status.focus({preventScroll:true}); }
  }
}
const originalState = B.state;
B.state = function (state) {
  saveState = state || 'saved';
  originalState.call(B, state);
  refreshControls();
};
A.setSaveState = B.state;
const originalSwitch = A.switchMode;
A.switchMode = function (mode) {
  originalSwitch.call(A, mode);
  refreshControls();
};
document.addEventListener('fco:steps', refreshControls);
document.addEventListener('fco:recovery', refreshControls);
$(refreshControls);
})(jQuery);
