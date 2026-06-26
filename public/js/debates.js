/* debates.js — live debate directory */

function posTag(x, y) {
  return (y >= 0 ? 'Auth' : 'Lib') + '-' + (x >= 0 ? 'R' : 'L');
}

function elapsed(startedAt) {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(secs / 60), s = secs % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderCard(d) {
  const [u1, u2] = d.users;
  const mins = Math.floor((Date.now() - d.startedAt) / 60000);
  const timeStr = mins < 1 ? 'Just started' : mins + 'm live';
  return `
    <div class="debate-card">
      <div class="dc-top">
        <div class="${d.question ? 'dc-question' : 'dc-no-question'}">
          ${d.question ? escHtml(d.question) : 'No topic set yet'}
        </div>
      </div>
      <div class="dc-meta">
        <div class="dc-debaters">
          <span class="dc-debater">
            <span>@${escHtml(u1.username)}</span>
            <span class="dc-debater-pos">${posTag(u1.politicalX, u1.politicalY)}</span>
          </span>
          <span class="dc-vs">vs</span>
          <span class="dc-debater">
            <span>@${escHtml(u2.username)}</span>
            <span class="dc-debater-pos">${posTag(u2.politicalX, u2.politicalY)}</span>
          </span>
        </div>
        <div class="dc-stats">
          <span class="dc-stat">
            <svg style="width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            ${d.spectatorCount} watching
          </span>
          <span class="dc-stat">
            <svg style="width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${timeStr}
          </span>
        </div>
      </div>
      <div class="dc-actions">
        <a href="/spectate?room=${encodeURIComponent(d.roomId)}" class="dc-watch-btn">
          <svg style="width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Watch Live
        </a>
      </div>
    </div>
  `;
}

async function loadDebates() {
  const grid    = document.getElementById('debatesGrid');
  const count   = document.getElementById('debatesCount');
  const btn     = document.getElementById('refreshBtn');
  if (btn) btn.classList.add('spinning');

  try {
    const res  = await fetch('/api/debates');
    const list = await res.json();

    if (count) count.textContent = list.length === 0 ? 'No live debates right now' : list.length + ' live debate' + (list.length === 1 ? '' : 's');

    if (!list.length) {
      grid.innerHTML = `
        <div class="debates-empty">
          <svg style="width:56px;height:56px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;display:block;margin:0 auto" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <h2>No live debates right now</h2>
          <p>Check back soon — debates start frequently. Or <a href="/lobby" style="color:var(--purple)">join one yourself</a>.</p>
        </div>`;
    } else {
      grid.innerHTML = list.map(renderCard).join('');
    }
  } catch {
    if (count) count.textContent = 'Could not load debates';
    grid.innerHTML = '<div class="debates-empty"><p>Failed to load. Check your connection and refresh.</p></div>';
  } finally {
    if (btn) {
      btn.classList.remove('spinning');
    }
  }
}

loadDebates();
// Auto-refresh every 15 seconds
setInterval(loadDebates, 15000);
