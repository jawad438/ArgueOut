/* contact.js — Contact form: subject/message + up to 3MB of image/video attachments */

const CONTACT_MAX_BYTES = 3 * 1024 * 1024;
let contactFiles = [];

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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderContactFiles() {
  const list = document.getElementById('contactFileList');
  const meter = document.getElementById('contactSizeMeter');
  list.innerHTML = contactFiles.map((f, i) => `
    <div class="contact-file-chip">
      <span>${escapeHtmlContact(f.name)} (${formatBytes(f.size)})</span>
      <button type="button" onclick="removeContactFile(${i})" aria-label="Remove">
        <svg style="width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join('');

  const total = contactFiles.reduce((sum, f) => sum + f.size, 0);
  const over = total > CONTACT_MAX_BYTES;
  meter.textContent = contactFiles.length ? `${formatBytes(total)} / 3 MB` : '';
  meter.classList.toggle('over', over);
  const submitBtn = document.getElementById('contactSubmitBtn');
  if (submitBtn) submitBtn.disabled = over;
}

function escapeHtmlContact(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function removeContactFile(index) {
  contactFiles.splice(index, 1);
  renderContactFiles();
}

document.getElementById('contactFiles')?.addEventListener('change', (e) => {
  contactFiles.push(...[...e.target.files]);
  e.target.value = '';
  renderContactFiles();
});

async function submitContactForm() {
  const name = document.getElementById('contactName').value.trim();
  const email = document.getElementById('contactEmail').value.trim();
  const subject = document.getElementById('contactSubject').value.trim();
  const message = document.getElementById('contactMessage').value.trim();
  const statusEl = document.getElementById('contactStatus');

  if (!subject) { statusEl.textContent = 'Subject is required.'; statusEl.style.color = 'var(--red)'; return; }
  if (!message) { statusEl.textContent = 'Message is required.'; statusEl.style.color = 'var(--red)'; return; }
  const total = contactFiles.reduce((sum, f) => sum + f.size, 0);
  if (total > CONTACT_MAX_BYTES) { statusEl.textContent = 'Attachments must total 3MB or less.'; statusEl.style.color = 'var(--red)'; return; }

  const submitBtn = document.getElementById('contactSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;
  statusEl.textContent = 'Sending…';
  statusEl.style.color = 'var(--text-3)';

  try {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('email', email);
    formData.append('subject', subject);
    formData.append('message', message);
    contactFiles.forEach(f => formData.append('attachments', f));

    const res = await fetch('/api/contact', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) { statusEl.textContent = data.error || 'Error sending message.'; statusEl.style.color = 'var(--red)'; return; }

    document.getElementById('contactSubject').value = '';
    document.getElementById('contactMessage').value = '';
    contactFiles = [];
    renderContactFiles();
    statusEl.textContent = '';
    showToast('Message sent — thanks for reaching out!', 'success');
  } catch {
    statusEl.textContent = 'Network error.';
    statusEl.style.color = 'var(--red)';
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}
