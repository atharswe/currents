# Currents

A self-hostable RSS/Atom reader. Own your feeds, read them fast, search everything you've ever read.

Currents is built for people who want the old RSS workflow back without handing their reading
history to a third party. Point it at some feeds, it polls them on a schedule, dedupes what it
already has, and gives you a keyboard-driven reader with full-text search over every article it
has ever seen.

## Why

Most feed readers are either a cloud service that can disappear, or a desktop app that only
works on one machine. Currents is a single Next.js process with a SQLite file next to it. Run it
on a Raspberry Pi, a VPS, or your laptop. Back it up by copying one file.

## Status

Early, actively being built. See the roadmap below.

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

## Roadmap

- [ ] Schema + migrations for feeds, articles, and read state
- [ ] RSS/Atom/RDF parsing with conditional GET and dedupe
- [ ] Feed subscription and refresh actions
- [ ] Reader UI with keyboard navigation
- [ ] Full-text search
- [ ] OPML import/export
- [ ] Docker image

## License

MIT
