import {
  auth,
  userStateRef,
  getDoc,
  setDoc,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from './firebase.js';
console.log("🔥 SCRIPT.JS MODULE STARTED");

const E = window.PocketPilotEngine;
if (!E) throw new Error('PocketPilot_Engine.js must load before script.js');

const page = location.pathname.split('/').pop() || 'index.html';
const isLogin = page === 'login.html';
let currentUser = null;
let currentState = null;
let chatHistory = [];

function getUserInitials(user) {
  if (!user || !user.email) return '??';

  const username = user.email.split('@')[0];

  const parts = username
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  return username.slice(0, 2).toUpperCase();
}

function updateUserInitials(user) {
  const initials = getUserInitials(user);

  document.querySelectorAll('.profile-avatar').forEach((element) => {
    element.textContent = initials;
  });
}

console.log("🔥 ABOUT TO CREATE READY PROMISE");
const ready = new Promise((resolve, reject) => {
  const unsubscribe = onAuthStateChanged(auth, async (user) => {
    console.log("🔥 AUTH STATE CALLBACK FIRED", user);
    unsubscribe();
    currentUser = user;
    updateUserInitials(user);
    if (!user && !isLogin) {
      location.replace('login.html');
      resolve(false);
      return;
    }
    if (user) {
      try {
        const snap = await getDoc(userStateRef(user.uid));
        if (snap.exists()) {
          const data = snap.data();
          currentState = {
            ...data,
            transactions: Array.isArray(data.transactions) ? data.transactions : [],
          };
          chatHistory = Array.isArray(data.chatHistory) ? data.chatHistory : [];
        }
      } catch (err) {
        console.error(err);
        showGlobalError('Could not load your PocketPilot data. Check Firebase configuration and Firestore rules.');
      }
    }
    resolve(true);
  });
});

function showGlobalError(message) {
  console.error(message);
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;padding:14px 16px;border-radius:12px;background:#3a1714;color:#ffe5e1;border:1px solid #7d342d;font-family:system-ui;box-shadow:0 12px 30px rgba(0,0,0,.35)';
  el.textContent = message;
  document.body.appendChild(el);
}

async function saveState(state) {
  if (!currentUser) throw new Error('You are not signed in.');
  const clean = {
    totalAmount: Number(state.totalAmount),
    fixedExpenses: Number(state.fixedExpenses || 0),
    totalDays: Number(state.totalDays),
    startDate: typeof state.startDate === 'number' ? state.startDate : new Date(state.startDate).getTime(),
    transactions: Array.isArray(state.transactions) ? state.transactions : [],
    chatHistory,
    updatedAt: Date.now(),
  };
  await setDoc(userStateRef(currentUser.uid), clean);
  currentState = clean;
  return clean;
}

function formatRupees(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₹—';
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function extractPayee(text) {
  const match = String(text || '').match(/to\s+([A-Za-z0-9&.\-\s]{2,40})/i);
  return match ? match[1].trim().replace(/\s+/g, ' ') : 'Payment';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function requireBudget() {
  if (!currentState) {
    showGlobalError('Set up your budget first.');
    setTimeout(() => { location.href = 'setup.html'; }, 700);
    return false;
  }
  return true;
}

function formatWhen(ms) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return 'Unknown time';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function initializeLogin() {
  const form = document.querySelector('form[action="setup.html"]');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    console.log("🔥 LOGIN SUBMIT HANDLER FIRED");
    event.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || password.length < 8) {
      showGlobalError('Enter a valid email and a password with at least 8 characters.');
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/invalid-login-credentials') {
          await createUserWithEmailAndPassword(auth, email, password);
        } else {
          throw err;
        }
      }
      location.href = 'setup.html';
    } catch (err) {
      console.error(err);
      showGlobalError(err.code === 'auth/email-already-in-use' ? 'That account exists. Check the password and try again.' : (err.message || 'Sign-in failed.'));
    } finally {
      button.disabled = false;
    }
  });
}

function initializeSignOut() {
  document.querySelectorAll('.is-signout').forEach((link) => {
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        await signOut(auth);
        location.href = 'login.html';
      } catch (err) {
        showGlobalError('Could not sign out.');
      }
    });
  });
}

async function initializeSetup() {
  const form = document.getElementById('setup-form');
  if (!form) return;
  if (!currentUser) return;

  if (currentState) {
    document.getElementById('total-amount').value = currentState.totalAmount ?? '';
    document.getElementById('fixed-expenses').value = currentState.fixedExpenses ?? '';
    document.getElementById('total-days').value = currentState.totalDays ?? '';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const totalAmount = Number(document.getElementById('total-amount').value);
    const fixedExpenses = document.getElementById('fixed-expenses').value.trim() === '' ? 0 : Number(document.getElementById('fixed-expenses').value);
    const totalDays = Number(document.getElementById('total-days').value);
    try {
      const budget = E.createBudget({ totalAmount, fixedExpenses, totalDays, startDate: currentState?.startDate || new Date() });
      await saveState({ ...budget, transactions: currentState?.transactions || [] });
      renderSetupSummary(budget);
    } catch (err) {
      clearSetupErrors();
      const msg = err.message || 'Please check your inputs.';
      if (msg.toLowerCase().includes('total amount')) showFieldError('totalAmount', msg);
      else if (msg.toLowerCase().includes('fixed')) showFieldError('fixedExpenses', msg);
      else if (msg.toLowerCase().includes('days')) showFieldError('totalDays', msg);
      else showGlobalError(msg);
    }
  });
}

function clearSetupErrors() {
  ['totalAmount', 'fixedExpenses', 'totalDays'].forEach((field) => {
    const el = document.getElementById(field.replace(/[A-Z]/g, m => '-' + m.toLowerCase()) + '-error');
    if (el) el.textContent = '';
  });
}

function showFieldError(field, message) {
  const id = field.replace(/[A-Z]/g, m => '-' + m.toLowerCase()) + '-error';
  const el = document.getElementById(id);
  if (el) el.textContent = message;
}

function renderSetupSummary(budget) {
  const panel = document.getElementById('setup-result');
  if (!panel) return;
  document.getElementById('result-daily-allowance').textContent = formatRupees(E.calculateDailyAllowance(budget, new Date()));
  document.getElementById('result-flexible-money').textContent = formatRupees(E.getFlexibleMoney(budget));
  document.getElementById('result-total-days').textContent = budget.totalDays + ' days';
  document.getElementById('result-fixed-expenses').textContent = formatRupees(budget.fixedExpenses);
  panel.classList.add('is-visible');
}

async function initializePayment() {
  const form = document.getElementById('payment-form');
  if (!form) return;
  if (!requireBudget()) return;
  renderAllowanceStrip();
  renderTransactionHistory();
  form.addEventListener('submit', handlePaymentSubmit);
}

function renderAllowanceStrip() {
  if (!currentState) return;
  const allowance = E.calculateDailyAllowance(currentState, new Date());
  document.getElementById('strip-allowance').textContent = formatRupees(allowance) + '/day';
  document.getElementById('strip-days').textContent = E.getDaysRemaining(currentState, new Date()) + ' days · ' + formatRupees(E.getRemainingFlexible(currentState)) + ' flexible';
}

async function handlePaymentSubmit(event) {
  event.preventDefault();
  const textarea = document.getElementById('payment-text');
  const alertEl = document.getElementById('payment-alert');
  alertEl.classList.remove('is-visible');
  const rawText = textarea.value.trim();
  if (!rawText) {
    alertEl.textContent = 'Paste a payment confirmation message first.';
    alertEl.classList.add('is-visible');
    return;
  }
  try {
    const result = E.logPaymentFromText(currentState, rawText, new Date());
    if (result.error) throw new Error(result.error);
    await saveState(result.newState);
    renderPaymentResult(result);
    renderAllowanceStrip();
    renderTransactionHistory();
    textarea.value = '';
  } catch (err) {
    alertEl.textContent = err.message || 'Could not log that payment.';
    alertEl.classList.add('is-visible');
  }
}

function renderPaymentResult(result) {
  const panel = document.getElementById('payment-result');
  panel.classList.add('is-visible');
  document.getElementById('result-amount-logged').textContent = formatRupees(result.newState.transactions.at(-1)?.amount ?? result.amount ?? 0) + ' logged';
  document.getElementById('ba-before-value').textContent = formatRupees(result.oldAllowance) + '/day';
  document.getElementById('ba-after-value').textContent = formatRupees(result.newAllowance) + '/day';
  const status = document.getElementById('payment-status');
  status.className = 'status-banner ' + (result.isOverPace ? 'tone-warning' : 'tone-success');
  status.querySelector('.status-text').textContent = result.message;
}

function renderTransactionHistory() {
  const list = document.getElementById('txn-list');
  if (!list || !currentState) return;
  list.innerHTML = '';
  const txns = [...currentState.transactions].filter(t => t && (t.type || 'payment') === 'payment').sort((a,b) => Number(b.loggedAt || b.timestamp || 0) - Number(a.loggedAt || a.timestamp || 0));
  if (!txns.length) {
    list.innerHTML = '<p class="field-help">No payments logged yet.</p>';
    return;
  }
  txns.slice(0, 8).forEach((txn) => {
    const item = document.createElement('div');
    item.className = 'txn-item';
    item.innerHTML = `<div class="txn-icon" aria-hidden="true">${receiptIconSvg()}</div><div class="txn-body"><div class="txn-title">${escapeHtml(txn.note ? 'Payment' : 'Payment')}</div><div class="txn-meta">${escapeHtml(formatWhen(txn.timestamp))}</div></div><div class="txn-amount">${formatRupees(txn.amount)}</div>`;
    list.appendChild(item);
  });
}

function receiptIconSvg() {
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h16v18l-3-2-3 2-3-2-3 2-3-2-1 2Z"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>';
}

async function callAI(system, messages) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ system, messages }),
  });
  if (!response.ok) throw new Error('AI request failed (' + response.status + ')');
  const data = await response.json();
  if (!data.text) throw new Error('AI returned no text.');
  return data.text;
}

async function initializeChat() {
  const form = document.getElementById('chat-form');
  if (!form) return;
  if (!requireBudget()) return;
  renderChatAllowanceNote();
  renderChatHistory();
  form.addEventListener('submit', (event) => { event.preventDefault(); sendMessage(); });
  const input = document.getElementById('chat-input');
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  });
}

function renderChatAllowanceNote() {
  const el = document.getElementById('chat-allowance-note');
  if (el && currentState) el.textContent = 'Current allowance: ' + formatRupees(E.calculateDailyAllowance(currentState, new Date())) + '/day';
}

function renderChatHistory() {
  chatHistory.forEach(m => addMessageToChat(m.role === 'user' ? 'user' : 'assistant', m.content, false));
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();

  if (!text || !currentState) return;

  addMessageToChat('user', text);
  chatHistory.push({ role: 'user', content: text });

  input.value = '';
  input.focus();

  const typingId = showTypingIndicator();

  try {
    /*
      STEP 1:
      Try to find an amount in the CURRENT message only.

      If the user says:
        "can I spend 250 on lunch?"
      -> amount = 250

      If they say:
        "idk I really want to"
      -> amount = null

      We do NOT force every message to become a spending question.
    */
    let amount = null;

    try {
      const extraction = await callAI(
        'Extract the rupee amount the user is asking about spending. Reply with ONLY the number. If there is no amount, reply with exactly NONE.',
        [{ role: 'user', content: text }]
      );

      amount = E.parseExtractedAmount(extraction);
    } catch (err) {
      console.warn('AI extraction failed; using local parser:', err);

      amount = E.parseAmountFromText(text, true);
    }

    /*
      STEP 2:
      Build the financial context.

      If this message contains an amount, calculate its effect.

      If it does not, use the current budget status without
      inventing a new spending amount.
    */
    const ctx = E.buildChatContext(
      currentState,
      amount === null ? undefined : amount,
      new Date()
    );

    /*
      STEP 3:
      Give Gemini BOTH:
        - the financial facts from our engine
        - the entire recent conversation

      This is what makes follow-up messages actually conversational.
    */
    const systemPrompt = E.buildChatSystemPrompt(ctx);

    /*
      Tell Gemini explicitly that this is an ongoing conversation.
      Previous messages may contain amounts that are still relevant.
    */
    const conversationPrompt =
      systemPrompt +
      `

CONVERSATION RULES:
- You are continuing an ongoing conversation with the user.
- Use the previous messages to understand what the user means.
- If the user's latest message is a follow-up, answer it in context rather than treating it as a brand-new question.
- Do not repeat a previous answer word-for-word unless it genuinely answers the new message.
- If the latest message does not contain a new spending amount, do not invent one.
- You may refer to amounts already mentioned in the conversation when they are relevant.
- Keep the tone natural, friendly, and conversational, like a helpful money buddy.
- Do not turn every reply into a generic budget warning.
`;

    let reply;

    try {
      reply = await callAI(conversationPrompt, chatHistory);

      /*
        STEP 4:
        Keep the financial safety check.

        We do NOT remove this because Gemini should not invent
        financial calculations.
      */
      const checked = E.validateAIReply(reply, ctx);

      if (!checked.ok) {
        console.warn('AI reply failed validation:', checked);

        /*
          Instead of immediately throwing away the conversational
          reply, try one more time with a stricter instruction.
        */
        const retryPrompt =
          conversationPrompt +
          `

IMPORTANT:
Your previous answer contained a financial number that was not
supported by the current financial facts.

Answer the user's latest message again.

If you do not need to mention a number, avoid mentioning one.
If you mention a financial number, use only numbers explicitly
provided in the financial facts or already established in the
conversation.
`;

        const retryReply = await callAI(retryPrompt, chatHistory);
        const retryChecked = E.validateAIReply(retryReply, ctx);

        if (retryChecked.ok) {
          reply = retryReply;
        } else {
          console.warn('Retry also failed validation:', retryChecked);

          /*
            Only now use the deterministic fallback.
          */
          reply = E.buildFallbackReply(ctx);
        }
      }

    } catch (err) {
      console.warn('AI reply failed; using deterministic fallback:', err);

      reply = E.buildFallbackReply(ctx);
    }

    /*
      STEP 5:
      Save the assistant's answer so the NEXT message knows
      what PocketPilot said.
    */
    chatHistory.push({
      role: 'assistant',
      content: reply
    });

    await saveState(currentState);

    removeTypingIndicator(typingId);
    addMessageToChat('assistant', reply);

  } catch (err) {
    console.error('Chat error:', err);

    removeTypingIndicator(typingId);

    /*
      Last-resort fallback.
    */
    const fallbackCtx = E.buildChatContext(
      currentState,
      E.parseAmountFromText(text, true) ?? undefined,
      new Date()
    );

    const reply = E.buildFallbackReply(fallbackCtx);

    chatHistory.push({
      role: 'assistant',
      content: reply
    });

    await saveState(currentState);

    addMessageToChat('assistant', reply);
  }
}

let typingCounter = 0;
function showTypingIndicator() {
  const messages = document.getElementById('chat-messages');
  const id = 'typing-' + (typingCounter++);
  const row = document.createElement('div');
  row.className = 'msg-row from-assistant';
  row.id = id;
  row.innerHTML = '<div class="msg-bubble" aria-label="PocketPilot is typing"><span class="typing-dots"><span></span><span></span><span></span></span></div>';
  messages.appendChild(row);
  scrollChatToBottom();
  return id;
}
function removeTypingIndicator(id) { document.getElementById(id)?.remove(); }
function addMessageToChat(sender, text, scroll = true) {
  const messages = document.getElementById('chat-messages');
  if (!messages) return;
  document.getElementById('chat-empty-state')?.remove();
  const row = document.createElement('div');
  row.className = 'msg-row from-' + sender;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = highlightRupeeAmounts(escapeHtml(text));
  row.appendChild(bubble);
  messages.appendChild(row);
  if (scroll) scrollChatToBottom();
}
function highlightRupeeAmounts(text) {
  return text.replace(/₹[0-9,]+(?:\.[0-9]{1,2})?(?:\/day)?/g, m => `<span class="msg-figure">${m}</span>`);
}
function scrollChatToBottom() {
  const messages = document.getElementById('chat-messages');
  if (messages) messages.scrollTop = messages.scrollHeight;
}

async function initializeAppPage() {
  console.log("🔥 INITIALIZE APP PAGE");

  if (isLogin) {
    initializeLogin();
    console.log("🔥 LOGIN INITIALIZED");
    return;
  }

  await ready;

  console.log("🔥 READY PROMISE FINISHED");

  initializeSignOut();

  if (!currentUser) return;

  await initializeSetup();
  await initializePayment();
  await initializeChat();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAppPage);
} else {
  initializeAppPage();
}
