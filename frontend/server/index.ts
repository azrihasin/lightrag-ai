import express from "express";
import cors from "cors";
import { Readable } from "node:stream";

const app = express();
const PORT = process.env.PORT ?? 3001;
const BACKEND_CHAT_URL =
  process.env.CHAT_URL ?? "http://localhost:3000/api/chat";

app.use(cors());
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  try {
    const response = await fetch(BACKEND_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body ?? {}),
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      res.status(response.status).send(text || "Upstream chat request failed");
      return;
    }

    res.status(response.status);
    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") ?? "text/event-stream"
    );
    res.setHeader(
      "Cache-Control",
      response.headers.get("cache-control") ?? "no-cache"
    );
    res.setHeader(
      "Connection",
      response.headers.get("connection") ?? "keep-alive"
    );
    res.setHeader(
      "x-vercel-ai-ui-message-stream",
      response.headers.get("x-vercel-ai-ui-message-stream") ?? "v1"
    );

    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error("Chat API error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Chat API server running at http://localhost:${PORT}`);
});
