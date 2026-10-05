# PocketPilot Next-Generation Architecture

This document defines the architecture for evolving PocketPilot from a functional prototype into a robust, scalable personal finance application for students. 

## 1. Product Architecture
PocketPilot operates on a single core philosophy: **"How much can I safely spend right now?"**

The architecture enforces a strict separation of concerns:
- **Deterministic Financial Engine**: Acts as the unassailable source of truth for all mathematical and financial logic. 
- **AI Copilot**: Acts strictly as a conversational explainer. The AI receives mathematically sound facts from the engine and explains them to the user. It NEVER invents, estimates, or performs financial calculations.

## 2. Information Architecture
The application is structured into the following core areas:
1. **Dashboard**: The primary landing view. Displays the "Safe-to-spend" amount for today, daily allowance pacing, and a quick glance at recent activity.
2. **Transactions**: A comprehensive ledger for logging, categorizing, and reviewing past spending.
3. **Budget**: Configuration of the current financial cycle (start/end dates, total available funds).
4. **Goals**: Dedicated savings targets that actively remove money from the flexible spending pool.
5. **Recurring Expenses**: Anticipated fixed costs (rent, subscriptions) that are protected from daily spending.
6. **Insights**: Visual breakdowns of spending trends, category analysis, and pacing history.
7. **AI Copilot**: A ubiquitous assistant capable of simulating purchases and answering financial questions based on engine facts.
8. **Settings**: User profile, authentication management, and UI preferences.

## 3. User Journeys
- **Cycle Initialization**: User defines a budget cycle (e.g., a month), enters total available money, and registers fixed recurring expenses and savings goals.
- **Purchase Simulation**: User asks the AI Copilot "Can I afford dinner for ₹400 tonight?". The engine simulates the transaction, calculates the impact on the daily allowance, and passes these bounds to the AI to answer conversationally.
- **Active Logging**: User pastes or manually enters a payment. The engine updates the flexible remaining pool and recalibrates the daily allowance instantly.
- **Review & Insights**: User reviews category spending over the month to identify areas of overspending.

## 4. Data Model (Core Concepts)
- **User**: The authenticated entity.
- **Budget Cycle**: A defined chronological period (e.g., 30 days) during which a pool of money is managed.
- **Available Money**: Total starting balance for the cycle.
- **Fixed Expenses**: Anticipated non-negotiable costs.
- **Recurring Expenses**: Instances of fixed costs scheduled to occur.
- **Savings Goals**: Targets that ring-fence portions of the available money.
- **Flexible Money**: `Available Money - (Fixed Expenses + Savings Goals)`. The pool of money actually available for discretionary spending.
- **Transactions**: Realized spending events.
- **Categories**: Taxonomies applied to transactions (e.g., Food, Transit).
- **Remaining Days**: Number of days left in the cycle.
- **Daily Allowance**: `Remaining Flexible Money / Remaining Days`.
- **Safe-to-spend Amount**: `Daily Allowance - Spent Today`.

## 5. Firestore Collections
To resolve the 1MB single-document bottleneck, data will be normalized into scalable subcollections:

`users/{uid}` (Document: User preferences and metadata)
- `cycles/{cycleId}`: Defines `startDate`, `endDate`, `totalAmount`.
- `transactions/{txnId}`: Stores `amount`, `timestamp`, `note`, `categoryId`, `cycleId`.
- `recurring/{recurId}`: Stores `amount`, `description`, `frequency`, `nextDueDate`.
- `goals/{goalId}`: Stores `targetAmount`, `currentSaved`, `title`, `deadline`.
- `chatSessions/{sessionId}`: Stores AI conversation history separated from financial state.
- `categories/{categoryId}`: Custom or default categories.

## 6. Authentication Model
- **Provider**: Firebase Authentication (Email/Password).
- **Client**: Protected routes; unauthenticated users are forcefully redirected to `login.html`.
- **Server**: All backend endpoints (e.g., the Netlify AI proxy) require a Firebase ID Token passed via `Authorization: Bearer <token>` and verified using the Firebase Admin SDK.

## 7. Financial Calculation Model
The existing `PocketPilot_Engine.js` will be expanded to support the new data model. It will remain a purely functional, deterministic engine.
- Inputs: Current cycle config, array of transactions, array of recurring expenses, array of goals.
- Outputs: `flexibleMoney`, `remainingFlexible`, `dailyAllowance`, `leftToday`, `verdict` (for AI context).
- It will never mutate the state. The frontend orchestrator applies the engine's simulated states to Firestore.

## 8. UI Architecture
**Constraint: Do NOT migrate to React.**

To eliminate code duplication and fragile imperative DOM manipulation while avoiding React, the application will adopt a **Vanilla JavaScript Component Architecture** (utilizing standard Web Components or an ES6 class-based component pattern).
- **State Management**: A lightweight reactive store (PubSub or vanilla Signals) will act as the single source of truth for the UI.
- **Components**: Reusable UI elements (Header, Sidebar, TransactionList) constructed via template literals or `document.createElement`.
- **Routing**: A vanilla JS client-side router to switch views (Dashboard, Transactions, Copilot) without full page reloads, maintaining a true Single Page Application (SPA) feel.
- **Styling**: The existing visual identity will be preserved using the current CSS variables, but CSS will be modularized.

## 9. AI Architecture
- **Intent Parsing**: The engine parses user input to extract numeric amounts and intents locally.
- **Fact Generation**: The engine runs a "what-if" simulation and generates a strictly bounded JSON context.
- **Secure Proxy**: The client sends the bounded context + chat history to the secured Netlify function.
- **Response Validation**: The engine parses the Gemini response. If the AI hallucinates a number not present in the allowed bounds, the response is discarded and a deterministic fallback is shown.

## 10. Security Model
- **Database**: Firestore rules strictly scoped: `allow read, write: if request.auth != null && request.auth.uid == userId;`.
- **API**: Netlify proxy validates tokens. If verification fails, return `401 Unauthorized`.
- **XSS Prevention**: The UI layer will stringently escape all user-generated content (notes, chat messages) before rendering.

## 11. Feature Priorities
1. Secure the Netlify API endpoint.
2. Implement Vanilla JS SPA routing and component architecture.
3. Restructure Firestore schema and adapt `PocketPilot_Engine.js`.
4. Build Dashboard and Transactions modules.
5. Build Budget Setup, Recurring Expenses, and Goals modules.
6. Build Insights module.
7. Re-integrate the AI Copilot.

## 12. Implementation Phases
- **Phase 1: Architecture & Security**
  - Finalize architectural design.
  - Secure the Netlify function.
- **Phase 2: Modernization (Vanilla JS)**
  - Scaffold the Vanilla SPA structure (router, state manager).
  - Break existing HTML into reusable JS components.
- **Phase 3: Database & Engine Scaling**
  - Implement subcollections in Firestore.
  - Expand the deterministic engine to handle Categories, Goals, and Recurring Expenses.
- **Phase 4: Core Features**
  - Implement Dashboard, Transactions, and Budget screens.
- **Phase 5: Advanced Features**
  - Implement Recurring Expenses, Goals, and Insights.
- **Phase 6: Copilot & Polish**
  - Re-integrate AI context building and chat interface.
  - Final UI polish and responsive adjustments.
