This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Leaderboard

- **Persistence**:
  - **Vercel / production**: Set `DATABASE_URL` or `POSTGRES_URL` (e.g. from [Neon](https://neon.tech)) in your environment. The app uses Postgres and the leaderboard persists.
  - **Local**: If neither is set, the leaderboard uses SQLite in `data/leaderboard.db` and persists across restarts.
- **Blocklist**: Names are checked before submission. **No blocklist words are stored in the repo.** Configure terms via the **`LEADERBOARD_BLOCKED_TERMS`** environment variable (comma- or newline-separated, e.g. in Vercel: Project → Settings → Environment Variables). Matching is case-insensitive and normalizes common substitutions (0→o, 1→i, etc.). If unset, no blocking is applied (fine for local dev; set it in production).
- **Removing a bad entry**: Set `LEADERBOARD_ADMIN_KEY` in your environment (e.g. a long random string). Then you can delete an entry by ID:
  ```bash
  curl -X DELETE http://localhost:3000/api/leaderboard \
    -H "Content-Type: application/json" \
    -d '{"adminKey":"YOUR_KEY","id":3}'
  ```
  Entry IDs are in the API response when you `GET /api/leaderboard` (each entry has an `id` field).

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
