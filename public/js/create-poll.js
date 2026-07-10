/* create-poll.js — full-page "create a poll" flow, used inside the Android
   app (and available at /create-poll generally) instead of the popup modal
   divide.js shows on desktop/mobile web. */

let currentIdToken = null;

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const colors = { success: 'var(--green)', error: 'var(--red)', info: 'var(--purple)' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon" style="color:${colors[type]}"></span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = '/login'; return; }
  try {
    currentIdToken = await user.getIdToken();
  } catch {
    showToast('Could not verify your session. Check your connection.', 'error');
  }
});

const CREATE_POLL_MAX_OPTIONS = 6;

function addCreatePollOptionRow() {
  const list = document.getElementById('createPollOptionsList');
  if (!list || list.children.length >= CREATE_POLL_MAX_OPTIONS) return;
  const row = document.createElement('div');
  row.className = 'poll-form-option-row';
  const idx = list.children.length + 1;
  row.innerHTML =
    `<input class="form-input create-poll-option-input" type="text" placeholder="Option ${idx}" maxlength="120" />` +
    `<button type="button" class="btn btn-ghost btn-sm" onclick="this.parentElement.remove(); updateAddCreatePollOptionBtn()" aria-label="Remove option">&times;</button>`;
  list.appendChild(row);
  updateAddCreatePollOptionBtn();
}

function updateAddCreatePollOptionBtn() {
  const list = document.getElementById('createPollOptionsList');
  const addBtn = document.getElementById('addCreatePollOptionBtn');
  if (list && addBtn) addBtn.style.display = list.children.length >= CREATE_POLL_MAX_OPTIONS ? 'none' : '';
}

// Start with the two blank rows the modal version always opens with.
addCreatePollOptionRow();
addCreatePollOptionRow();

async function submitUserPoll() {
  const questionEl = document.getElementById('createPollQuestion');
  const question = (questionEl?.value || '').trim();
  const options = [...document.querySelectorAll('.create-poll-option-input')]
    .map(i => i.value.trim()).filter(Boolean);
  const category = document.getElementById('createPollCategorySelect')?.value || 'general';
  const tags = (document.getElementById('createPollTagsInput')?.value || '')
    .split(',').map(t => t.trim()).filter(Boolean);
  const statusEl = document.getElementById('createPollStatus');

  if (!question) { statusEl.textContent = 'Question is required.'; statusEl.style.color = 'var(--red)'; return; }
  if (options.length < 2) { statusEl.textContent = 'Provide at least 2 options.'; statusEl.style.color = 'var(--red)'; return; }

  const submitBtn = document.getElementById('createPollSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;
  statusEl.textContent = 'Posting…';
  statusEl.style.color = 'var(--text-3)';

  try {
    const res = await fetch('/api/polls/submit', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + currentIdToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, options, category, tags })
    });
    const data = await res.json();
    if (!res.ok) { statusEl.textContent = data.error || 'Error posting poll.'; statusEl.style.color = 'var(--red)'; return; }

    showToast('Poll posted!', 'success');
    setTimeout(() => { window.location.href = '/divide'; }, 500);
  } catch {
    statusEl.textContent = 'Network error.';
    statusEl.style.color = 'var(--red)';
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}
