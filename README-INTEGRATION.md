# PocketPilot integration bundle

## Before running
1. Put the original `logo.png` in `public/` if you have it. It was not included in the supplied files.
2. Edit `public/js/firebase.js` and paste the Firebase Web App config.
3. In Firebase Authentication, enable Email/Password.
4. Create a Firestore database and deploy `firestore.rules`.
5. In Netlify, set `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` as Functions environment variables.
6. Deploy this folder to Netlify.

## Local test
Use a local web server, not `file://`:
`python -m http.server 5500 --directory public`

The AI proxy needs Netlify Dev to work locally. After installing the Netlify CLI, run `netlify dev` from the project root.
