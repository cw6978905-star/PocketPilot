# 💸 PocketPilot

### Spend smarter. Go further.

> **Every budgeting app tells you what you already spent.  
> PocketPilot tells you what you can still afford — and adjusts the moment that changes.**

PocketPilot is a student-focused budgeting web app designed for people who receive fixed or irregular pocket money.

Instead of simply showing historical spending, PocketPilot continuously calculates how much you can safely spend and shows the financial impact of your next purchase before you make it.

---

## 🚀 The Problem

Students often know how much money they have, but not:

> **"Can I afford this right now without running out of money before my next pocket-money cycle?"**

Traditional banking and expense-tracking apps mainly show:

- Current balance
- Previous transactions
- Spending history
- Charts and reports

But they don't clearly answer the **forward-looking question**:

> **"What will happen to my remaining budget if I spend this money?"**

PocketPilot is built around that decision.

---

## 💡 Our Solution

PocketPilot converts your available money into a **dynamic daily spending allowance**.

Every time you log a payment, the application recalculates your allowance based on:

- Total available money
- Fixed/committed expenses
- Money already spent
- Remaining days

The result is a simple answer:

### **How much can I still afford to spend?**

---

## ✨ Core Features

### 1. 📊 Dynamic Daily Allowance

Enter:

- Total available money
- Fixed expenses
- Number of days the money needs to last

PocketPilot calculates your daily spending allowance automatically.

```text
Available Money
       ↓
Fixed Expenses
       ↓
Remaining Flexible Money
       ↓
Remaining Days
       ↓
Daily Spending Allowance
````

### 2. 💳 Payment Impact Tracking

Instead of manually entering every transaction, users can paste a payment confirmation from apps such as:

* Google Pay
* PhonePe
* Paytm

PocketPilot extracts the payment amount and immediately shows the impact.

For example:

```text
Before: ₹200/day

Payment: ₹400

After: ₹181/day
```

The user sees the **before-and-after consequence** of the purchase instead of simply seeing another transaction added to a list.

---

### 3. 🤖 Conversational AI Companion

Users can ask natural questions such as:

> "Can I spend ₹400 on dinner tonight?"

PocketPilot calculates the financial impact first and then uses AI to explain the result conversationally.

Example:

```text
Your current allowance is ₹165/day.

If you spend ₹400 more,
your allowance will drop to ₹110/day
for the remaining period.

Still sure?
```

The AI **does not perform the financial calculations**.

The application logic calculates the numbers first, and the AI only converts those numbers into a natural-language response. 

---

## 🧠 How It Works

```text
                 USER
                  │
        ┌─────────┴─────────┐
        │                   │
   Budget Setup        Spending Input
        │                   │
        │             Payment / Chat
        │                   │
        └─────────┬─────────┘
                  ↓
          POCKETPILOT ENGINE
                  │
                  ↓
        Calculate Financial Impact
                  │
          ┌───────┴────────┐
          │                │
      New Allowance    Trade-off
          │                │
          └───────┬────────┘
                  ↓
             AI LAYER
                  │
                  ↓
       Natural Language Response
```

---

## 🔐 Why AI Doesn't Do the Math

Financial calculations should be predictable and auditable.

PocketPilot follows a simple separation:

```text
Application Logic
       ↓
Calculates accurate numbers

AI
       ↓
Explains those numbers
```

This means an LLM hallucination cannot change the underlying financial calculation.

---

## 🛠️ Tech Stack

| Layer           | Technology            |
| --------------- | --------------------- |
| Frontend        | HTML, CSS, JavaScript |
| Database        | Firebase Firestore    |
| AI              | Gemini / LLM API      |
| Hosting         | Netlify               |
| Data Storage    | Firestore             |
| Version Control | Git + GitHub          |

Firestore provides cloud persistence without requiring a custom backend server, which keeps the architecture lightweight for the project scope. 

---

## 📱 Why a Web App?

PocketPilot is designed as a **mobile-first web application**.

This allows students to access it directly from their phone browser without installing a native application.

A native mobile application is outside the current build scope and can be considered for future development. 

---

## 🔒 Why Not Automatically Read UPI/SMS Transactions?

Automatic SMS or notification-based transaction capture was deliberately kept outside the current scope.

The approach can require sensitive permissions and may break when banking applications change their message formats.

Instead, PocketPilot currently uses:

> **Payment confirmation → Copy → Paste into PocketPilot → Amount extracted → Budget recalculated**

A future version could explore more robust financial-data integrations.

---

## 🎯 Target Users

PocketPilot is primarily designed for:

* College students
* Young adults
* Students receiving fixed pocket money
* Students receiving irregular financial support
* People who don't maintain spreadsheets
* People who want simple, real-time spending guidance

---

## 📈 Success Metric

The long-term goal is not simply to increase "financial literacy."

Our measurable goal is:

> **Reduce how often students exhaust their discretionary money before their next planned income.**

A future pilot can compare users' spending patterns before and after using PocketPilot. 

---

## 🗺️ Future Scope

Potential future improvements include:

* 🔗 Account Aggregator integration
* 📱 Native mobile application
* 📊 Advanced spending insights
* 🎯 Savings goals
* 📈 Spending pattern analysis
* 🔐 Production-grade security
* ⚡ More automated transaction capture

These are future directions rather than claims about the current build. 

---

## 🏗️ Project Architecture

```text
Frontend
HTML + CSS + JavaScript
        │
        ├───────────────┐
        ↓               ↓
  Budget Engine      AI Layer
        │               │
        │          Natural Language
        │             Responses
        ↓               │
    Firestore ◄─────────┘
        │
        ↓
   Persistent Data
```

---

## 🎬 Demo Flow

The complete demo can be shown in three steps:

### Step 1 — Setup

Enter the available money, fixed expenses and number of days.

```text
₹8,000 available
₹2,000 committed
30 days

→ Daily allowance calculated
```

### Step 2 — Log a Payment

Paste a payment confirmation.

```text
Payment: ₹400

₹200/day
    ↓
₹181/day
```

### Step 3 — Ask PocketPilot

```text
"Can I spend ₹400 on dinner?"
```

PocketPilot calculates the impact and explains the trade-off conversationally.

---

## 👥 Team

Built as a collaborative project covering:

* Financial calculation engine
* UI/UX
* Firebase integration
* AI integration
* Deployment
* End-to-end product integration

---

## 🌐 Live Demo

**Coming soon / Add your deployed URL here**

---

## 📌 Project Status

**In Development**

The current build focuses on delivering the core end-to-end experience:

* Budget setup
* Dynamic allowance calculation
* Payment logging
* Before/after spending impact
* Conversational AI
* Cloud persistence
* Mobile-friendly web experience

---

## 📄 License

This project is currently developed as a hackathon/project build.

```

### One thing I'd change before you paste it

Don't put **"AI-powered budgeting"** everywhere in the README. Your strongest technical story is actually:

**Deterministic financial engine + AI conversational layer.**

That makes PocketPilot much easier to defend when a judge asks, **"What exactly is AI doing?"** :contentReference[oaicite:6]{index=6}
```
