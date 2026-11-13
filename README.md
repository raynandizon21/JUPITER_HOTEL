# Jupiter Hotel PMS

Web app for the Jupiter junket's hotel bookings: guest ledger, reservation calendar, guest billing, daily and monthly settlement with the hotel, room rates and a rate calculator.

## Run locally

Prerequisites: Node.js 20+ (and MySQL 8 if you want the database created).

```bash
npm install
cp .env.example .env      # then fill in DB_* values
npm run dev               # http://localhost:3000
```

`npm run dev` first runs `scripts/init-db.mjs`, which creates the `Jupiter_hotel` database and its tables from `database/schema.sql` if they don't exist yet. If MySQL isn't reachable it only prints a warning and the app still starts.

## Data

The app currently saves everything in the browser's localStorage (per browser). Use **Clear data** in the sidebar to reset it.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Set up the database, then start the dev server |
| `npm run db:init` | Only set up the database |
| `npm run build` | Production build into `dist/` |
| `npm run lint` | Type-check |
