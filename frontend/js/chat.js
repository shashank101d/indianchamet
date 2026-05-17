/**
 * chat.js — Real-time chat logic for index.html
 *
 * Depends on: app.js (currentUser, token, API_URL, showToast)
 *
 * Responsibilities:
 *   - Load rooms into sidebar
 *   - Join a room (load history + open WebSocket)
 *   - Send / receive messages
 *   - Typing indicators
 *   - Online user list (right sidebar)
 *   - Gift modal (select user → pick gift → send)
 *   - Random chat matching
 */

// ── State ─────────────────────────────────────────────────────────────────────
let socket          = null;
let currentRoomId   = null;
let typingTimer     = null;
let selectedUserId  = null;
let selectedUname   = null;
let selectedGift    = null;

// ── EMOJI MAP ─────────────────────────────────────────────────────────────────
const TOPIC_EMOJI = {
  general:       '💬',
  gaming:        '🎮',
  music:         '🎵',
  entertainment: '🎬',
  random:        '🎲',
};

// ═════════════════════════════════════════════════════════════════════════════
// ROOMS
// ═════════════════════════════════════════════════════════════════════════════

async function loadRooms() {
  try {
    const res = await fetch(`${API_URL}/api/rooms`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;

    const rooms = await res.json();
    const list  = document.getElementById('room-list');
    list.innerHTML = '';

    rooms.forEach(room => {
      const emoji = TOPIC_EMOJI[room.topic] || '💬';
      const div = document.createElement('div');
      div.className  = 'room-item';
      div.dataset.id = room.id;
      div.innerHTML  = `<span class="room-emoji">${emoji}</span> ${escHtml(room.name)}`;
      div.onclick    = () => joinRoom(room.id, room.name, div);
      list.appendChild(div);
    });
  } catch (err) {
    console.error('loadRooms error:', err);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// JOIN ROOM
// ═════════════════════════════════════════════════════════════════════════════

async function joinRoom(roomId, roomName, clickedEl) {
  if (socket) {
    socket.close();
    socket = null;
  }

  currentRoomId = roomId;
  selectedUserId = null;
  selectedUname  = null;

  // Highlight active room
  document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
  if (clickedEl) clickedEl.classList.add('active');

  // Update nav title
  const navName = document.getElementById('nav-room-name');
  if (navName) navName.textContent = roomName;

  // Show chat view
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');

  // Clear messages
  document.getElementById('messages-container').innerHTML = '';
  document.getElementById('typing-bar').classList.add('hidden');
  clearUserList();

  // Load message history then open WS
  await loadHistory(roomId);
  openWebSocket(roomId);
}

// ── History ───────────────────────────────────────────────────────────────────
async function loadHistory(roomId) {
  try {
    const res = await fetch(`${API_URL}/api/rooms/${roomId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;

    const messages = await res.json();
    messages.forEach(msg => appendMessage(msg));
    scrollBottom();
  } catch (err) {
    console.error('loadHistory error:', err);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// WEBSOCKET
// ═════════════════════════════════════════════════════════════════════════════

function openWebSocket(roomId) {
  // Convert http:// → ws://  or  https:// → wss://
  const wsBase = API_URL.replace(/^http/, 'ws');
  socket = new WebSocket(`${wsBase}/ws/chat/${roomId}?token=${token}`);

  socket.onopen = () => {
    console.log(`WS connected → room ${roomId}`);
  };

  socket.onmessage = (ev) => {
    try {
      handleWsMessage(JSON.parse(ev.data));
    } catch { /* ignore malformed */ }
  };

  socket.onclose = () => {
    console.log('WS closed');
  };

  socket.onerror = (err) => {
    console.error('WS error:', err);
  };
}

function handleWsMessage(data) {
  switch (data.type) {
    case 'message':
      appendMessage(data);
      scrollBottom();
      break;

    case 'room_users':
      renderUserList(data.users);
      break;

    case 'user_joined':
      addUserToList(data.user_id, data.username);
      addSystemMsg(`${data.username} joined`);
      break;

    case 'user_left':
      removeUserFromList(data.user_id);
      addSystemMsg(`${data.username} left`);
      break;

    case 'typing':
      showTyping(data.username);
      break;

    case 'partner_left':
      addSystemMsg(data.message || 'Your partner left the chat.');
      break;

    case 'matched':
      document.getElementById('nav-room-name').textContent =
        `Chatting with ${data.partner.username}`;
      document.getElementById('messages-container').innerHTML = '';
      addSystemMsg(`You are now chatting with ${data.partner.username}!`);
      break;

    case 'waiting':
      addSystemMsg('Waiting for someone to connect…');
      break;

    default:
      break;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SEND MESSAGE
// ═════════════════════════════════════════════════════════════════════════════

function sendMessage() {
  const input   = document.getElementById('msg-input');
  const content = input.value.trim();

  if (!content) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast('Not connected — please select a room.');
    return;
  }

  socket.send(JSON.stringify({ type: 'message', content }));
  input.value = '';
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
    return;
  }
  // Typing indicator
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'typing' }));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MESSAGE UI
// ═════════════════════════════════════════════════════════════════════════════

function appendMessage(msg) {
  const container = document.getElementById('messages-container');
  const isOwn     = currentUser && msg.sender_id === currentUser.id;

  const wrap = document.createElement('div');
  wrap.className = `msg-wrap ${isOwn ? 'own' : 'other'}`;

  const timeStr = msg.created_at ? fmtTime(msg.created_at) : '';

  wrap.innerHTML = `
    ${!isOwn ? `<div class="msg-sender">${escHtml(msg.sender_username || '')}</div>` : ''}
    <div class="msg-bubble">${escHtml(msg.content)}</div>
    <div class="msg-time">${timeStr}</div>
  `;

  container.appendChild(wrap);
}

function addSystemMsg(text) {
  const container = document.getElementById('messages-container');
  const div = document.createElement('div');
  div.className   = 'system-msg';
  div.textContent = text;
  container.appendChild(div);
  scrollBottom();
}

function scrollBottom() {
  const container = document.getElementById('messages-container');
  if (container) container.scrollTop = container.scrollHeight;
}

// ═════════════════════════════════════════════════════════════════════════════
// TYPING INDICATOR
// ═════════════════════════════════════════════════════════════════════════════

function showTyping(username) {
  const bar  = document.getElementById('typing-bar');
  const text = document.getElementById('typing-text');
  if (!bar || !text) return;
  text.textContent = `${username} is typing…`;
  bar.classList.remove('hidden');
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => bar.classList.add('hidden'), 2200);
}

// ═════════════════════════════════════════════════════════════════════════════
// USER LIST (right sidebar)
// ═════════════════════════════════════════════════════════════════════════════

function renderUserList(users) {
  clearUserList();
  users.forEach(u => addUserToList(u.user_id, u.username));
}

function addUserToList(userId, username) {
  const list = document.getElementById('user-list');
  // Don't duplicate
  if (list.querySelector(`[data-uid="${userId}"]`)) return;

  // Remove "no one yet" placeholder
  const placeholder = list.querySelector('.no-users');
  if (placeholder) placeholder.remove();

  const item = document.createElement('div');
  item.className = 'user-item';
  item.dataset.uid = userId;
  item.title = `Click to select for gift`;
  item.innerHTML = `
    <div class="u-avatar">${username.charAt(0).toUpperCase()}</div>
    <span class="u-name">${escHtml(username)}</span>
    <div class="u-dot"></div>
  `;
  item.onclick = () => selectUser(userId, username, item);
  list.appendChild(item);
}

function removeUserFromList(userId) {
  const item = document.getElementById('user-list')
                       .querySelector(`[data-uid="${userId}"]`);
  if (item) item.remove();
  if (selectedUserId === userId) {
    selectedUserId = null;
    selectedUname  = null;
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('selected'));
  }
}

function clearUserList() {
  const list = document.getElementById('user-list');
  list.innerHTML = '<p class="no-users">No one yet…</p>';
  selectedUserId = null;
  selectedUname  = null;
}

function selectUser(userId, username, el) {
  // Don't select yourself
  if (currentUser && userId === currentUser.id) {
    showToast("That's you!");
    return;
  }
  selectedUserId = userId;
  selectedUname  = username;
  document.querySelectorAll('.user-item').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  showToast(`Selected ${username} — press 🎁 to send a gift`);
}

// ═════════════════════════════════════════════════════════════════════════════
// GIFT MODAL
// ═════════════════════════════════════════════════════════════════════════════

async function openGiftModal() {
  selectedGift = null;

  const label = document.getElementById('gift-target-label');
  if (selectedUserId) {
    label.textContent = `Sending to: ${selectedUname}`;
  } else {
    label.textContent = 'Select a user first (click their name in the sidebar)';
  }

  // Load gift types
  try {
    const res   = await fetch(`${API_URL}/api/gifts/types`);
    const gifts = await res.json();

    const grid = document.getElementById('gift-grid');
    grid.innerHTML = '';

    gifts.forEach(g => {
      const card = document.createElement('div');
      card.className     = 'gift-card';
      card.dataset.type  = g.type;
      card.dataset.cost  = g.cost;
      card.innerHTML = `
        <span class="g-emoji">${g.emoji}</span>
        <div class="g-cost">💰 ${g.cost}</div>
      `;
      card.onclick = () => {
        document.querySelectorAll('.gift-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedGift = g;
      };
      grid.appendChild(card);
    });

    // Add send button if not present
    let sendBtn = document.getElementById('gift-send-btn');
    if (!sendBtn) {
      sendBtn = document.createElement('button');
      sendBtn.id        = 'gift-send-btn';
      sendBtn.className = 'gift-send-btn';
      sendBtn.textContent = 'Send Gift';
      sendBtn.onclick   = sendGift;
      grid.parentElement.appendChild(sendBtn);
    }
  } catch (err) {
    console.error('gift types error:', err);
  }

  document.getElementById('gift-modal').classList.remove('hidden');
}

function closeGiftModal(event) {
  // If clicking overlay background, close; clicking inside, don't
  if (event && event.target !== document.getElementById('gift-modal')) return;
  document.getElementById('gift-modal').classList.add('hidden');
}

async function sendGift() {
  if (!selectedUserId) {
    showToast('Select a user first!');
    return;
  }
  if (!selectedGift) {
    showToast('Pick a gift!');
    return;
  }
  if (!currentUser || currentUser.coins < selectedGift.cost) {
    showToast('Not enough coins! 💰 Visit the store to buy more.');
    document.getElementById('gift-modal').classList.add('hidden');
    return;
  }

  const btn = document.getElementById('gift-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  try {
    const res = await fetch(`${API_URL}/api/gifts/send`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ gift_type: selectedGift.type, receiver_id: selectedUserId }),
    });

    const data = await res.json();

    if (res.ok) {
      currentUser.coins = data.remaining_coins;
      updateNavUser();
      document.getElementById('gift-modal').classList.add('hidden');
      showToast(`${selectedGift.emoji} Gift sent to ${selectedUname}!`);
      addSystemMsg(`You sent a ${selectedGift.emoji} gift to ${selectedUname}!`);
    } else {
      showToast(data.detail || 'Gift failed');
    }
  } catch {
    showToast('Error sending gift');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Gift'; }
    selectedGift = null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// RANDOM CHAT
// ═════════════════════════════════════════════════════════════════════════════

function startRandomChat() {
  if (socket) { socket.close(); socket = null; }

  currentRoomId = null;
  document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));

  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');
  document.getElementById('messages-container').innerHTML = '';
  document.getElementById('nav-room-name').textContent = '🎲 Finding a match…';
  clearUserList();

  const wsBase = API_URL.replace(/^http/, 'ws');
  socket = new WebSocket(`${wsBase}/ws/random?token=${token}`);

  socket.onmessage = (ev) => {
    try { handleWsMessage(JSON.parse(ev.data)); } catch { /* skip */ }
  };

  socket.onerror = () => showToast('Random chat error — try again');
  socket.onclose = () => console.log('Random WS closed');
}

// ═════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}
