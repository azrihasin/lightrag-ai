# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR.

## Run with the LanceDB hybrid-retrieval backend (Windows)

From the repository root, start the backend API and this front end in separate
terminals (adjust paths if your clone is elsewhere). Schema retrieval is served
locally from the LanceDB `vdb_chunks` table by the backend — there is no separate
retrieval server to start.

**This app** (`frontend`):

```cmd
cd frontend && npm run dev
```

**Backend API** (`minds-ai-agent`) — run in another terminal:

```cmd
cd minds-ai-agent && npm run start:dev
```

## Chat API

The project includes a streaming chat API (adapted from Next.js API routes) that runs as a separate Express server:

1. **Set your OpenAI API key** – Copy `.env.example` to `.env` and add your `OPENAI_API_KEY`.
2. **Run both servers** – Use `npm run dev:all` to start the Vite dev server and the chat API server together.
3. **Or run separately** – `npm run dev` for Vite, `npm run dev:server` for the API (port 3001).

The Vite dev server proxies `/api/*` to the Express server, so the frontend uses `/api/chat` seamlessly.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

