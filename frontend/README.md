# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Run with LightRAG (Windows)

From the repository root, start the API and both front ends in separate terminals (adjust paths if your clone is elsewhere). See also the [root README](../README.md#local-development-windows-three-terminals) and [LightRAG Server README](../lightrag/api/README.md#local-development-windows-three-terminals).

**This app** (`frontend`):

```cmd
cd /d C:\Users\User\Desktop\lightrag-langchain\frontend && npm run dev
```

**API + `lightrag_webui`** — run in two other terminals:

```cmd
cd /d C:\Users\User\Desktop\lightrag-langchain && .venv\Scripts\activate && lightrag-server
```

```cmd
cd /d C:\Users\User\Desktop\lightrag-langchain\lightrag_webui && bun run dev
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

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
