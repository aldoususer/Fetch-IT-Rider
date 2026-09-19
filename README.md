# Fetch-It Rider

Driver app for Fetch-It — claim and complete **Delivery** and **Ride** jobs.
Next.js 16 · App Router · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma · PostgreSQL (Railway) · Vercel-ready PWA.

## What's inside

- **Online toggle** — go online/offline to control job matching.
- **Available feed** — open `PENDING` jobs matching your vehicle class (deliveries **and** rides), auto-refreshing every 10s.
- **Active job tracker** — accept → en route → picked up / passenger on board → in transit → completed, with GPS broadcast and status progression.
- **e-POD capture** — OTP, digital signature and drop-off photo for **delivery** jobs (rides complete at drop-off, no POD needed).
- **Earnings & stats** — completed jobs, rating, wallet earnings.

## Run locally

```bash
cp .env.example .env          # fill in DATABASE_URL + Google Maps key
npm install
npm run dev                   # http://localhost:3001
```

## Deploy to Vercel

1. Push this folder to a GitHub repo and import it in Vercel.
2. Set environment variables:
   - `DATABASE_URL` — the **public** Railway PostgreSQL connection string.
   - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — a Maps/Places-enabled Google key.
   - (optional) `NEXT_PUBLIC_TRACKING_SOCKET_URL` — enables real-time socket tracking; without it the app polls every few seconds.
3. Deploy. The build runs `prisma generate && next build`.

## Database

Shared with the Fetch-It **Customer** and **Admin** apps — one PostgreSQL schema (`prisma/schema.prisma`), one `DATABASE_URL`. Riders register here with a `vehicleClass` (Motorcycle, Tricycle, Sedan, Closed Van, Flatbed, Refrigerated) that drives job matching for both product types.

To sync the schema after changing `prisma/schema.prisma`:

```bash
npm run db:push
```

## Demo accounts

Seeded automatically by the landing page (idempotent):

| Email | Password | Role |
|---|---|---|
| `rider@fetchit.app` | `demo1234` | RIDER (Closed Van) |
| `rider2@fetchit.app` | `demo1234` | RIDER (Motorcycle) |
