/**
 * app.js — Shared across all pages
 * Handles: auth state, login, signup, logout, toast, user display
 *
 * IMPORTANT: Change API_URL below before deploying.
 *   - Local development:  http://localhost:8000
 *   - After deployment:   https://your-railway-app.up.railway.app
 */

const API_URL = 'http://localhost:8000';

// ── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let token       = localStorage.getItem('token');

// ── Toast notification ───────────────────────────────────────────────────────
function showToast(msg, duration = 2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 300);
  }, duration);
}

// ── Auth panel switcher (index.html only) ────────────────────────────────────
function showPanel(name) {
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(name + '-panel');
  if (panel) panel.classList.add('active');
}

// ── Show / hide main sections ─────────────────────────────────────────────────
function showAuth() {
  const overlay = document.getElementById('auth-overlay');
  const app     = document.getElementById('app');
  if (overlay) overlay.classList.remove('hidden');
  if (app)     app.classList.add('hidden');
}

function showApp() {
  const overlay = document.getElementById('auth-overlay');
  const app     = document.getElementById('app');
  if (overlay) overlay.classList.add('hidden');
  if (app)     app.classList.remove('hidden');
}

// ── Update nav with user info ─────────────────────────────────────────────────
function updateNavUser() {
  if (!currentUser) return;

  const navCoins  = document.getElementById('nav-coins');
  const navUser   = document.getElementById('nav-username');
  const navAvatar = document.getElementById('nav-avatar');

  if (navCoins)  navCoins.textContent  = currentUser.coins.toLocaleString();
  if (navUser)   navUser.textContent   = currentUser.username;
  if (navAvatar) navAvatar.textContent = currentUser.username.charAt(0).toUpperCase();
}

// ── Fetch current user from API ───────────────────────────────────────────────
async function fetchMe() {
  if (!token) return null;
  try {
    const res = await fetch(`${API_URL}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── checkAuth: called on every page load ─────────────────────────────────────
async function checkAuth() {
  if (!token) {
    // On store.html, redirect to index if not logged in
    if (location.pathname.includes('store.html')) {
      location.href = 'index.html';
      return;
    }
    showAuth();
    return;
  }

  currentUser = await fetchMe();

  if (!currentUser) {
    localStorage.removeItem('token');
    token = null;
    if (location.pathname.includes('store.html')) {
      location.href = 'index.html';
      return;
    }
    showAuth();
    return;
  }

  updateNavUser();

  // Only call showApp() on index.html (store.html doesn't have #app)
  if (!location.pathname.includes('store.html')) {
    showApp();
    if (typeof loadRooms === 'function') loadRooms();
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function login() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');

  errEl.classList.add('hidden');
  errEl.textContent = '';

  if (!email || !password) {
    errEl.textContent = 'Please fill in both fields.';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (res.ok) {
      token = data.access_token;
      localStorage.setItem('token', token);
      currentUser = await fetchMe();
      updateNavUser();
      showApp();
      if (typeof loadRooms === 'function') loadRooms();
    } else {
      errEl.textContent = data.detail || 'Login failed. Check your credentials.';
      errEl.classList.remove('hidden');
    }
  } catch {
    const errEl = document.getElementById('login-error');
    errEl.textContent = 'Cannot reach server. Is the backend running?';
    errEl.classList.remove('hidden');
  }
}

// ── Signup ────────────────────────────────────────────────────────────────────
async function signup() {
  const username = document.getElementById('signup-username').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const errEl    = document.getElementById('signup-error');

  errEl.classList.add('hidden');
  errEl.textContent = '';

  if (!username || !email || !password) {
    errEl.textContent = 'Please fill in all fields.';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });

    const data = await res.json();

    if (res.ok) {
      token = data.access_token;
      localStorage.setItem('token', token);
      currentUser = await fetchMe();
      updateNavUser();
      showApp();
      showToast(`Welcome to ChillChat, ${currentUser.username}! 🎉 You have 100 free coins.`);
      if (typeof loadRooms === 'function') loadRooms();
    } else {
      errEl.textContent = data.detail || 'Signup failed. Try a different email or username.';
      errEl.classList.remove('hidden');
    }
  } catch {
    const errEl = document.getElementById('signup-error');
    errEl.textContent = 'Cannot reach server. Is the backend running?';
    errEl.classList.remove('hidden');
  }
}

// ── Logout ────────────────────────────────────────────────────────────────────
async function logout() {
  try {
    if (token) {
      await fetch(`${API_URL}/api/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch { /* ignore */ }

  localStorage.removeItem('token');
  token = null;
  currentUser = null;
  location.reload();
}

// ── Init on DOM ready ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', checkAuth);

// Allow pressing Enter in auth forms
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const loginPanel  = document.getElementById('login-panel');
  const signupPanel = document.getElementById('signup-panel');
  if (loginPanel  && loginPanel.classList.contains('active'))  login();
  if (signupPanel && signupPanel.classList.contains('active')) signup();
});
