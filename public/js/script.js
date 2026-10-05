import {
  auth,
  userStateRef,
  doc,
  getDoc,
  setDoc,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  limit,
  db
} from './firebase.js';
console.log("🔥 SCRIPT.JS MODULE STARTED");

const E = window.PocketPilotEngine;
if (!E) throw new Error('PocketPilot_Engine.js must load before script.js');

const page = location.pathname.split('/').pop() || 'index.html';
const isLogin = page === 'login.html';
let currentUser = null;
let currentState = null;
let currentCycleId = null;
let chatHistory = [];
let currentCategories = ["Food & Dining", "Transportation", "Shopping", "Entertainment", "Bills & Utilities", "Health & Wellness", "Other"];
let recurringExpenses = [];
let userGoals = [];

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
    if (!user && !isLogin && page !== 'index.html') {
      location.replace('login.html');
      resolve(false);
      return;
    }
    if (user && isLogin) {
      location.replace('app.html');
      resolve(true);
      return;
    }
    if (user) {
      try {
        const cyclesRef = collection(db, 'users', user.uid, 'cycles');
        const cyclesSnap = await getDocs(query(cyclesRef, orderBy('startDate', 'desc'), limit(1)));
        
        let cycleData = null;
        if (!cyclesSnap.empty) {
          const docSnap = cyclesSnap.docs[0];
          currentCycleId = docSnap.id;
          cycleData = docSnap.data();
        } else {
          const snap = await getDoc(userStateRef(user.uid));
          if (snap.exists()) {
            console.log("🔥 Running Phase 2B Migration...");
            cycleData = snap.data();
            const newCycleRef = await addDoc(cyclesRef, cycleData);
            currentCycleId = newCycleRef.id;
          }
        }
        
        if (cycleData) {
          currentState = { ...cycleData };
          
          const txnsRef = collection(db, 'users', user.uid, 'transactions');
          const txnsSnap = await getDocs(query(txnsRef, where('cycleId', '==', currentCycleId)));
          const subTxns = txnsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

          let migrated = false;
          const oldTxns = Array.isArray(cycleData.transactions) ? cycleData.transactions : [];
          if (oldTxns.length > 0 && !oldTxns[0].id) {
            console.log("🔥 Running Phase 2A Migration into Phase 2B...");
            for (const txn of oldTxns) {
              const docRef = await addDoc(txnsRef, { ...txn, cycleId: currentCycleId });
              subTxns.push({ id: docRef.id, ...txn, cycleId: currentCycleId });
            }
            migrated = true;
          }

          for (const t of subTxns) {
            if (!t.cycleId) {
              await setDoc(doc(db, 'users', user.uid, 'transactions', t.id), { cycleId: currentCycleId }, { merge: true });
              t.cycleId = currentCycleId;
            }
          }
          
          currentState.transactions = subTxns.sort((a,b) => a.timestamp - b.timestamp);
          chatHistory = Array.isArray(cycleData.chatHistory) ? cycleData.chatHistory : [];
          
          if (migrated) {
            await saveState(currentState);
          }
        }
        
        const recRef = collection(db, 'users', user.uid, 'recurringExpenses');
        const recSnap = await getDocs(recRef);
        recurringExpenses = recSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const catsRef = collection(db, 'users', user.uid, 'categories');
        const catsSnap = await getDocs(catsRef);
        if (!catsSnap.empty) {
          currentCategories = catsSnap.docs.map(d => d.data().name);
        }

        const goalsRef = collection(db, 'users', user.uid, 'goals');
        const goalsSnap = await getDocs(goalsRef);
        userGoals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

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
  if (!currentCycleId) throw new Error('No active cycle.');
  const clean = {
    totalAmount: Number(state.totalAmount),
    fixedExpenses: Number(state.fixedExpenses || 0),
    totalDays: Number(state.totalDays),
    startDate: typeof state.startDate === 'number' ? state.startDate : new Date(state.startDate).getTime(),
    chatHistory,
    updatedAt: Date.now(),
  };
  await setDoc(doc(db, 'users', currentUser.uid, 'cycles', currentCycleId), clean);
  currentState = { ...clean, transactions: state.transactions || [] };
  return currentState;
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
    setTimeout(() => { location.href = 'app.html?view=setup'; }, 700);
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
      location.href = 'app.html';
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
  } else {
    const defaultFixed = recurringExpenses.reduce((sum, item) => sum + item.amount, 0);
    document.getElementById('fixed-expenses').value = defaultFixed || '';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const totalAmount = Number(document.getElementById('total-amount').value);
    const fixedExpenses = document.getElementById('fixed-expenses').value.trim() === '' ? 0 : Number(document.getElementById('fixed-expenses').value);
    const totalDays = Number(document.getElementById('total-days').value);
    try {
      const budget = E.createBudget({ totalAmount, fixedExpenses, totalDays, startDate: currentState?.startDate || new Date() });
      if (!currentCycleId) {
        const cyclesRef = collection(db, 'users', currentUser.uid, 'cycles');
        const newCycleRef = await addDoc(cyclesRef, {
          totalAmount: budget.totalAmount,
          fixedExpenses: budget.fixedExpenses,
          totalDays: budget.totalDays,
          startDate: budget.startDate.getTime ? budget.startDate.getTime() : budget.startDate,
          chatHistory: [],
          updatedAt: Date.now()
        });
        currentCycleId = newCycleRef.id;
      }
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
  
  const select = document.getElementById('payment-category');
  if (select) {
    select.innerHTML = '';
    currentCategories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      select.appendChild(opt);
    });
  }

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
  const catSelect = document.getElementById('payment-category');
  const alertEl = document.getElementById('payment-alert');
  alertEl.classList.remove('is-visible');
  const rawText = textarea.value.trim();
  const category = catSelect ? catSelect.value : 'Other';
  if (!rawText) {
    alertEl.textContent = 'Paste a payment confirmation message first.';
    alertEl.classList.add('is-visible');
    return;
  }
  try {
    const result = E.logPaymentFromText(currentState, rawText, new Date(), null, { category });
    if (result.error) throw new Error(result.error);
    
    const newTxn = result.newState.transactions.pop();
    newTxn.cycleId = currentCycleId;
    const txnsRef = collection(db, 'users', currentUser.uid, 'transactions');
    const docRef = await addDoc(txnsRef, newTxn);
    newTxn.id = docRef.id;
    result.newState.transactions.push(newTxn);
    
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
    const catBadge = txn.category && txn.category !== 'Uncategorized' ? `<span style="font-size: 0.7rem; padding: 2px 6px; background: rgba(255,255,255,0.05); border-radius: 4px; margin-left: 8px; vertical-align: middle;">${escapeHtml(txn.category)}</span>` : '';
    item.innerHTML = `<div class="txn-icon" aria-hidden="true">${receiptIconSvg()}</div><div class="txn-body"><div class="txn-title">${escapeHtml(txn.note ? 'Payment' : 'Payment')}${catBadge}</div><div class="txn-meta">${escapeHtml(formatWhen(txn.timestamp))}</div></div><div class="txn-amount">${formatRupees(txn.amount)}</div>`;
    list.appendChild(item);
  });
}

function receiptIconSvg() {
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h16v18l-3-2-3 2-3-2-3 2-3-2-1 2Z"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>';
}

async function callAI(system, messages) {
  if (!currentUser) throw new Error('User not authenticated.');
  const token = await currentUser.getIdToken();
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
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
  
  // Attach listeners to preset buttons
  document.querySelectorAll('.chat-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.textContent;
      sendMessage();
    });
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
    let category = 'Other';

    try {
      const extraction = await callAI(
        'Extract the rupee amount the user is asking about spending, and the category it belongs to (Food & Dining, Transportation, Shopping, Entertainment, Bills & Utilities, Health & Wellness, Other). Reply ONLY with a JSON object like {"amount": 400, "category": "Food & Dining"}. If no amount, {"amount": null}.',
        [{ role: 'user', content: text }]
      );

      try {
        const parsed = JSON.parse(extraction.replace(/```json/g, '').replace(/```/g, '').trim());
        amount = parsed.amount;
        if (parsed.category) category = parsed.category;
      } catch (e) {
        amount = E.parseExtractedAmount(extraction);
      }
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
      new Date(),
      category
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

async function initializeDashboard() {
  if (!currentState) {
    location.href = 'app.html?view=setup';
    return;
  }
  
  const allowance = E.calculateDailyAllowance(currentState, new Date());
  document.getElementById('dash-safe-to-spend').textContent = formatRupees(allowance);
  
  const daysLeft = E.getDaysRemaining(currentState, new Date());
  document.getElementById('dash-days-left').textContent = daysLeft + ' days left in cycle';
  
  const flexible = E.getRemainingFlexible(currentState);
  const fixed = currentState.fixedExpenses || 0;
  const total = flexible + fixed;
  
  document.getElementById('dash-flexible').textContent = formatRupees(flexible);
  document.getElementById('dash-fixed').textContent = formatRupees(fixed);
  
  if (total > 0) {
    const fixedPct = Math.max(0, Math.min(100, (fixed / total) * 100));
    const flexPct = Math.max(0, Math.min(100, (flexible / total) * 100));
    document.getElementById('dash-progress-fixed').style.width = fixedPct + '%';
    document.getElementById('dash-progress-flexible').style.width = flexPct + '%';
  } else {
    document.getElementById('dash-progress-fixed').style.width = '0%';
    document.getElementById('dash-progress-flexible').style.width = '0%';
  }
  
  const list = document.getElementById('dash-txn-list');
  const txns = [...currentState.transactions].filter(t => t && (t.type || 'payment') === 'payment').sort((a,b) => Number(b.loggedAt || b.timestamp || 0) - Number(a.loggedAt || a.timestamp || 0));
  if (!txns.length) {
    list.innerHTML = '<p class="field-help">No recent transactions.</p>';
  } else {
    list.innerHTML = '';
    txns.slice(0, 3).forEach((txn) => {
      const item = document.createElement('div');
      item.className = 'txn-item';
      const catBadge = txn.category && txn.category !== 'Uncategorized' ? `<span style="font-size: 0.7rem; padding: 2px 6px; background: rgba(255,255,255,0.05); border-radius: 4px; margin-left: 8px; vertical-align: middle;">${escapeHtml(txn.category)}</span>` : '';
      item.innerHTML = `<div class="txn-icon" aria-hidden="true">${receiptIconSvg()}</div><div class="txn-body"><div class="txn-title">${escapeHtml(txn.note ? 'Payment' : 'Payment')}${catBadge}</div><div class="txn-meta">${escapeHtml(formatWhen(txn.timestamp))}</div></div><div class="txn-amount">${formatRupees(txn.amount)}</div>`;
      list.appendChild(item);
    });
  }
  
  const form = document.getElementById('dash-simulator-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = Number(document.getElementById('dash-sim-input').value);
    const result = E.simulateSpend(currentState, amount, new Date());
    const resEl = document.getElementById('dash-sim-result');
    resEl.style.display = 'block';
    if (result.error) {
      document.getElementById('dash-sim-new-allowance').textContent = 'Error';
      document.getElementById('dash-sim-new-allowance').style.color = 'var(--color-warning)';
    } else {
      document.getElementById('dash-sim-new-allowance').textContent = formatRupees(result.newAllowance) + '/day';
      document.getElementById('dash-sim-new-allowance').style.color = result.isOverPace ? 'var(--color-warning)' : 'var(--color-primary)';
    }
  });
}

async function initializeTransactions() {
  if (!currentState) return;
  const list = document.getElementById('transactions-list');
  if (!list) return;
  
  const txns = [...currentState.transactions].sort((a,b) => Number(b.loggedAt || b.timestamp || 0) - Number(a.loggedAt || a.timestamp || 0));
  
  if (!txns.length) {
    list.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--color-ink-muted);">No transactions found.</div>';
    return;
  }
  
  list.innerHTML = '';
  txns.forEach((txn, i) => {
    const item = document.createElement('div');
    item.className = 'txn-item';
    if (i !== txns.length - 1) item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
    const catBadge = txn.category && txn.category !== 'Uncategorized' ? `<span style="font-size: 0.7rem; padding: 2px 6px; background: rgba(255,255,255,0.05); border-radius: 4px; margin-left: 8px; vertical-align: middle;">${escapeHtml(txn.category)}</span>` : '';
    item.innerHTML = `
      <div class="txn-icon" aria-hidden="true">${receiptIconSvg()}</div>
      <div class="txn-body">
        <div class="txn-title">${escapeHtml(txn.note || 'Payment')}${catBadge}</div>
        <div class="txn-meta">${escapeHtml(formatWhen(txn.timestamp))}</div>
      </div>
      <div class="txn-amount" style="color: ${txn.type === 'income' ? 'var(--color-primary)' : 'var(--color-ink)'}">${txn.type === 'income' ? '+' : ''}${formatRupees(txn.amount)}</div>
    `;
    list.appendChild(item);
  });
}

async function initializeBudget() {
  if (!currentState) return;
  const totalEl = document.getElementById('budget-total');
  const fixedEl = document.getElementById('budget-fixed');
  const goalsEl = document.getElementById('budget-goals');
  const flexEl = document.getElementById('budget-flexible');
  
  const startEl = document.getElementById('budget-start');
  const endEl = document.getElementById('budget-end');
  
  const total = currentState.totalAmount || 0;
  const fixed = currentState.fixedExpenses || 0;
  
  // Calculate total goals target
  let goalsTotal = 0;
  if (typeof userGoals !== 'undefined' && Array.isArray(userGoals)) {
    goalsTotal = userGoals.reduce((sum, g) => sum + (g.targetAmount || 0), 0);
  }
  
  // Flexible pool is whatever is left over from the starting balance
  // (NOTE: This is the INITIAL flexible pool, before spending)
  const flexible = Math.max(0, total - fixed - goalsTotal);
  
  if (totalEl) totalEl.textContent = formatRupees(total);
  if (fixedEl) fixedEl.textContent = formatRupees(fixed);
  if (goalsEl) goalsEl.textContent = formatRupees(goalsTotal);
  if (flexEl) flexEl.textContent = formatRupees(flexible);
  
  // Update progress bars
  if (total > 0) {
    const fixedPct = (fixed / total) * 100;
    const goalsPct = (goalsTotal / total) * 100;
    const flexPct = (flexible / total) * 100;
    
    document.getElementById('budget-bar-fixed').style.width = fixedPct + '%';
    document.getElementById('budget-bar-goals').style.width = goalsPct + '%';
    document.getElementById('budget-bar-flex').style.width = flexPct + '%';
  } else {
    document.getElementById('budget-bar-fixed').style.width = '0%';
    document.getElementById('budget-bar-goals').style.width = '0%';
    document.getElementById('budget-bar-flex').style.width = '0%';
  }
  
  if (startEl && currentState.startDate) {
    const start = new Date(currentState.startDate);
    startEl.textContent = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (endEl && currentState.endDate) {
    const end = new Date(currentState.endDate);
    endEl.textContent = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

async function initializeRecurring() {
  const listEl = document.getElementById('recurring-list');
  const form = document.getElementById('recurring-form');
  if (!listEl || !form) return;
  
  function renderRecurring() {
    listEl.innerHTML = '';
    if (recurringExpenses.length === 0) {
      listEl.innerHTML = '<p style="color: var(--color-ink-muted); font-size: 0.9rem;">No recurring expenses setup.</p>';
      return;
    }
    recurringExpenses.forEach(exp => {
      const el = document.createElement('div');
      el.className = 'txn-item';
      el.innerHTML = `
        <div class="txn-info">
          <div class="txn-name">${exp.name}</div>
        </div>
        <div style="display: flex; gap: 12px; align-items: center;">
          <div class="txn-amount">₹${exp.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
          <button class="btn btn-secondary btn-del" style="padding: 4px 8px; border: none; color: var(--color-warning);">×</button>
        </div>
      `;
      el.querySelector('.btn-del').addEventListener('click', async () => {
        try {
          await deleteDoc(doc(db, 'users', currentUser.uid, 'recurringExpenses', exp.id));
          recurringExpenses = recurringExpenses.filter(r => r.id !== exp.id);
          renderRecurring();
        } catch (e) {
          console.error(e);
        }
      });
      listEl.appendChild(el);
    });
  }
  
  renderRecurring();
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('recurring-name').value;
    const amount = Number(document.getElementById('recurring-amount').value);
    const recRef = collection(db, 'users', currentUser.uid, 'recurringExpenses');
    try {
      const docRef = await addDoc(recRef, { name, amount });
      recurringExpenses.push({ id: docRef.id, name, amount });
      renderRecurring();
      form.reset();
    } catch (err) {
      console.error(err);
    }
  });
}

async function initializeGoals() {
  const listEl = document.getElementById('goals-list');
  const form = document.getElementById('goal-form');
  if (!listEl || !form) return;
  
  function renderGoals() {
    listEl.innerHTML = '';
    if (userGoals.length === 0) {
      listEl.innerHTML = '<p style="color: var(--color-ink-muted); font-size: 0.9rem;">No active savings goals.</p>';
      return;
    }
    userGoals.forEach(goal => {
      const el = document.createElement('div');
      el.style.marginBottom = '20px';
      
      const pct = Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100)) || 0;
      
      el.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
          <h4 style="margin: 0; color: var(--color-ink);">${goal.name}</h4>
          <div style="font-size: 0.9rem;">
            <span style="color: var(--color-primary); font-weight: 600;">₹${goal.currentAmount.toLocaleString('en-IN')}</span>
            <span style="color: var(--color-ink-muted);"> / ₹${goal.targetAmount.toLocaleString('en-IN')}</span>
          </div>
        </div>
        <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; margin-bottom: 8px;">
          <div style="height: 100%; width: ${pct}%; background: var(--color-primary); border-radius: 4px;"></div>
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button class="btn btn-secondary btn-fund" style="padding: 4px 12px; font-size: 0.8rem;">Add Funds</button>
          <button class="btn btn-secondary btn-del" style="padding: 4px 12px; font-size: 0.8rem; color: var(--color-warning);">Delete</button>
        </div>
      `;
      
      el.querySelector('.btn-del').addEventListener('click', async () => {
        try {
          await deleteDoc(doc(db, 'users', currentUser.uid, 'goals', goal.id));
          userGoals = userGoals.filter(g => g.id !== goal.id);
          renderGoals();
        } catch (e) {
          console.error(e);
        }
      });
      
      el.querySelector('.btn-fund').addEventListener('click', async () => {
        const amtStr = prompt(`How much are you adding to ${goal.name}?`);
        const amt = Number(amtStr);
        if (amt && amt > 0) {
          goal.currentAmount += amt;
          try {
            await setDoc(doc(db, 'users', currentUser.uid, 'goals', goal.id), { currentAmount: goal.currentAmount }, { merge: true });
            renderGoals();
          } catch(e) {
            console.error(e);
          }
        }
      });
      
      listEl.appendChild(el);
    });
  }
  
  renderGoals();
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('goal-name').value;
    const targetAmount = Number(document.getElementById('goal-target').value);
    const goalsRef = collection(db, 'users', currentUser.uid, 'goals');
    try {
      const docRef = await addDoc(goalsRef, { name, targetAmount, currentAmount: 0 });
      userGoals.push({ id: docRef.id, name, targetAmount, currentAmount: 0 });
      renderGoals();
      form.reset();
    } catch (err) {
      console.error(err);
    }
  });
}

async function initializeInsights() {
  if (!currentState) return;
  const now = new Date();
  const avgData = E.getAverageDailySpend(currentState, now);
  const totalSpent = E.getTotalSpent(currentState);
  const remaining = E.getRemainingFlexible(currentState);
  
  document.getElementById('insight-avg-spend').textContent = avgData.average !== null ? '₹' + avgData.average.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '₹0';
  document.getElementById('insight-total-spent').textContent = '₹' + totalSpent.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  
  const zeroDayEl = document.getElementById('insight-zero-day');
  if (avgData.average > 0 && remaining > 0) {
    const daysLeft = remaining / avgData.average;
    const projectedMs = now.getTime() + (daysLeft * 24 * 60 * 60 * 1000);
    const projectedDate = new Date(projectedMs);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    zeroDayEl.textContent = `${months[projectedDate.getMonth()]} ${projectedDate.getDate()}, ${projectedDate.getFullYear()}`;
    zeroDayEl.style.color = 'var(--color-primary)';
  } else if (remaining <= 0) {
    zeroDayEl.textContent = 'Already Zero';
    zeroDayEl.style.color = 'var(--color-warning)';
  } else {
    zeroDayEl.textContent = 'Need more data';
    zeroDayEl.style.color = 'var(--color-ink-muted)';
  }

  const breakdownContainer = document.getElementById('insight-category-breakdown');
  if (breakdownContainer) {
    const breakdown = E.getCategoryBreakdown(currentState);
    if (breakdown.length === 0) {
      breakdownContainer.innerHTML = '<div class="field-help">No payment data available.</div>';
    } else {
      let html = '<div class="chart-bars" style="display: flex; flex-direction: column; gap: 12px;">';
      const maxTotal = breakdown[0].total; // It's sorted descending
      breakdown.forEach(item => {
        const percentage = Math.max(5, (item.total / maxTotal) * 100);
        html += `
          <div class="chart-bar-row">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.85rem;">
              <span style="color: var(--color-ink);">${escapeHtml(item.name)}</span>
              <span style="color: var(--color-ink-muted);">${formatRupees(item.total)}</span>
            </div>
            <div style="background: rgba(255,255,255,0.05); height: 8px; border-radius: 4px; overflow: hidden;">
              <div style="background: var(--color-primary); height: 100%; width: ${percentage}%; border-radius: 4px;"></div>
            </div>
          </div>
        `;
      });
      html += '</div>';
      breakdownContainer.innerHTML = html;
    }
  }
}

function initializeSettings() {
  initializeSignOut();
  const recLink = document.querySelector('a[data-route="recurring"]');
  if (recLink) {
    recLink.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState(null, '', recLink.getAttribute('href'));
      handleRoute();
    });
  }
}

async function mountView(viewName) {
  const content = document.getElementById('app-content');
  if (!content) return;
  
  document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(link => {
    link.classList.toggle('is-active', link.dataset.route === viewName);
  });
  
  content.innerHTML = '<div class="empty-state"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
  
  const template = document.getElementById(`tpl-${viewName}`);
  if (template) {
    content.innerHTML = template.innerHTML;
    if (viewName === 'dashboard') await initializeDashboard();
    if (viewName === 'transactions') await initializeTransactions();
    if (viewName === 'budget') await initializeBudget();
    if (viewName === 'settings') initializeSettings();
    if (viewName === 'recurring') await initializeRecurring();
    if (viewName === 'goals') await initializeGoals();
    if (viewName === 'insights') await initializeInsights();
  } else if (['setup', 'payment', 'chat'].includes(viewName)) {
    try {
      const res = await fetch(`${viewName}.html`);
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const inner = doc.querySelector('.app-main, .chat-shell');
      if (inner) {
        content.innerHTML = '';
        content.appendChild(inner);
        if (viewName === 'setup') await initializeSetup();
        if (viewName === 'payment') await initializePayment();
        if (viewName === 'chat') {
           inner.style.height = '100%';
           inner.style.display = 'flex';
           inner.style.flexDirection = 'column';
           await initializeChat();
        }
      }
    } catch(e) {
      console.error(e);
      content.innerHTML = '<div class="empty-state">Error loading view</div>';
    }
  } else {
    content.innerHTML = '<div class="empty-state">Not Found</div>';
  }
  
  const titles = { dashboard: 'Dashboard', transactions: 'Transactions', budget: 'Budget Cycles', goals: 'Savings Goals', insights: 'Insights', chat: 'AI Copilot', payment: 'Log Payment', setup: 'Budget Setup', settings: 'Settings' };
  const titleEl = document.getElementById('top-bar-title');
  if (titleEl) titleEl.textContent = titles[viewName] || 'PocketPilot';
}

function handleRoute() {
  const params = new URLSearchParams(location.search);
  const view = params.get('view') || 'dashboard';
  mountView(view);
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

  const isApp = page === 'app.html';

  if (isApp) {
    document.getElementById('sidebar-user-name').textContent = currentUser.email;
    document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (href.startsWith('app.html')) {
          e.preventDefault();
          history.pushState(null, '', href);
          handleRoute();
        }
      });
    });
    window.addEventListener('popstate', handleRoute);
    handleRoute();
  } else {
    await initializeSetup();
    await initializePayment();
    await initializeChat();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAppPage);
} else {
  initializeAppPage();
}
