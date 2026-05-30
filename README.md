# QuoteCatch

QuoteCatch is a deployable MVP lead-intake and estimate-prep chat for a US plumbing/HVAC business. It uses Next.js App Router, a server-side OpenAI API route, markdown rendering, and image uploads for photo-aware intake.

## Set `OPENAI_API_KEY`

Create `.env.local` in the project root:

```bash
OPENAI_API_KEY=your_api_key_here
```

The key is read only in `app/api/chat/route.ts` and is never exposed to browser code.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the project in Vercel.
3. Add `OPENAI_API_KEY` in Vercel Project Settings under Environment Variables.
4. Deploy. Vercel will run the Next.js build and provide a public URL.

The assistant prompt lives in `prompts/quotecatch-system-prompt.txt` and is loaded server-side by `/api/chat`.
