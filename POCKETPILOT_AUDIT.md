# PocketPilot Technical Audit

## 1. Current Architecture
PocketPilot is a client-heavy web application consisting of multiple HTML pages (Multi-Page Application) that rely on shared JavaScript modules. It uses Firebase for Authentication and Firestore for state persistence, and relies on a Netlify serverless function to proxy requests to the Gemini API for the AI chat feature.

## 2. File Structure
- `public/`: Contains all client-side assets.
  - `*.html`: Separate pages for each view (`index.html`, `login.html`, `setup.html`, `payment.html`, `chat.html`).
  - `css/style.css`: Contains all styling, CSS variables, and design tokens.
  - `js/firebase.js`: Firebase initialization and exports.
  - `js/script.js`: Core frontend logic, DOM manipulation, auth state handling, and API integration.
  - `js/PocketPilot_Engine.js`: A robust, pure-function mathematical engine for financial calculations and AI context generation.
- `netlify/functions/chat.mjs`: Serverless edge function acting as a proxy for the Gemini API.
- `firestore.rules`: Security rules for Firestore.
- `netlify.toml`: Deployment and routing configuration for Netlify.

## 3. Current User Flow
1. **Landing (`index.html`)**: Introduces the product.
2. **Authentication (`login.html`)**: Sign up / Sign in.
3. **Configuration (`setup.html`)**: User sets available amount, fixed expenses, and days.
4. **Operations (`payment.html`)**: Log transactions (including backdated ones) to update allowance.
5. **Guidance (`chat.html`)**: Consult the AI before spending.

## 4. Financial Calculation Engine
The financial engine (`PocketPilot_Engine.js`) is an exceptionally well-designed pure-function module. It accepts state, inputs, and dates, returning new simulated states or calculations without side effects. It handles edge cases like backdated payments, double-tap prevention, gap detection, and generates strict contextual bounds for the AI to follow.

## 5. Data Persistence
Data is persisted in Firebase Firestore. The user's entire state (budget configuration, transaction history, and chat history) is stored as a single document at the path `users/{uid}/pocketpilot/state`.

## 6. Firebase/Firestore
- Uses Firebase Web SDK (v12).
- Authentication uses Email/Password.
- Firestore security rules are correctly configured to restrict access to the authenticated user's own data (`request.auth.uid == userId`).
- Firebase configuration is hardcoded in `firebase.js`.

## 7. Authentication
Authentication is managed in `script.js` with Firebase Auth. It enforces login for protected pages and handles sign up/sign in flows on `login.html`.

## 8. AI Architecture
- The frontend extracts intent and numerical amounts from user chat input.
- It leverages the Engine to build a highly structured system prompt with exact financial facts.
- It calls `/api/chat` (the Netlify function) with the system prompt and recent chat history.
- The AI's response is validated against the mathematical facts by the Engine before being shown to the user, with robust fallbacks.

## 9. Current UI Architecture
The UI is built with vanilla HTML and a single large CSS file (`style.css`). It utilizes CSS variables extensively for a consistent design system (dark green/teal background, emerald primary, gold accents). There is no component framework, leading to duplicated HTML across pages (like headers and profile menus) and fragile imperative DOM manipulation in `script.js`.

## 10. Current Problems
- **Single Document Limit**: Storing the entire transaction and chat history in a single Firestore document will eventually hit the 1MB size limit.
- **Unprotected API Endpoint**: The `/api/chat` Netlify function does not verify if the request comes from an authenticated user. Anyone can hit this endpoint and consume the Gemini API quota.
- **Code Duplication**: HTML structure for navigation and headers is duplicated across 4 files.
- **Fragile DOM Logic**: `script.js` is nearly 600 lines of mixed concerns (auth, routing, DOM updates, API calls), making it prone to breakage during UI updates.

## 11. Technical Debt
- Lack of a modern frontend framework (React, Vue, Svelte) makes scaling the UI difficult.
- Absence of a module bundler.
- Global scope pollution (`window.PocketPilotEngine`).

## 12. Security Concerns
- **Critical**: The Netlify proxy (`chat.mjs`) needs to validate Firebase ID tokens to prevent abuse.
- Minor: Firebase config is checked into source control (acceptable for Web SDKs but best practice is to inject via environment variables if possible).

## 13. What Should Be Preserved
- The visual identity: Dark green/teal background, emerald accents, gold financial numbers.
- The product concept: "What you can safely spend, not what you already spent."
- The `PocketPilot_Engine.js` module: The pure mathematical logic and AI contextual guardrails are excellent and should be carried over untouched.
- The Firebase authentication and Firestore usage (conceptually).

## 14. What Should Be Rebuilt
- The UI layer: Should be rewritten using a modern component-based framework to eliminate HTML duplication and clean up DOM manipulation.
- State Management: Transition from a single document to structured subcollections for scalability (e.g., separate collections for `transactions` and `chatHistory`).
- The Netlify `/api/chat` function: Must be secured with Firebase Auth verification.

## 15. Recommended Architecture
- **Frontend**: A modern SPA framework (e.g., React with Vite or Next.js) using modular components.
- **State/Database**: Firestore, utilizing subcollections (`users/{uid}/transactions`, `users/{uid}/chats`).
- **Backend/API**: Netlify Functions (or Firebase Cloud Functions) with Firebase Admin SDK to verify user tokens.

## 16. Recommended Implementation Order
1. **Phase 1**: Secure the existing Netlify function and resolve immediate vulnerabilities.
2. **Phase 2**: Scaffold the new modern frontend (Vite + Framework).
3. **Phase 3**: Port `PocketPilot_Engine.js` and implement robust state management.
4. **Phase 4**: Rebuild UI components preserving the visual identity.
5. **Phase 5**: Restructure the Firestore database schema and write a migration script for existing users.
