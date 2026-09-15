Lexi is a voice-first companion. The homepage composer talks to Grok Speech-to-Speech (`grok-voice-latest`) over a duplex WebSocket.

## Voice setup

1. Copy `.env.example` to `.env.local`.
2. Set `XAI_API_KEY` on the **server only**. The Next.js route `POST /api/realtime/session` exchanges it for a short-lived xAI client secret. The browser never sees the long-lived key.
3. Run the dev server and open the app. Empty composer → stroked waveform starts voice mode. Typed text → send arrow (starts a session if needed, then `conversation.item.create` + `response.create`). While live, the animated waveform ends the session. Voice sessions include xAI `web_search` (server-side; no extra API key) plus a client `get_video_context` tool. Per-turn `CURRENT DECAY STATE` comes from Neon memories for cookie `lexi_user_id` (default user `ian`). Without `DATABASE_URL` the payload is `no active decay tags`.

## Watch together

Load a **direct** mp4/webm URL or upload a file from the bar above the composer. YouTube and similar pages will not play in the HTML5 player — download or use a direct file URL.

Voice stays live while the video plays. Talking does **not** pause the video; pausing is only from the player controls. Lexi answers “what’s happening?” by calling `get_video_context`, which captures the current frame(s) and analyzes them with the documented xAI image-understanding API (`POST https://api.x.ai/v1/responses`, model `grok-4.6`) using server-only `XAI_API_KEY`.

Video audio and Lexi’s voice mix in the same speakers. **Headphones are recommended** so the mic does not hear the movie or Lexi. Barge-in still cancels only Lexi’s speech, not the video.

## Memory (Neon)

1. Create a Neon Postgres database and copy the connection string.
2. Set `DATABASE_URL` (or `NEON_DATABASE_URL`) in `.env.local` and in Vercel env — server-only, never `NEXT_PUBLIC_`.
3. Create the table: `POST /api/memory/migrate` (safe `IF NOT EXISTS`), or run `db/migrations/001_memories.sql`. The store also creates the table on first use.
4. Upsert: `POST /api/memory` with `{ userId, memoryKey, rawText, startSalience }` (`startSalience` 1–10). Recall + decay write-back: `GET /api/memory?userId=ian`. Compact voice lines: `GET /api/memory/decay-state`.
5. Decay (locked): band from **start** salience — low 1–3 rate 0.08, medium 4–6 rate 0.02, high 7–10 rate 0.005. `new = start × (1 − rate)^days`, `days = (recall − t0) / 86400`, floor 1. Clock is `t0`.

First human test should use **headphones**. Speaker echo is the mic hearing Lexi, not a loop bug.

Dev-only voice logs land in `.voice-logs/<sessionId>.ndjson`. Summarize a run with:

```bash
npm run voice:logs -- .voice-logs/<sessionId>.ndjson
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
