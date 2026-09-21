/**
 * PocketPilot — Logic Engine (Person A) — FINAL
 * Pure functions: state in, numbers out. No UI, no Firebase, no AI calls.
 *
 * STATE SHAPE (what Person C stores in Firestore):
 * {
 *   totalAmount, fixedExpenses, totalDays, startDate: <ms>,
 *   transactions: [
 *     { amount, note, timestamp, loggedAt, type }
 *   ]
 * }
 * Transaction `type`:
 *   "payment"   real spending (default if type is missing)
 *   "estimate"  a labelled guess for an unlogged day (isEstimate: true)
 *   "no_spend"  user confirmed a day had no spending (amount 0)
 *   "reconcile" balance-check adjustment (amount may be +/-/0)
 * `timestamp` = the day the money was actually spent; `loggedAt` = when it was entered.
 *
 * CONVENTIONS
 * - "daysRemaining" INCLUDES today. Day 1 of a 30-day pool => 30 days remaining.
 * - Every function takes an optional `now` so you can test any day of the month.
 * - Nothing here mutates the state you pass in.
 * - Number inputs may be numbers OR text-box strings ("8,000", "₹150").
 * - Dates may be Date, ms, ISO string, or Firestore Timestamp.
 */

// ---------- small helpers ----------
const MS_PER_DAY = 86400000;
const DUPLICATE_WINDOW_MS = 10000;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function round1(n) {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/** Accepts Date, ms, ISO string, Firestore Timestamp. Throws "Invalid date." otherwise. */
function toDate(x) {
  if (x === null || x === undefined) throw new Error("Invalid date.");
  let d;
  if (x instanceof Date) d = x;
  else if (typeof x.toDate === "function") d = x.toDate();
  else if (typeof x === "object" && typeof x.seconds === "number") d = new Date(x.seconds * 1000);
  else d = new Date(x);
  if (!(d instanceof Date) || isNaN(d.getTime())) throw new Error("Invalid date.");
  return new Date(d.getTime()); // always a copy
}
function startOfDay(d) {
  const x = toDate(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}
function daysBetween(a, b) {
  // whole calendar days from a to b (DST-safe via round)
  return Math.round((startOfDay(b) - startOfDay(a)) / MS_PER_DAY);
}
function isSameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}
function validDate(x) {
  try { toDate(x); return true; } catch (e) { return false; }
}
/** "Sep 2" — spelled out ourselves so it's identical in every browser/Node. */
function formatDateLabel(d) {
  const x = toDate(d);
  return `${MONTH_LABELS[x.getMonth()]} ${x.getDate()}`;
}
/** Text-box friendly: 150, "150", "₹1,500", "Rs. 200" all work. Anything else -> NaN. */
function toNumber(x) {
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const cleaned = x.replace(/₹|,|\s/g, "").replace(/^rs\.?/i, "");
    return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
  }
  return NaN;
}
/** A payment amount: must be at least ₹0.01. Rounded to 2 decimals. */
function toAmount(x) {
  const n = toNumber(x);
  if (!isFiniteNumber(n) || n < 0.01) throw new Error("Amount must be a positive number.");
  if (n > 1e9) throw new Error("That amount is too large.");
  return round2(n);
}
function txType(t) {
  return t.type || (t.isEstimate ? "estimate" : "payment");
}

// ---------- state safety ----------
function assertState(state) {
  if (!state || typeof state !== "object") throw new Error("Budget isn't set up yet.");
  if (!isFiniteNumber(state.totalAmount) || state.totalAmount <= 0 || !isFiniteNumber(state.totalDays) || state.totalDays < 1) {
    throw new Error("Budget data is missing or corrupted.");
  }
  if (state.transactions !== undefined && !Array.isArray(state.transactions)) throw new Error("Budget data is missing or corrupted.");
  toDate(state.startDate); // throws if missing/invalid
}
/** Valid transactions only (bad rows are ignored rather than crashing the app). */
function txs(state) {
  assertState(state);
  return (state.transactions || []).filter((t) => t && isFiniteNumber(t.amount) && validDate(t.timestamp));
}

// ---------- setup ----------
/**
 * Build and validate a fresh budget state.
 * fixedExpenses is optional: blank / missing / null all mean 0.
 * Throws Error with a readable message if input is bad (Person B can show it).
 */
function createBudget({ totalAmount, fixedExpenses, totalDays, startDate = new Date() } = {}) {
  const total = toNumber(totalAmount);
  const blankFixed = fixedExpenses === undefined || fixedExpenses === null || (typeof fixedExpenses === "string" && fixedExpenses.trim() === "");
  const fixed = blankFixed ? 0 : toNumber(fixedExpenses);
  const days = toNumber(totalDays);

  if (!isFiniteNumber(total) || total <= 0) throw new Error("Total amount must be a positive number.");
  if (!isFiniteNumber(fixed)) throw new Error("Fixed expenses must be a number (or leave it blank for none).");
  if (fixed < 0) throw new Error("Fixed expenses can't be negative.");
  if (fixed > total) throw new Error("Fixed expenses can't be more than your total money.");
  if (fixed === total) throw new Error("Your fixed expenses use up all your money, so there's nothing left to budget.");
  if (!Number.isInteger(days) || days < 1) throw new Error("Number of days must be a whole number of at least 1.");
  if (days > 366) throw new Error("The budget period can be at most 366 days.");
  let start;
  try { start = toDate(startDate); } catch (e) { throw new Error("Invalid start date."); }

  return { totalAmount: round2(total), fixedExpenses: round2(fixed), totalDays: days, startDate: start.getTime(), transactions: [] };
}

// ---------- core math ----------
/** flexibleMoney = totalAmount - fixedExpenses */
function getFlexibleMoney(state) {
  assertState(state);
  return round2(state.totalAmount - (state.fixedExpenses || 0));
}

function getTotalSpent(state) {
  return round2(txs(state).reduce((sum, t) => sum + t.amount, 0));
}

/** Spent on the same calendar day as `now`. */
function getSpentToday(state, now = new Date()) {
  const today = startOfDay(now).getTime();
  return round2(
    txs(state)
      .filter((t) => startOfDay(t.timestamp).getTime() === today)
      .reduce((sum, t) => sum + t.amount, 0)
  );
}

/** Spent before today started (internal). */
function getSpentBeforeToday(state, now = new Date()) {
  return round2(getTotalSpent(state) - getSpentToday(state, now));
}

/** Days left INCLUDING today. Never below 1 so we never divide by zero. */
function getDaysRemaining(state, now = new Date()) {
  assertState(state);
  const elapsed = Math.max(0, daysBetween(state.startDate, now));
  return Math.max(1, state.totalDays - elapsed);
}

/** Money left in the flexible pool right now. */
function getRemainingFlexible(state) {
  return round2(getFlexibleMoney(state) - getTotalSpent(state));
}

/**
 * CURRENT daily allowance = remaining flexible money / days remaining.
 * Can be negative if the user has overspent the whole pool.
 */
function calculateDailyAllowance(state, now = new Date()) {
  return round2(getRemainingFlexible(state) / getDaysRemaining(state, now));
}

/** The allowance at the START of today (ignores today's payments). */
function getTodayStartAllowance(state, now = new Date()) {
  const remainingAtDayStart = getFlexibleMoney(state) - getSpentBeforeToday(state, now);
  return round2(remainingAtDayStart / getDaysRemaining(state, now));
}

/** Everything about "right now" in one place (internal). */
function snapshot(state, now) {
  const days = getDaysRemaining(state, now);
  const remaining = getRemainingFlexible(state);
  const todayStart = getTodayStartAllowance(state, now);
  const spentToday = getSpentToday(state, now);
  return {
    days,
    remaining,
    allowance: round2(remaining / days),
    todayStart,
    spentToday,
    leftToday: round2(todayStart - spentToday),
    periodEnded: daysBetween(state.startDate, now) >= state.totalDays,
  };
}

// ---------- amount parsing ----------
/**
 * Pull a rupee amount out of pasted text ("₹150", "Rs. 1,500.50", "INR150", "150 rupees").
 * Returns a number, or null if nothing found. Takes the FIRST match.
 * Set allowBareNumber=true to fall back to the first standalone number ("spend 400").
 */
function parseAmountFromText(text, allowBareNumber = false) {
  if (typeof text !== "string") return null;
  const num = "([0-9][0-9,]*(?:\\.[0-9]{1,2})?)";
  const patterns = [
    new RegExp("(?:₹|\\b(?:rs|inr)\\.?)\\s*" + num, "i"), // ₹150 / Rs. 150 / Rs150 / INR150
    new RegExp(num + "\\s*(?:₹|(?:rs|inr|rupees?)\\b)", "i"), // 150 rs / 150.00 INR / 150 rupees
  ];
  if (allowBareNumber) patterns.push(new RegExp("(?:^|[^0-9.,])" + num));
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const value = parseFloat(m[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

// ---------- what-if ----------
/**
 * Preview a spend WITHOUT saving it. Powers the what-if simulator and emergency mode.
 *
 * newAllowance      = allowance if the hit is spread over every remaining day (incl. today)
 * nextDayAllowance  = what tomorrow's allowance will be (today is used up). null on the last day.
 * isOverPace        = total spent today exceeds today's planned allowance.
 */
function simulateSpend(state, amountInput, now = new Date()) {
  const amount = toAmount(amountInput);
  const snap = snapshot(state, now);
  const remainingAfter = round2(snap.remaining - amount);
  const newAllowance = round2(remainingAfter / snap.days);
  const spentTodayAfter = round2(snap.spentToday + amount);

  return {
    amount,
    daysRemaining: snap.days,
    oldAllowance: snap.allowance,
    newAllowance,
    drop: round2(snap.allowance - newAllowance),
    nextDayAllowance: snap.days > 1 ? round2(remainingAfter / (snap.days - 1)) : null,
    todayStartAllowance: snap.todayStart,
    leftTodayAfter: round2(snap.todayStart - spentTodayAfter), // negative = over today's limit
    remainingBefore: snap.remaining,
    remainingAfter,
    canAfford: remainingAfter >= 0, // "Technically yes"
    isOverPace: spentTodayAfter > snap.todayStart,
  };
}

// ---------- logging ----------
/**
 * Log a payment. Returns the NEW state (Person C saves it) plus before/after numbers
 * and a ready-to-show banner message for Person B.
 *
 * @param {object} state
 * @param {number|string} amount
 * @param {string} [note]
 * @param {Date|number} [now]     when this is being logged (defaults to right now)
 * @param {Date|number} [spentOn] OPTIONAL: the day the money was actually spent, if not today.
 *                                Must be between the budget start and today.
 * @param {object} [options]      { allowDuplicate: true } to skip the double-tap guard
 *
 * Backdated payments are dated to `spentOn` in the log, never counted as spent "today".
 * If that day has an estimate, the real payment REPLACES the estimate (no double counting).
 * Double-taps (same amount + note within 10 seconds) are ignored and flagged `duplicate: true`.
 */
function logPayment(state, amountInput, note = "", now = new Date(), spentOn = null, options = {}) {
  assertState(state);
  const amount = toAmount(amountInput);
  const nowD = toDate(now);
  const opts = options || {};

  const hasSpentOn = spentOn !== null && spentOn !== undefined;
  let spentOnD;
  try { spentOnD = hasSpentOn ? toDate(spentOn) : nowD; } catch (e) { throw new Error("That date isn't valid."); }
  const nowDay = startOfDay(nowD).getTime();
  const spentDay = startOfDay(spentOnD).getTime();
  if (spentDay > nowDay) throw new Error("You can't log a payment for a future date.");
  if (spentDay < startOfDay(state.startDate).getTime()) throw new Error("That date is before your budget period started.");
  const backdated = spentDay < nowDay;

  const cleanNote = String(note === null || note === undefined ? "" : note).slice(0, 120);
  const list = txs(state);
  const before = snapshot(state, nowD);
  const nextOf = (s) => (s.days > 1 ? round2(s.remaining / (s.days - 1)) : null);

  // double-tap guard
  if (!opts.allowDuplicate) {
    const dup = list.some(
      (t) =>
        txType(t) === "payment" &&
        isFiniteNumber(t.loggedAt) &&
        Math.abs(t.loggedAt - nowD.getTime()) < DUPLICATE_WINDOW_MS &&
        t.amount === amount &&
        (t.note || "") === cleanNote &&
        startOfDay(t.timestamp).getTime() === spentDay
    );
    if (dup) {
      return {
        duplicate: true,
        backdated,
        absorbedEstimate: 0,
        oldAllowance: before.allowance,
        newAllowance: before.allowance,
        isOverPace: before.spentToday > before.todayStart,
        nextDayAllowance: nextOf(before),
        leftToday: before.leftToday,
        spentOn: spentOnD.getTime(),
        message: "That looks like a duplicate of a payment you just logged, so I ignored it.",
        newState: state,
      };
    }
  }

  // a real payment replaces any estimate for the same day (no double counting)
  let toAbsorb = amount;
  let absorbed = 0;
  const newList = [];
  for (const t of list) {
    if (toAbsorb > 0.004 && txType(t) === "estimate" && !t.reconciled && t.amount > 0 && startOfDay(t.timestamp).getTime() === spentDay) {
      const take = Math.min(t.amount, toAbsorb);
      toAbsorb = round2(toAbsorb - take);
      absorbed = round2(absorbed + take);
      const left = round2(t.amount - take);
      if (left > 0.004) newList.push({ ...t, amount: left });
    } else {
      newList.push(t);
    }
  }
  newList.push({ amount, note: cleanNote, timestamp: spentOnD.getTime(), loggedAt: nowD.getTime(), type: "payment" });

  const newState = { ...state, transactions: newList };
  const after = snapshot(newState, nowD);
  const isOverPace = after.spentToday > after.todayStart;
  const f = formatMoney;

  let message;
  if (backdated) {
    const label = formatDateLabel(spentOnD);
    message =
      Math.abs(after.allowance - before.allowance) < 0.005
        ? `${f(amount)} logged for ${label}. Your daily allowance stays at ${f(after.allowance)}.`
        : `${f(amount)} logged for ${label}. Your daily allowance is now ${f(after.allowance)} (was ${f(before.allowance)}).`;
  } else if (isOverPace) {
    message = `${f(amount)} logged. Your daily allowance dropped from ${f(before.allowance)} to ${f(after.allowance)}.`;
  } else {
    message = `${f(amount)} logged. You're still on pace — ${f(after.leftToday)} left of today's ${f(after.todayStart)}.`;
  }
  if (absorbed > 0) message += ` (Replaced ${f(absorbed)} of estimated spending.)`;
  if (after.remaining < 0) message += ` Heads up: you're ${f(Math.abs(after.remaining))} over your flexible money.`;
  if (after.periodEnded) message += " Note: your budget period has ended.";

  return {
    duplicate: false,
    backdated,
    absorbedEstimate: absorbed,
    oldAllowance: before.allowance,
    newAllowance: after.allowance,
    isOverPace,
    nextDayAllowance: nextOf(after),
    leftToday: after.leftToday,
    spentOn: spentOnD.getTime(),
    message,
    newState,
  };
}

/** Parse pasted text then log it. Returns { error } if no amount found. */
function logPaymentFromText(state, text, now = new Date(), spentOn = null, options = {}) {
  const amount = parseAmountFromText(text);
  if (amount === null) {
    return { error: "Couldn't find a rupee amount in that message. Try including something like ₹150 or Rs. 150." };
  }
  return logPayment(state, amount, String(text).slice(0, 80), now, spentOn, options);
}

/** Remove the most recent entry (fixes typos like ₹1500 instead of ₹150). */
function undoLastTransaction(state, now = new Date()) {
  const list = txs(state);
  if (!list.length) throw new Error("Nothing to undo.");
  const removed = list[list.length - 1];
  let rest = list.slice(0, -1);
  if (txType(removed) === "reconcile") {
    // bring back the estimates that this reconcile had settled
    rest = rest.map((t) => (t.reconciled && t.reconciled === removed.loggedAt ? { ...t, reconciled: false } : t));
  }
  const newState = { ...state, transactions: rest };
  const oldAllowance = calculateDailyAllowance(state, now);
  const newAllowance = calculateDailyAllowance(newState, now);
  const label = txType(removed) === "payment" ? `${formatMoney(removed.amount)}${removed.note ? ` (${removed.note})` : ""}` : "the last entry";
  return {
    removed,
    oldAllowance,
    newAllowance,
    message: `Removed ${label}. Your daily allowance is back to ${formatMoney(newAllowance)}.`,
    newState,
  };
}

// ---------- catching up after a gap ----------
function describeDays(dayMsList) {
  const labels = dayMsList.map(formatDateLabel);
  if (labels.length === 1) return labels[0];
  const contiguous = dayMsList.every((ms, i) => i === 0 || daysBetween(dayMsList[i - 1], ms) === 1);
  if (contiguous) return `${labels[0]} to ${labels[labels.length - 1]}`;
  return labels.length <= 4 ? labels.join(", ") : `${labels.slice(0, 4).join(", ")} and ${labels.length - 4} more`;
}

/**
 * Which days have NOTHING recorded? Every completed day (start date .. yesterday, never past the
 * budget period) needs at least one entry: a payment, an estimate, a "no spending" confirmation,
 * or a balance check that covers it. Today isn't included because it isn't over yet.
 *
 * This works per day, so it still catches a gap after he logs something new today,
 * and gaps in the middle of the period.
 *
 * @returns {{ lastLogTimestamp, daysSinceLastLog, hasGap, needsAttention, gapLength, gapDays: number[], message }}
 *   hasGap = at least one unlogged day; needsAttention = two or more.
 */
function detectLoggingGap(state, now = new Date()) {
  const list = txs(state);
  const today = startOfDay(now).getTime();
  const start = startOfDay(state.startDate);

  const covered = new Set();
  let reconcileDay = -Infinity;
  let lastLogTimestamp = null;
  list.forEach((t) => {
    const dayMs = startOfDay(t.timestamp).getTime();
    covered.add(dayMs);
    if (txType(t) === "reconcile") reconcileDay = Math.max(reconcileDay, dayMs);
    if (lastLogTimestamp === null || t.timestamp > lastLogTimestamp) lastLogTimestamp = t.timestamp;
  });

  const gapDays = [];
  for (let i = 0; i < state.totalDays; i++) {
    const day = addDays(start, i).getTime();
    if (day >= today) break;
    if (day <= reconcileDay) continue;
    if (!covered.has(day)) gapDays.push(day);
  }

  const reference = lastLogTimestamp !== null ? lastLogTimestamp : state.startDate;
  const n = gapDays.length;
  return {
    lastLogTimestamp,
    daysSinceLastLog: Math.max(0, daysBetween(reference, now)),
    hasGap: n >= 1,
    needsAttention: n >= 2,
    gapLength: n,
    gapDays,
    message:
      n === 0
        ? null
        : `You haven't logged anything for ${n} day${n > 1 ? "s" : ""} (${describeDays(gapDays)}) — want to add what you remember, or should I estimate based on your usual spending?`,
  };
}

/** His average daily spend on days we actually know about (real payments or confirmed no-spend days). */
function getAverageDailySpend(state, now) {
  const todayMs = startOfDay(now).getTime();
  const totals = new Map();
  txs(state).forEach((t) => {
    const dayMs = startOfDay(t.timestamp).getTime();
    if (dayMs >= todayMs) return;
    const type = txType(t);
    if (type === "payment") totals.set(dayMs, (totals.get(dayMs) || 0) + t.amount);
    else if (type === "no_spend" && !totals.has(dayMs)) totals.set(dayMs, 0);
  });
  if (totals.size === 0) return { average: null, knownDays: 0 };
  let sum = 0;
  totals.forEach((v) => (sum += v));
  return { average: sum / totals.size, knownDays: totals.size };
}

function noonOf(ms) {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

/**
 * Fill every unlogged day with a labelled GUESS, so the allowance never silently assumes ₹0.
 *   - Guess = his average over days he did log. With no history: the planned daily amount
 *     (so the allowance stays flat instead of inflating).
 *   - Never more than the money he has left (a guess can't push him below ₹0).
 * Like simulateSpend, nothing is saved: Person C persists `newStateWithEstimates` if he accepts.
 *
 * @returns {{ hasGap, gapDays, estimatedAmountPerDay, totalEstimated, basis, capped, entries,
 *             oldAllowance, newAllowance, message, newStateWithEstimates }}
 */
function estimateGapSpend(state, now = new Date()) {
  const gap = detectLoggingGap(state, now);
  const oldAllowance = calculateDailyAllowance(state, now);
  if (gap.gapLength === 0) {
    return {
      hasGap: false, gapDays: [], estimatedAmountPerDay: 0, totalEstimated: 0, basis: null, capped: false, entries: [],
      oldAllowance, newAllowance: oldAllowance, message: "No unlogged days to estimate.", newStateWithEstimates: state,
    };
  }

  const avg = getAverageDailySpend(state, now);
  const basis = avg.knownDays > 0 ? "your_average" : "planned_allowance";
  const perDayRaw = avg.knownDays > 0 ? avg.average : getFlexibleMoney(state) / state.totalDays;
  const remaining = Math.max(0, getRemainingFlexible(state));
  const rawTotal = perDayRaw * gap.gapLength;
  const capped = rawTotal > remaining + 0.004;
  const perDay = round2(Math.min(rawTotal, remaining) / gap.gapLength);

  const entries = gap.gapDays.map((ms) => ({
    amount: perDay,
    note: "Estimated (unlogged day)",
    timestamp: noonOf(ms),
    loggedAt: toDate(now).getTime(),
    type: "estimate",
    isEstimate: true,
  }));
  const totalEstimated = round2(entries.reduce((sum, e) => sum + e.amount, 0));
  const newStateWithEstimates = { ...state, transactions: [...txs(state), ...entries] };
  const newAllowance = calculateDailyAllowance(newStateWithEstimates, now);
  const f = formatMoney;

  return {
    hasGap: true,
    gapDays: gap.gapDays,
    estimatedAmountPerDay: perDay,
    totalEstimated,
    basis,
    capped,
    entries,
    oldAllowance,
    newAllowance,
    message:
      `Estimated ${f(perDay)}/day for ${gap.gapLength} unlogged day${gap.gapLength > 1 ? "s" : ""} (${f(totalEstimated)} total, ` +
      `${basis === "your_average" ? "based on your usual spending" : "based on your planned daily amount"}${capped ? ", capped at what you have left" : ""}). ` +
      `Daily allowance: ${f(oldAllowance)} → ${f(newAllowance)}. These are marked as estimates.`,
    newStateWithEstimates,
  };
}

/** "I really spent nothing on those days." Confirms every unlogged day as ₹0. */
function markGapAsNoSpend(state, now = new Date()) {
  const gap = detectLoggingGap(state, now);
  if (gap.gapLength === 0) return { daysMarked: 0, newState: state, message: "No unlogged days to confirm." };
  const markers = gap.gapDays.map((ms) => ({
    amount: 0, note: "No spending", timestamp: noonOf(ms), loggedAt: toDate(now).getTime(), type: "no_spend",
  }));
  const n = markers.length;
  return {
    daysMarked: n,
    newState: { ...state, transactions: [...txs(state), ...markers] },
    message: `Marked ${n} day${n > 1 ? "s" : ""} (${describeDays(gap.gapDays)}) as no spending.`,
  };
}

/**
 * Balance check: the user types how much FLEXIBLE money they really have left (not the whole bank
 * balance; money set aside for fixed expenses doesn't count). One adjustment entry makes the app
 * match reality. It is dated YESTERDAY so it never counts as today's spending, and it settles any
 * unlogged days before today.
 *
 * diff > 0: he has less than logged (unlogged spending). diff < 0: he has more (refund/mistake).
 * @returns {{ adjustment: number, diff, wasCorrect, oldAllowance, newAllowance, message, newState }}
 */
function reconcileBalance(state, realRemaining, now = new Date()) {
  assertState(state);
  const nowD = toDate(now);
  const real = toNumber(realRemaining);
  if (!isFiniteNumber(real)) throw new Error("Real remaining balance must be a number.");
  if (real < 0) throw new Error("Remaining balance can't be negative.");
  const flex = getFlexibleMoney(state);
  if (real > flex + 0.004) throw new Error(`Remaining balance can't be more than your total flexible money (${formatMoney(flex)}).`);

  const diff = round2(getRemainingFlexible(state) - real);
  const oldAllowance = calculateDailyAllowance(state, nowD);
  const marker = {
    amount: diff,
    note: diff === 0 ? "Balance check (matched)" : "Balance reconciliation adjustment",
    timestamp: startOfDay(nowD).getTime() - 1000,
    loggedAt: nowD.getTime(),
    type: "reconcile",
    isAdjustment: diff !== 0,
  };
  const list = txs(state).map((t) => (txType(t) === "estimate" && !t.reconciled ? { ...t, reconciled: nowD.getTime() } : t));
  const newState = { ...state, transactions: [...list, marker] };
  const newAllowance = calculateDailyAllowance(newState, nowD);
  const f = formatMoney;

  let message;
  if (diff === 0) message = "Your numbers already match, so nothing to adjust.";
  else if (diff > 0) message = `Reconciled: looks like ${f(diff)} went unlogged. Your daily allowance is now ${f(newAllowance)}, down from ${f(oldAllowance)}.`;
  else message = `Reconciled: you actually have ${f(Math.abs(diff))} more than logged. Your daily allowance is now ${f(newAllowance)}, up from ${f(oldAllowance)}.`;

  return { adjustment: diff, diff, wasCorrect: diff === 0, oldAllowance, newAllowance, message, newState };
}

/** The weekly check-in prompt from the case study. Due every `everyDays` days (default 7). */
function getReconcilePrompt(state, now = new Date(), everyDays = 7) {
  const recs = txs(state).filter((t) => txType(t) === "reconcile");
  const baseline = recs.length ? Math.max(...recs.map((t) => (isFiniteNumber(t.loggedAt) ? t.loggedAt : t.timestamp))) : state.startDate;
  const daysSince = Math.max(0, daysBetween(baseline, now));
  const ended = daysBetween(state.startDate, now) >= state.totalDays;
  const expectedRemaining = getRemainingFlexible(state);
  return {
    due: !ended && daysSince >= everyDays,
    daysSince,
    expectedRemaining,
    prompt: `Quick check — does ${formatMoney(expectedRemaining)} left sound about right, or should we adjust?`,
  };
}

/** Total of estimates the user hasn't confirmed yet. */
function getEstimatedSpent(state) {
  return round2(txs(state).filter((t) => txType(t) === "estimate" && !t.reconciled).reduce((sum, t) => sum + t.amount, 0));
}

// ---------- AI chat support (for Person C's AI calls) ----------
// Pipeline:  user message -> buildAmountExtractionPrompt -> AI -> parseExtractedAmount
//            -> buildChatContext (OUR math) -> buildChatSystemPrompt -> AI reply
//            -> validateAIReply -> (ok ? show reply : show buildFallbackReply)
// The AI only ever narrates numbers this file computed. It never does math.

/** "₹5,450", "-₹350", "₹181.67" */
function formatMoney(n) {
  if (!isFiniteNumber(n)) return "₹—";
  const abs = Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return (n < 0 ? "-" : "") + "₹" + abs;
}

const VERDICT_TONE = {
  status_only: "Give a quick, friendly snapshot of where they stand.",
  on_pace: "Reassuring. This fits inside today's plan, so keep it light.",
  over_pace: "Friendly heads-up, not a lecture. It's doable, but it costs them something. Show the trade-off.",
  heavy: "Serious but kind. This takes a big bite out of the rest of the period. Make sure they see it.",
  cannot_afford: "Honest and clear: this is more than the flexible money they have left. Don't scold. Suggest a smaller amount or waiting.",
};

/** Every number in the context (plus abs values and days-1) = the only numbers the AI may say. */
function collectAllowedNumbers(ctx) {
  const set = new Set();
  Object.keys(ctx).forEach((k) => {
    const v = ctx[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      set.add(v);
      set.add(Math.abs(v));
    }
  });
  set.add(ctx.daysRemaining);
  set.add(Math.max(0, ctx.daysRemaining - 1));
  return Array.from(set);
}

/**
 * Everything the AI is allowed to know, all computed by our own math.
 * `amount` is optional: leave it out for "how am I doing?" (verdict = "status_only").
 * verdict: on_pace | over_pace | heavy (allowance cut by more than half) | cannot_afford | status_only
 * Also reports unlogged days and unconfirmed estimates so the AI can say numbers may be off.
 */
function buildChatContext(state, amount, now = new Date()) {
  const snap = snapshot(state, now);
  const gap = detectLoggingGap(state, now);

  const ctx = {
    hasAmount: false,
    verdict: "status_only",
    spentToday: snap.spentToday,
    todayOriginalAllowance: snap.todayStart,
    currentAllowance: snap.allowance,
    leftToday: snap.leftToday,
    daysRemaining: snap.days,
    remainingFlexibleNow: snap.remaining,
    isOverBudget: snap.remaining < 0,
    unloggedGapDays: gap.gapLength,
    estimatedSpent: getEstimatedSpent(state),
  };

  if (amount !== undefined && amount !== null) {
    const sim = simulateSpend(state, amount, now); // throws on bad amount
    const current = snap.allowance;

    let verdict;
    if (!sim.canAfford) verdict = "cannot_afford";
    else if (current > 0 && sim.newAllowance < current * 0.5) verdict = "heavy";
    else if (sim.isOverPace) verdict = "over_pace";
    else verdict = "on_pace";

    Object.assign(ctx, {
      hasAmount: true,
      verdict,
      amountAsked: sim.amount,
      projectedAllowance: sim.newAllowance,
      dropAmount: sim.drop,
      dropPercent: current > 0 ? round1((sim.drop / current) * 100) : null,
      nextDayAllowance: sim.nextDayAllowance,
      spentTodayAfter: round2(snap.spentToday + sim.amount),
      leftTodayAfter: sim.leftTodayAfter,
      remainingFlexibleAfter: sim.remainingAfter,
      daysOfSpendingThisCosts: current > 0 ? round1(sim.amount / current) : null,
      canAfford: sim.canAfford,
      isOverPace: sim.isOverPace,
    });
  }

  ctx.tone = VERDICT_TONE[ctx.verdict];
  ctx.allowedNumbers = collectAllowedNumbers(ctx);
  return ctx;
}

/** The system prompt Person C sends to the AI. Rules + tone + the facts. */
function buildChatSystemPrompt(ctx) {
  const f = formatMoney;
  const facts = [
    `- Today's planned allowance: ${f(ctx.todayOriginalAllowance)}`,
    `- Already spent today: ${f(ctx.spentToday)}`,
    `- Current daily allowance: ${f(ctx.currentAllowance)}`,
    `- Money left in the flexible pool: ${f(ctx.remainingFlexibleNow)}`,
    `- Days left in the budget period (including today): ${ctx.daysRemaining}`,
  ];
  if (ctx.unloggedGapDays > 0) facts.push(`- Days with nothing logged: ${ctx.unloggedGapDays} (these numbers may be too optimistic)`);
  if (ctx.estimatedSpent > 0) facts.push(`- Includes ${f(ctx.estimatedSpent)} of estimated spending that is not confirmed`);
  if (ctx.hasAmount) {
    facts.push(
      `- Amount they are asking about: ${f(ctx.amountAsked)}`,
      `- Daily allowance if they spend it: ${f(ctx.projectedAllowance)} (drops by ${f(ctx.dropAmount)}${ctx.dropPercent !== null ? `, ${ctx.dropPercent}%` : ""})`,
      `- Money left after spending it: ${f(ctx.remainingFlexibleAfter)}`,
      `- Left of today's plan after spending it: ${f(ctx.leftTodayAfter)} (negative = over today's plan)`
    );
    if (ctx.nextDayAllowance !== null) facts.push(`- Tomorrow's allowance if they spend it: ${f(ctx.nextDayAllowance)}`);
    if (ctx.daysOfSpendingThisCosts !== null) facts.push(`- That amount equals about ${ctx.daysOfSpendingThisCosts} days of their normal spending`);
    facts.push(`- Can they afford it: ${ctx.canAfford ? "yes" : "no"}`, `- Verdict: ${ctx.verdict}`);
  }

  const rules = [
    "1. Use ONLY the numbers listed under FACTS. Copy them exactly. Never calculate, add, subtract, estimate, or round anything yourself.",
    "2. If a number you need is not in FACTS, don't guess. Say you can't tell.",
    "3. Reply in 2-4 short, casual sentences. Talk like a friend. No lectures, no bullet points, no headings.",
    "4. Never forbid or shame. Show the trade-off and let them decide.",
    ctx.hasAmount
      ? "5. End by checking whether they are still sure. If they already said they're going ahead, say fine, and remind them to log it after paying."
      : "5. If they ask about a specific purchase amount, ask them for the amount.",
    "6. Refer to earlier messages naturally, but always use the current FACTS, not numbers from old messages.",
  ];
  if (ctx.unloggedGapDays > 0 || ctx.estimatedSpent > 0) {
    rules.push("7. FACTS mention unlogged days or estimated spending, so briefly say the numbers might be off until they catch up.");
  }

  return ["You are PocketPilot, a friendly money buddy for a student living on pocket money.", "", "RULES", ...rules, "", `TONE: ${ctx.tone}`, "", "FACTS", ...facts].join("\n");
}

/**
 * Safety net: checks every ₹ amount, %, and "N days" in the AI's reply against the allowed numbers.
 * Whole-rupee rounding is tolerated (₹182 is accepted for ₹181.67). Anything else is flagged.
 */
function validateAIReply(reply, ctx) {
  const allowed = ctx.allowedNumbers || collectAllowedNumbers(ctx);
  const text = typeof reply === "string" ? reply : "";

  const moneyOk = (v) => allowed.some((a) => Math.abs(a - v) < 0.005 || (Number.isInteger(v) && Math.abs(a - v) < 1));
  const eq = ctx.daysOfSpendingThisCosts;
  const daysSet = [ctx.daysRemaining, Math.max(0, ctx.daysRemaining - 1), ctx.unloggedGapDays || 0];
  if (typeof eq === "number") daysSet.push(Math.floor(eq), Math.round(eq), Math.ceil(eq), eq);
  const daysOk = (v) => daysSet.some((a) => Math.abs(a - v) < 0.05);
  const pctOk = (v) => typeof ctx.dropPercent === "number" && Math.abs(ctx.dropPercent - v) <= 1;

  const grab = (regex) => {
    const out = [];
    let m;
    while ((m = regex.exec(text)) !== null) out.push(parseFloat(m[1].replace(/,/g, "")));
    return out.filter((n) => Number.isFinite(n));
  };

  const unknownAmounts = grab(/(?:₹|\brs\.?)\s*(\d[\d,]*(?:\.\d+)?)/gi)
    .concat(grab(/(\d[\d,]*(?:\.\d+)?)\s*rupees?\b/gi))
    .filter((v) => !moneyOk(v));
  const unknownPercents = grab(/(\d+(?:\.\d+)?)\s*%/g).filter((v) => !pctOk(v));
  const unknownDays = grab(/(\d+(?:\.\d+)?)\s*days?\b/gi).filter((v) => !daysOk(v));

  return { ok: unknownAmounts.length + unknownPercents.length + unknownDays.length === 0, unknownAmounts, unknownPercents, unknownDays };
}

/** Pre-written reply for when the API fails or validateAIReply rejects the AI. Always correct. */
function buildFallbackReply(ctx) {
  const f = formatMoney;
  let reply;
  switch (ctx.verdict) {
    case "on_pace":
      reply = `Yep, that fits today. Spending ${f(ctx.amountAsked)} keeps you inside today's ${f(ctx.todayOriginalAllowance)} plan, with ${f(ctx.leftTodayAfter)} to spare. Still want to go for it?`;
      break;
    case "over_pace":
      reply = `Technically yes 😅 but spending ${f(ctx.amountAsked)} pulls your daily allowance down from ${f(ctx.currentAllowance)} to ${f(ctx.projectedAllowance)} for the rest of the period. Still worth it?`;
      break;
    case "heavy":
      reply = `That's a big one. ${f(ctx.amountAsked)} is about ${ctx.daysOfSpendingThisCosts} days of your normal spending, and your daily allowance would fall from ${f(ctx.currentAllowance)} to ${f(ctx.projectedAllowance)}. Still sure?`;
      break;
    case "cannot_afford":
      reply = `That's more than you have left. You've got ${f(ctx.remainingFlexibleNow)} and this is ${f(ctx.amountAsked)}, so you'd be ${f(Math.abs(ctx.remainingFlexibleAfter))} short. Want to try a smaller amount?`;
      break;
    default:
      reply = `You've got ${f(ctx.remainingFlexibleNow)} left over the next ${ctx.daysRemaining} days, about ${f(ctx.currentAllowance)} a day.${ctx.spentToday > 0 ? ` You've spent ${f(ctx.spentToday)} so far today.` : ""}`;
  }
  if (ctx.unloggedGapDays > 0) {
    reply += ` (Heads up: ${ctx.unloggedGapDays} day${ctx.unloggedGapDays > 1 ? "s have" : " has"} nothing logged, so this might be optimistic.)`;
  }
  return reply;
}

/** Prompt for the FIRST AI call: pull the rupee amount out of casual text. */
function buildAmountExtractionPrompt(userMessage) {
  return [
    "Extract the rupee amount the user is asking about spending.",
    "Reply with ONLY the number (for example: 400). No symbols, no words.",
    "If there is no amount, reply with exactly: NONE",
    "",
    `Message: ${userMessage}`,
  ].join("\n");
}

/** Turn the AI's extraction reply into a number, or null (for "NONE" or nonsense). */
function parseExtractedAmount(aiText) {
  return parseAmountFromText(String(aiText || ""), true);
}

// ---------- summary (dashboard + runway view) ----------
function getBudgetSummary(state, now = new Date()) {
  const snap = snapshot(state, now);
  const gap = detectLoggingGap(state, now);
  return {
    flexibleMoney: getFlexibleMoney(state),
    totalSpent: getTotalSpent(state),
    remainingFlexible: snap.remaining,
    daysRemaining: snap.days,
    dailyAllowance: snap.allowance,
    todayStartAllowance: snap.todayStart,
    spentToday: snap.spentToday,
    leftToday: snap.leftToday,
    periodEnded: snap.periodEnded,
    isOverBudget: snap.remaining < 0,
    overBudgetBy: snap.remaining < 0 ? Math.abs(snap.remaining) : 0,
    estimatedSpent: getEstimatedSpent(state),
    unloggedGapDays: gap.gapLength,
    reconcileDue: getReconcilePrompt(state, now).due,
    loggingGap: gap,
  };
}

// ---------- self-tests (run: node pocketpilot-engine.js, or call runTests() in console) ----------
function runTests() {
  let passed = 0, failed = 0;
  const eq = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    ok ? passed++ : failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  };
  const throws = (name, fn) => {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    threw ? passed++ : failed++;
    console.log(`${threw ? "PASS" : "FAIL"}  ${name}`);
  };
  const day = (n, h = 12) => new Date(2026, 8, n, h, 0, 0); // Sept N, 2026

  // ===== Core math =====
  const base = createBudget({ totalAmount: 8000, fixedExpenses: 2000, totalDays: 30, startDate: day(1) });
  eq("baseline allowance = 200", calculateDailyAllowance(base, day(1)), 200);
  const noFixed = createBudget({ totalAmount: 3000, totalDays: 30, startDate: day(1) });
  eq("no fixed expenses = 100/day", calculateDailyAllowance(noFixed, day(1)), 100);

  const d9 = { ...base, transactions: [{ amount: 1800, note: "", timestamp: day(5).getTime() }] };
  eq("day 10 has 21 days left", getDaysRemaining(d9, day(10)), 21);
  eq("day 10 allowance = 200", calculateDailyAllowance(d9, day(10)), 200);
  eq("what-if 400 -> 180.95 (case study ~181)", simulateSpend(d9, 400, day(10)).newAllowance, 180.95);
  const d15 = { ...base, transactions: [{ amount: 3000, note: "", timestamp: day(3).getTime() }] };
  eq("day 15 allowance = 187.5", calculateDailyAllowance(d15, day(15)), 187.5);
  eq("emergency 1000 -> 125", simulateSpend(d15, 1000, day(15)).newAllowance, 125);
  const sim = simulateSpend(d15, 400, day(15));
  eq("deck example nextDayAllowance = 173.33", sim.nextDayAllowance, 173.33);
  eq("deck example isOverPace", sim.isOverPace, true);
  eq("spend exactly all remaining is affordable", simulateSpend(base, 6000, day(1)).canAfford, true);
  eq("one paisa over is not", simulateSpend(base, 6000.01, day(1)).canAfford, false);

  // ===== Logging =====
  const small = logPayment(base, 100, "chai", day(1));
  eq("small payment on pace", small.isOverPace, false);
  eq("small payment leftToday = 100", small.leftToday, 100);
  eq("log does not mutate original state", base.transactions.length, 0);
  eq("newState has the transaction", small.newState.transactions.length, 1);
  eq("small payment not backdated", small.backdated, false);
  const big = logPayment(base, 400, "dinner", day(1));
  eq("big payment message", big.message, "₹400 logged. Your daily allowance dropped from ₹200 to ₹186.67.");
  const after1 = logPayment(base, 150, "", day(1)).newState;
  eq("yesterday's spend not counted as today", getSpentToday(after1, day(2)), 0);
  const broke = logPayment(base, 7000, "oops", day(1));
  eq("overspend flagged in message", broke.message.includes("over your flexible money"), true);
  eq("overspend summary flag", getBudgetSummary(broke.newState, day(1)).isOverBudget, true);
  eq("overspend amount", getBudgetSummary(broke.newState, day(1)).overBudgetBy, 1000);
  eq("last day nextDay = null", simulateSpend(base, 100, day(30)).nextDayAllowance, null);
  eq("period ended flag", getBudgetSummary(base, new Date(2026, 11, 1)).periodEnded, true);
  eq("period-ended note in message", logPayment(base, 100, "", new Date(2026, 11, 1)).message.includes("period has ended"), true);
  let fl = logPayment(base, 0.1, "a", day(1, 10)).newState;
  fl = logPayment(fl, 0.2, "b", day(1, 11)).newState;
  eq("0.1 + 0.2 = 0.3 exactly", getTotalSpent(fl), 0.3);

  // ===== Amount parsing =====
  eq("parse ₹150", parseAmountFromText("Paid ₹150 to Chai Wala"), 150);
  eq("parse Rs. 1,500.50", parseAmountFromText("Rs. 1,500.50 debited"), 1500.5);
  eq("parse Rs.150", parseAmountFromText("Rs.150 sent via PhonePe"), 150);
  eq("parse INR 150", parseAmountFromText("INR 150 paid"), 150);
  eq("parse INR150 (no space)", parseAmountFromText("INR150 paid"), 150);
  eq("parse Rs150 (no space)", parseAmountFromText("Rs150 paid"), 150);
  eq("parse Indian grouping", parseAmountFromText("Rs. 1,50,000 credited"), 150000);
  eq("parse 150.00 INR", parseAmountFromText("debited 150.00 INR"), 150);
  eq("parse '150 rupees'", parseAmountFromText("spent 150 rupees"), 150);
  eq("₹0 is not an amount", parseAmountFromText("₹0 paid"), null);
  eq("no amount -> null", parseAmountFromText("Payment successful, ref 123456"), null);
  eq("'rsvp 5' is not money", parseAmountFromText("rsvp 5 people"), null);
  eq("bare number needs the flag", parseAmountFromText("spend 400 tonight"), null);
  eq("bare number with flag", parseAmountFromText("spend 400 tonight", true), 400);
  eq("logPaymentFromText error", typeof logPaymentFromText(base, "hello", day(1)).error, "string");

  // ===== Input safety =====
  const ss = createBudget({ totalAmount: "8,000", fixedExpenses: "", totalDays: "30", startDate: day(1) });
  eq("text-box strings accepted", getFlexibleMoney(ss), 8000);
  eq("blank fixed = 0", ss.fixedExpenses, 0);
  eq("null fixed = 0", createBudget({ totalAmount: 100, fixedExpenses: null, totalDays: 10 }).fixedExpenses, 0);
  eq("'₹150' string amount works", logPayment(base, "₹150", "", day(1)).newAllowance, 195);
  const fsBudget = createBudget({ totalAmount: 100, totalDays: 10, startDate: { toDate: () => day(1) } });
  eq("Firestore-style Timestamp accepted", fsBudget.startDate, day(1).getTime());
  throws("negative amount rejected", () => logPayment(base, -5, "", day(1)));
  throws("zero amount rejected", () => logPayment(base, 0, "", day(1)));
  throws("₹0.001 rejected", () => logPayment(base, 0.001, "", day(1)));
  throws("text amount rejected", () => logPayment(base, "abc", "", day(1)));
  throws("fixed > total rejected", () => createBudget({ totalAmount: 100, fixedExpenses: 200, totalDays: 10 }));
  throws("fixed = total rejected", () => createBudget({ totalAmount: 100, fixedExpenses: 100, totalDays: 10 }));
  throws("fixed 'abc' rejected", () => createBudget({ totalAmount: 100, fixedExpenses: "abc", totalDays: 10 }));
  throws("0 days rejected", () => createBudget({ totalAmount: 100, totalDays: 0 }));
  throws("400 days rejected", () => createBudget({ totalAmount: 100, totalDays: 400 }));
  throws("invalid start date rejected", () => createBudget({ totalAmount: 100, totalDays: 10, startDate: "garbage" }));
  throws("invalid 'now' rejected", () => calculateDailyAllowance(base, "garbage"));
  throws("null 'now' rejected", () => calculateDailyAllowance(base, null));
  throws("null state rejected", () => calculateDailyAllowance(null));
  throws("empty state rejected", () => calculateDailyAllowance({}));

  // ===== Double-tap guard + undo =====
  const d1 = logPayment(base, 50, "chai", day(1, 10));
  const d2 = logPayment(d1.newState, 50, "chai", day(1, 10));
  eq("double-tap flagged as duplicate", d2.duplicate, true);
  eq("duplicate adds nothing", d2.newState.transactions.length, 1);
  eq("allowDuplicate overrides", logPayment(d1.newState, 50, "chai", day(1, 10), null, { allowDuplicate: true }).newState.transactions.length, 2);
  eq("same payment an hour later is fine", logPayment(d1.newState, 50, "chai", day(1, 11)).newState.transactions.length, 2);

  // ===== The main scenario: chai 150 + dinner 400 on Sept 1 =====
  let s = logPayment(base, 150, "chai", day(1, 10)).newState;
  s = logPayment(s, 400, "dinner", day(1, 20)).newState;

  // Case 1: genuinely ₹0 days
  eq("Sept 1 allowance = 181.67", calculateDailyAllowance(s, day(1)), 181.67);
  eq("Sept 2 (0 spent) = 187.93", calculateDailyAllowance(s, day(2)), 187.93);
  eq("Sept 4 (0 spent) = 201.85", calculateDailyAllowance(s, day(4)), 201.85);

  // Gap detection
  eq("no gap on Sept 1", detectLoggingGap(s, day(1)).hasGap, false);
  eq("no gap on Sept 2", detectLoggingGap(s, day(2)).hasGap, false);
  const g3 = detectLoggingGap(s, day(3));
  eq("Sept 3: one missing day", g3.gapLength, 1);
  eq("Sept 3: one day is not 'needs attention'", g3.needsAttention, false);
  const gap4 = detectLoggingGap(s, day(4));
  eq("Sept 4: two missing days", gap4.gapLength, 2);
  eq("Sept 4: needs attention", gap4.needsAttention, true);
  eq("Sept 4: days since last log = 3", gap4.daysSinceLastLog, 3);
  eq("gap message names the dates", gap4.message.includes("Sep 2 to Sep 3"), true);
  eq("fresh budget day 1: no gap", detectLoggingGap(base, day(1)).hasGap, false);
  eq("fresh budget day 5: gap covers Sep 1-4", detectLoggingGap(base, day(5)).gapLength, 4);
  // BUG FIX: logging something today must not hide earlier gaps
  const s4 = logPayment(s, 30, "chai", day(4, 9)).newState;
  eq("gap still detected after logging today", detectLoggingGap(s4, day(4, 10)).gapLength, 2);
  // gap in the middle of the period
  let mid = logPayment(base, 100, "a", day(1, 10)).newState;
  mid = logPayment(mid, 100, "b", day(5, 10)).newState;
  eq("gap in the middle: Sep 2-4", detectLoggingGap(mid, day(6)).gapLength, 3);
  // BUG FIX: never past the end of the budget period
  const short = createBudget({ totalAmount: 300, totalDays: 3, startDate: day(1) });
  eq("gap never exceeds the period length", detectLoggingGap(short, new Date(2026, 11, 1)).gapLength, 3);

  // Confirm ₹0 days
  const ns = markGapAsNoSpend(s, day(4));
  eq("no-spend: 2 days marked", ns.daysMarked, 2);
  eq("no-spend: gap cleared", detectLoggingGap(ns.newState, day(4)).gapLength, 0);
  eq("no-spend: allowance unchanged (201.85)", calculateDailyAllowance(ns.newState, day(4)), 201.85);
  eq("no-spend with no gap is a no-op", markGapAsNoSpend(s, day(2)).newState === s, true);

  // Estimate
  const est = estimateGapSpend(s, day(4));
  eq("estimate: 2 days", est.gapDays.length, 2);
  eq("estimate: 550/day (day-1 average)", est.estimatedAmountPerDay, 550);
  eq("estimate: basis", est.basis, "your_average");
  eq("estimate: entries marked", est.entries.every((e) => e.isEstimate === true), true);
  eq("estimate: 4 transactions", est.newStateWithEstimates.transactions.length, 4);
  eq("estimate: allowance 201.85 -> 161.11", est.newAllowance, 161.11);
  eq("estimate: gap cleared", detectLoggingGap(est.newStateWithEstimates, day(4)).gapLength, 0);
  eq("estimate: tracked as unconfirmed", getEstimatedSpent(est.newStateWithEstimates), 1100);
  eq("estimate with no gap is a no-op", estimateGapSpend(s, day(2)).hasGap, false);
  // BUG FIX: no history must not assume ₹0
  const estNew = estimateGapSpend(base, day(4));
  eq("no history: uses planned 200/day, not 0", estNew.estimatedAmountPerDay, 200);
  eq("no history: basis", estNew.basis, "planned_allowance");
  eq("no history: covers Sep 1-3", estNew.gapDays.length, 3);
  eq("no history: allowance stays flat at 200", estNew.newAllowance, 200);
  // BUG FIX: a guess can't push him below ₹0
  let tight = createBudget({ totalAmount: 1000, totalDays: 10, startDate: day(1) });
  tight = logPayment(tight, 900, "big", day(1)).newState;
  const estTight = estimateGapSpend(tight, day(4));
  eq("estimate capped at money left", getRemainingFlexible(estTight.newStateWithEstimates), 0);
  eq("estimate capped flag", estTight.capped, true);
  // BUG FIX: no estimates past the period end
  eq("no estimates beyond the period", estimateGapSpend(short, new Date(2026, 11, 1)).entries.length, 3);

  // Backdated logging
  const r1 = logPayment(s, 300, "Sept 2 stuff (late)", day(4, 9), day(2));
  eq("backdated flagged", r1.backdated, true);
  eq("backdated dated to Sept 2", isSameDay(r1.spentOn, day(2)), true);
  eq("backdated message", r1.message, "₹300 logged for Sep 2. Your daily allowance is now ₹190.74 (was ₹201.85).");
  eq("backdated: not over pace", r1.isOverPace, false);
  eq("backdated: nothing spent today", getSpentToday(r1.newState, day(4)), 0);
  const r2 = logPayment(r1.newState, 200, "Sept 3 stuff (late)", day(4, 9), day(3));
  eq("second backdated message", r2.message, "₹200 logged for Sep 3. Your daily allowance is now ₹183.33 (was ₹190.74).");
  const fin = getBudgetSummary(r2.newState, day(4, 10));
  eq("recovered allowance = 183.33", fin.dailyAllowance, 183.33);
  eq("Sept 4 still 0 spent", fin.spentToday, 0);
  eq("gap resolved", fin.loggingGap.hasGap, false);
  eq("partially backdated: gap shrinks to 1", detectLoggingGap(r1.newState, day(4)).gapLength, 1);
  // BUG FIX: bad dates
  throws("future spentOn rejected", () => logPayment(s, 100, "x", day(4), day(9)));
  throws("spentOn before start rejected", () => logPayment(s, 100, "x", day(4), new Date(2026, 7, 30)));
  throws("garbage spentOn rejected", () => logPayment(s, 100, "x", day(4), "garbage"));
  // BUG FIX: real payment replaces estimate (no double counting)
  const ab = logPayment(est.newStateWithEstimates, 300, "actual Sept 2", day(4, 9), day(2, 15));
  eq("real payment absorbs 300 of the estimate", ab.absorbedEstimate, 300);
  eq("no double counting: allowance unchanged", ab.newAllowance, ab.oldAllowance);
  eq("estimate shrinks to 800 unconfirmed", getEstimatedSpent(ab.newState), 800);
  eq("absorb message", ab.message.includes("Replaced ₹300"), true);
  const ab2 = logPayment(est.newStateWithEstimates, 700, "big Sept 2", day(4, 9), day(2, 15));
  eq("payment bigger than estimate removes it", ab2.absorbedEstimate, 550);

  // Reconcile
  const recon = reconcileBalance(s, 4950, day(4));
  eq("reconcile: 500 unlogged", recon.diff, 500);
  eq("reconcile: adjustment is a number", recon.adjustment, 500);
  eq("reconcile: allowance 183.33 (matches manual backdating)", recon.newAllowance, 183.33);
  eq("reconcile: remaining matches reality", getRemainingFlexible(recon.newState), 4950);
  // BUG FIX: adjustment must not count as today's spending
  eq("reconcile: nothing spent today", getSpentToday(recon.newState, day(4)), 0);
  eq("reconcile: leftToday is clean", getBudgetSummary(recon.newState, day(4)).leftToday, 183.33);
  eq("reconcile: gap cleared", detectLoggingGap(recon.newState, day(4)).gapLength, 0);
  const reconOver = reconcileBalance(s, 5500, day(4));
  eq("reconcile surplus: -50", reconOver.diff, -50);
  eq("reconcile surplus raises allowance", reconOver.newAllowance > reconOver.oldAllowance, true);
  const reconOk = reconcileBalance(s, "5,450", day(4));
  eq("reconcile matched (text input)", reconOk.wasCorrect, true);
  eq("reconcile matched still clears the gap", detectLoggingGap(reconOk.newState, day(4)).gapLength, 0);
  eq("reconcile matched changes no money", getRemainingFlexible(reconOk.newState), 5450);
  const reconEst = reconcileBalance(est.newStateWithEstimates, 4000, day(4));
  eq("reconcile after estimates: 148.15", reconEst.newAllowance, 148.15);
  eq("reconcile settles estimates", getEstimatedSpent(reconEst.newState), 0);
  throws("reconcile rejects text", () => reconcileBalance(s, "lots", day(4)));
  throws("reconcile rejects negative", () => reconcileBalance(s, -1, day(4)));
  throws("reconcile rejects more than the pool", () => reconcileBalance(s, 9999, day(4)));

  // Weekly check-in prompt
  eq("check-in due after 8 days", getReconcilePrompt(s, day(9)).due, true);
  eq("check-in not due after 4 days", getReconcilePrompt(s, day(5)).due, false);
  eq("check-in prompt text", getReconcilePrompt(s, day(5)).prompt, "Quick check — does ₹5,450 left sound about right, or should we adjust?");
  eq("check-in resets after reconcile", getReconcilePrompt(recon.newState, day(6)).due, false);
  eq("check-in due 7 days after reconcile", getReconcilePrompt(recon.newState, day(11)).due, true);
  eq("summary carries gap info", getBudgetSummary(s, day(4)).unloggedGapDays, 2);

  // Undo
  const u = undoLastTransaction(s, day(1, 21));
  eq("undo removes dinner", u.removed.amount, 400);
  eq("undo restores allowance 195", u.newAllowance, 195);
  throws("undo on empty budget", () => undoLastTransaction(base, day(1)));
  const undoRec = undoLastTransaction(reconEst.newState, day(4));
  eq("undoing a reconcile restores estimates", getEstimatedSpent(undoRec.newState), 1100);

  // ===== AI chat support =====
  const c1 = buildChatContext(after1, 400, day(1));
  eq("chat: today original = 200", c1.todayOriginalAllowance, 200);
  eq("chat: spent today = 150", c1.spentToday, 150);
  eq("chat: current = 195", c1.currentAllowance, 195);
  eq("chat: projected = 181.67", c1.projectedAllowance, 181.67);
  eq("chat: verdict over_pace", c1.verdict, "over_pace");
  eq("chat: dropPercent", c1.dropPercent, 6.8);
  eq("chat: days of spending", c1.daysOfSpendingThisCosts, 2.1);
  eq("chat: leftTodayAfter", c1.leftTodayAfter, -350);
  const cOn = buildChatContext(base, 100, day(1));
  const cHeavy = buildChatContext(base, 4000, day(1));
  const cNo = buildChatContext(base, 7000, day(1));
  const cStatus = buildChatContext(after1, undefined, day(1));
  eq("chat: on_pace", cOn.verdict, "on_pace");
  eq("chat: heavy", cHeavy.verdict, "heavy");
  eq("chat: cannot_afford", cNo.verdict, "cannot_afford");
  eq("chat: status_only", cStatus.verdict, "status_only");
  eq("chat: text amount accepted", buildChatContext(base, "400", day(1)).amountAsked, 400);
  throws("chat rejects bad amount", () => buildChatContext(base, -5, day(1)));
  const prompt = buildChatSystemPrompt(c1);
  eq("prompt has projected allowance", prompt.includes("₹181.67"), true);
  eq("prompt has rules", prompt.includes("ONLY the numbers"), true);
  eq("prompt has no gap rule when no gap", prompt.includes("unlogged days"), false);

  const cGap = buildChatContext(s, 400, day(4));
  eq("chat knows about the gap", cGap.unloggedGapDays, 2);
  eq("gap shows in prompt", buildChatSystemPrompt(cGap).includes("Days with nothing logged: 2"), true);
  eq("gap adds the caution rule", buildChatSystemPrompt(cGap).includes("might be off"), true);
  const cEst = buildChatContext(est.newStateWithEstimates, 400, day(4));
  eq("chat knows about estimates", cEst.estimatedSpent, 1100);

  eq("good AI reply passes", validateAIReply("Your allowance is ₹195 now. Spend ₹400 and it drops to ₹181.67. Still sure?", c1).ok, true);
  eq("whole-rupee rounding accepted", validateAIReply("It'd drop to about ₹182.", c1).ok, true);
  eq("invented amount caught", validateAIReply("It'd drop to ₹170.", c1).unknownAmounts, [170]);
  eq("invented 'rupees' amount caught", validateAIReply("It'd drop to 170 rupees.", c1).unknownAmounts, [170]);
  eq("invented days caught", validateAIReply("That's like 9 days of spending.", c1).unknownDays, [9]);
  eq("invented percent caught", validateAIReply("That's a 40% drop.", c1).unknownPercents, [40]);
  eq("negative shown as positive accepted", validateAIReply("You'd be ₹350 over today's plan.", c1).ok, true);
  [c1, cOn, cHeavy, cNo, cStatus, cGap, cEst].forEach((c, i) => {
    eq(`fallback reply valid (${c.verdict} #${i})`, validateAIReply(buildFallbackReply(c), c).ok, true);
  });
  eq("fallback mentions the gap", buildFallbackReply(cGap).includes("2 days have nothing logged"), true);
  eq("formatMoney thousands", formatMoney(5450), "₹5,450");
  eq("formatMoney negative", formatMoney(-350), "-₹350");
  eq("formatMoney bad input", formatMoney(NaN), "₹—");
  eq("extraction prompt has message", buildAmountExtractionPrompt("dinner 400").includes("dinner 400"), true);
  eq("extraction reply 400", parseExtractedAmount("400"), 400);
  eq("extraction reply NONE", parseExtractedAmount("NONE"), null);

  console.log(`\n${passed} passed, ${failed} failed`);
  return failed === 0;
}

// ---------- exports (works in browser console, <script>, and Node) ----------
const PocketPilotEngine = {
  createBudget,
  getFlexibleMoney,
  getTotalSpent,
  getSpentToday,
  getDaysRemaining,
  getRemainingFlexible,
  calculateDailyAllowance,
  getTodayStartAllowance,
  parseAmountFromText,
  simulateSpend,
  logPayment,
  logPaymentFromText,
  undoLastTransaction,
  detectLoggingGap,
  estimateGapSpend,
  markGapAsNoSpend,
  reconcileBalance,
  getReconcilePrompt,
  getEstimatedSpent,
  buildChatContext,
  buildChatSystemPrompt,
  buildFallbackReply,
  validateAIReply,
  buildAmountExtractionPrompt,
  parseExtractedAmount,
  formatMoney,
  getBudgetSummary,
  runTests,
};

if (typeof module !== "undefined" && module.exports) module.exports = PocketPilotEngine;
if (typeof window !== "undefined") window.PocketPilotEngine = PocketPilotEngine;
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) runTests();