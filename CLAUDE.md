# CLAUDE.md — Agar.io Clone

This file contains instructions for Claude Code when working on this project. Read this before starting any task.

---

## Project Overview

A real-time multiplayer browser game (Agar.io clone) built with:

- **Frontend:** Next.js (App Router), Phaser.js, Tailwind CSS
- **Backend:** SpacetimeDB (Rust module hosted on SpacetimeDB Maincloud)
- **Language:** TypeScript (frontend), Rust (SpacetimeDB module)

---

## Project Structure

```
/
├── src/                        # Next.js app (App Router)
│   ├── app/                    # Pages and layouts
│   ├── components/             # React components
│   └── module_bindings/        # Auto-generated SpacetimeDB TypeScript bindings (do not edit manually)
├── server/                     # SpacetimeDB backend
│   ├── spacetimedb/
│   │   ├── src/lib.rs          # Rust module (tables, reducers)
│   │   └── Cargo.toml
│   └── spacetime.json          # Points to maincloud
├── public/                     # Static assets
├── .claude/
│   └── settings.json           # Claude Code hooks (Opus audit on Stop)
├── CLAUDE.md                   # This file
└── ROADMAP.md                  # Phase tracker
```

---

## Key Conventions

### TypeScript
- Never use `any` — always use proper types or `unknown`
- Use `type` over `interface` unless extending is needed
- All async functions must have proper error handling with try/catch

### Next.js
- Use App Router only — no Pages Router
- Mark client components explicitly with `"use client"` at the top
- Server components are the default — only use client components when necessary (game canvas, real-time state)
- The Phaser game canvas must be wrapped in a `"use client"` component with dynamic import and `ssr: false`

### Phaser.js
- Initialize Phaser inside a `useEffect` with cleanup on unmount
- Do not use Phaser's global `window.Phaser` — always import properly
- Game scenes should be separate files in `src/game/scenes/`

### SpacetimeDB
- Never edit files inside `src/module_bindings/` — these are auto-generated
- To regenerate bindings after changing the Rust module run:
  ```bash
  spacetime generate --lang typescript --out-dir src/module_bindings --project-path server/spacetimedb
  ```
- To publish the Rust module to Maincloud:
  ```bash
  cd server && spacetime publish --project-path ./spacetimedb agario
  ```
- All game logic that must be authoritative (collision, eating, scoring) belongs in the Rust module reducers, not the client

### Tailwind
- Use Tailwind utility classes for all UI outside the game canvas
- Do not write custom CSS unless absolutely necessary

---

## Audit Workflow

When you believe a task is complete, **do not mark it as done**. The Stop hook will automatically trigger an Opus audit. Opus will either:

- Output `APPROVED` — task is complete
- Output a numbered list of issues — fix all issues and the hook will re-audit

Only once Opus outputs `APPROVED` is the task considered done.

---

## SpacetimeDB Notes

- The database is hosted on SpacetimeDB Maincloud (not local)
- Database name: `agario`
- The JS SDK package is `spacetimedb` (not the deprecated `@clockworklabs/spacetimedb-sdk`)
- Client connects via WebSocket to the Maincloud URL
- Module bindings must be regenerated any time the Rust module schema changes

---

## Running the Project

```bash
# Start the Next.js dev server
npm run dev

# Publish SpacetimeDB module (after changes to server/spacetimedb/src/lib.rs)
cd server && spacetime publish --project-path ./spacetimedb agario

# Regenerate TypeScript bindings (after publishing module changes)
spacetime generate --lang typescript --out-dir src/module_bindings --project-path server/spacetimedb
```

