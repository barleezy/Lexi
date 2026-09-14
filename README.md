Lexi is a voice-first companion. The homepage composer talks to Grok Speech-to-Speech (`grok-voice-latest`) over a duplex WebSocket.

## Voice setup

1. Copy `.env.example` to `.env.local`.
2. Set `XAI_API_KEY` on the **server only**. The Next.js route `POST /api/realtime/session` exchanges it for a short-lived xAI client secret. The browser never sees the long-lived key.
3. Run the dev server and open the app. Empty composer → stroked waveform starts voice mode. Typed text → send arrow (starts a session if needed, then `conversation.item.create` + `response.create`). While live, the animated waveform ends the session. Voice sessions include xAI `web_search` (server-side; no extra API key).

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
