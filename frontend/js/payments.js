/**
 * payments.js — Stripe coin store logic for store.html
 *
 * Depends on: app.js (currentUser, token, API_URL, showToast, updateNavUser)
 *
 * HOW IT WORKS:
 *  1. loadPackages() fetches coin packages from API and renders cards
 *  2. User clicks a package → selectPackage() calls /api/payments/create-intent
 *  3. Backend returns a Stripe client_secret
 *  4. submitPayment() calls stripe.confirmCardPayment() with the secret
 *  5. On success → show success section
 *
 * SETUP:
 *  Replace 'pk_test_YOUR_PUBLISHABLE_KEY' below with your actual Stripe
 *  publishable key from stripe.com → Developers → API Keys.
 */

// ── IMPORTANT: Replace with your real Stripe publishable key ─────────────────
const STRIPE_PUBLISHABLE_KEY = 'pk_test_YOUR_PUBLISHABLE_KEY_HERE';

// ── State ─────────────────────────────────────────────────────────────────────
let stripe         = null;
let cardElement    = null;
let clientSecret   = null;
let selectedPkg    = null;

// ═════════════════════════════════════════════════════════════════════════════
// INIT — runs after checkAuth() resolves on DOMContentLoaded
// ═════════════════════════════════════════════════════════════════════════════

async function initStore() {
  // Init Stripe (Stripe.js loaded via <script> in store.html)
  if (typeof Stripe === 'undefined') {
    console.error('Stripe.js not loaded');
    return;
  }

  stripe = Stripe(STRIPE_PUBLISHABLE_KEY);

  const elements   = stripe.elements({ appearance: stripeAppearance() });
  cardElement      = elements.create('card');
  cardElement.mount('#card-element');

  cardElement.on('change', (ev) => {
    const errEl = document.getElementById('card-errors');
    errEl.textContent = ev.error ? ev.error.message : '';
  });

  await loadPackages();
}

// ── Stripe appearance (matches dark theme) ────────────────────────────────────
function stripeAppearance() {
  return {
    theme: 'night',
    variables: {
      colorPrimary:        '#f0a500',
      colorBackground:     '#1c2330',
      colorText:           '#e6edf3',
      colorDanger:         '#f85149',
      fontFamily:          'DM Sans, sans-serif',
      spacingUnit:         '4px',
      borderRadius:        '8px',
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// LOAD PACKAGES
// ═════════════════════════════════════════════════════════════════════════════

async function loadPackages() {
  try {
    const res  = await fetch(`${API_URL}/api/store/packages`);
    const pkgs = await res.json();

    const grid = document.getElementById('packages-grid');
    grid.innerHTML = '';

    pkgs.forEach(pkg => {
      const card = document.createElement('div');
      card.className    = `pkg-card${pkg.popular ? ' popular' : ''}`;
      card.dataset.id   = pkg.id;
      card.innerHTML = `
        ${pkg.popular ? '<div class="pkg-badge">BEST VALUE</div>' : ''}
        <div class="pkg-coins">💰 ${pkg.coins.toLocaleString()}</div>
        <div class="pkg-label">coins</div>
        <div class="pkg-price">${pkg.price}</div>
      `;
      card.onclick = () => selectPackage(pkg, card);
      grid.appendChild(card);
    });
  } catch (err) {
    showToast('Failed to load packages. Is the backend running?');
    console.error(err);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SELECT PACKAGE → create Stripe PaymentIntent
// ═════════════════════════════════════════════════════════════════════════════

async function selectPackage(pkg, cardEl) {
  selectedPkg    = pkg;
  clientSecret   = null;

  // Highlight selected
  document.querySelectorAll('.pkg-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');

  // Show payment section
  document.getElementById('payment-section').classList.remove('hidden');
  document.getElementById('success-section').classList.add('hidden');

  // Update summary
  document.getElementById('payment-summary').innerHTML = `
    <strong>Order Summary</strong><br>
    💰 ${pkg.coins.toLocaleString()} coins<br>
    Price: <strong>${pkg.price}</strong>
  `;

  // Create PaymentIntent on backend
  const payBtn = document.getElementById('pay-btn');
  payBtn.disabled   = true;
  payBtn.textContent = 'Preparing…';

  try {
    const res  = await fetch(`${API_URL}/api/payments/create-intent`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ package_id: pkg.id }),
    });

    const data = await res.json();

    if (res.ok) {
      clientSecret = data.client_secret;
      payBtn.disabled   = false;
      payBtn.textContent = `Pay ${pkg.price} 🔒`;
    } else {
      showToast(data.detail || 'Failed to initialise payment');
      payBtn.disabled   = false;
      payBtn.textContent = 'Pay Now 🔒';
    }
  } catch (err) {
    showToast('Cannot reach server');
    console.error(err);
    payBtn.disabled   = false;
    payBtn.textContent = 'Pay Now 🔒';
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SUBMIT PAYMENT
// ═════════════════════════════════════════════════════════════════════════════

async function submitPayment() {
  if (!clientSecret) {
    showToast('Please select a package first');
    return;
  }

  const payBtn = document.getElementById('pay-btn');
  payBtn.disabled   = true;
  payBtn.textContent = 'Processing…';

  const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
    payment_method: { card: cardElement },
  });

  if (error) {
    document.getElementById('card-errors').textContent = error.message;
    payBtn.disabled   = false;
    payBtn.textContent = `Pay ${selectedPkg.price} 🔒`;
    return;
  }

  if (paymentIntent.status === 'succeeded') {
    // Update local coin count immediately (webhook will also update DB)
    if (currentUser && selectedPkg) {
      currentUser.coins += selectedPkg.coins;
      updateNavUser();
    }

    document.getElementById('payment-section').classList.add('hidden');
    document.getElementById('packages-grid').classList.add('hidden');

    document.getElementById('success-msg').textContent =
      `💰 ${selectedPkg.coins.toLocaleString()} coins have been added to your account!`;

    document.getElementById('success-section').classList.remove('hidden');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CANCEL PAYMENT
// ═════════════════════════════════════════════════════════════════════════════

function cancelPayment() {
  document.getElementById('payment-section').classList.add('hidden');
  document.getElementById('card-errors').textContent = '';
  clientSecret = null;
  selectedPkg  = null;
  document.querySelectorAll('.pkg-card').forEach(c => c.classList.remove('selected'));

  const payBtn = document.getElementById('pay-btn');
  payBtn.disabled   = false;
  payBtn.textContent = 'Pay Now 🔒';
}

// ═════════════════════════════════════════════════════════════════════════════
// HOOK INTO checkAuth FLOW
// Store page doesn't have #app so we hook into the DOMContentLoaded after
// checkAuth() validates the user.
// ═════════════════════════════════════════════════════════════════════════════

// Override: after auth is validated on the store page, init Stripe + load packages
const _origCheckAuth = window.checkAuth;
window.checkAuth = async function () {
  await _origCheckAuth.call(this);
  // If we're on the store page and auth succeeded, init store
  if (location.pathname.includes('store.html') && currentUser) {
    initStore();
  }
};
