# Currents

A self-hostable RSS/Atom reader. Own your feeds, read them fast, search everything you've ever saved.

Currents is a single Next.js process and a SQLite file. Point it at some feeds — or a blog homepage, it will find the feed — and it polls them on a schedule, dedupes what it already has, and gives you a keyboard-driven reader with full-text search over every article it has ever seen.

## Why

Most feed readers are either a cloud service that can disappear, or a desktop app that only works on one machine. Currents runs on a Raspberry Pi, a VPS, or a laptop. Back it up by copying one file.

## Features

- RSS 2.0, RSS 1.0/RDF, and Atom, with HTML sanitization
- Homepage paste: discovers `<link rel="alternate">` feed URLs
- Conditional GET (`ETag` / `Last-Modified`) and exponential backoff
- Full-text search via SQLite FTS5
- Keyboard navigation (`j`/`k`, `s` star, `m` read, `/` search, `?` help)
- OPML import and export
- SSRF protection on user-supplied feed URLs

## Stack

| Concern     | Choice                                  |
| ----------- | --------------------------------------- |
| Framework   | Next.js 16 (App Router, Server Actions) |
| Language    | TypeScript, strict                      |
| UI          | React 19 + Tailwind CSS v4              |
| Database    | SQLite via Drizzle ORM                  |
| Search      | SQLite FTS5                             |
| Validation  | Zod                                     |
| Tests       | Vitest                                  |
| Lint/format | Biome                                   |
| CI          | GitHub Actions                          |

## Run it

```bash
npm install
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Press `a` to add a feed, or pick one of the starters on the empty list.

```bash
npm test
npm run lint
npm run typecheck
```

## Docker

```bash
docker compose up --build
```

The SQLite file lives in the `currents-data` volume at `/data/currents.db`.

## Environment

| Variable                        | Purpose                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `DATABASE_PATH`                 | SQLite file location. Default `./data/currents.db`.                     |
| `CURRENTS_ALLOW_PRIVATE_HOSTS`  | Set to `true` to allow feeds on localhost / LAN (off by default).       |
| `CURRENTS_DISABLE_SCHEDULER`    | Set to `true` to skip the in-process 5-minute poll loop.                |
| `CURRENTS_REFRESH_SECRET`       | If set, `POST /api/refresh` requires `Authorization: Bearer <secret>`.  |

An external cron can hit `POST /api/refresh` (add `?force=1` to ignore backoff). The process also polls due feeds on its own about every five minutes.

## Keyboard

| Key        | Action                 |
| ---------- | ---------------------- |
| `j` / `k`  | Next / previous        |
| `o` / Enter| Open original          |
| `s`        | Star                   |
| `m`        | Toggle read            |
| `r`        | Refresh                |
| `/`        | Search                 |
| `a`        | Add a feed             |
| `1` `2` `3`| All / unread / starred |
| `?`        | Shortcuts              |

## License

MIT
