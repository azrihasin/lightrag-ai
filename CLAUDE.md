# Project Instructions

## Do NOT start the server during chat

Do not run, start, or launch any dev/backend/frontend server during a chat session
(e.g. `npm run dev`, `npm start`, `nest start`, the minds-ai-agent backend on port 3001,
the frontend on 5173, etc.). The user runs servers themselves.

- The minds-ai-agent backend runs on port **3001** (see `minds-ai-agent/.env`).
- The frontend (Vite) runs on port **5173**.

If verifying a change requires a running server, ask the user to start it rather than
starting it yourself.
