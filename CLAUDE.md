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

After completing any task or phase, Claude Code must follow this loop before considering the work done:

1. Run `npx tsc --noEmit` and fix any TypeScript errors
2. Use the Task tool to invoke a subagent with model `claude-opus-4-6` and the following prompt:
   > "You are a senior code auditor. Review all recently modified files in this session for this Agar.io clone built with Next.js, Phaser.js, and SpacetimeDB. Check for: 1) TypeScript errors or `any` usage, 2) SpacetimeDB module correctness (reducers, table definitions), 3) Phaser.js usage and game loop correctness, 4) Next.js App Router conventions (server vs client components), 5) Real-time sync logic and race conditions, 6) Missing error handling. Output either STATUS: APPROVED or STATUS: ISSUES followed by a numbered list of problems with file paths and line numbers."
3. If Opus returns `STATUS: ISSUES` — fix every listed issue and repeat from step 1
4. Only when Opus returns `STATUS: APPROVED` update ROADMAP.md and consider the task complete

The Stop hook in `.claude/settings.json` acts as a safety net but Claude Code must actively invoke the audit itself using the Task tool before stopping.

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
cd server && spacetime publish -p ./spacetimedb agario -y

# Publish with schema migration (drops all data — required when adding/removing columns)
cd server && spacetime publish -p ./spacetimedb agario -y --delete-data

# Regenerate TypeScript bindings (after publishing module changes)
spacetime generate --lang typescript --out-dir src/module_bindings -p server/spacetimedb -y
```

---

## Environment Notes (Windows)

This section captures all Windows-specific and Rust toolchain discoveries from this project. A fresh session on a new project with this stack should read this section first to skip all troubleshooting.

### Rust Toolchain Setup (Critical)

**Problem:** Git for Windows installs its own `link.exe` in its bin directory, which conflicts with Rust's MSVC linker. Attempting to build the SpacetimeDB Rust module with the default MSVC toolchain fails with linker errors.

**Solution:** Use the GNU toolchain instead:

```bash
# Install the GNU toolchain (if not already installed)
rustup toolchain install stable-x86_64-pc-windows-gnu

# Set it as the override for the SpacetimeDB project directory
cd server/spacetimedb
rustup override set stable-x86_64-pc-windows-gnu

# Add the wasm32 target to the GNU toolchain (required for SpacetimeDB compilation)
rustup target add wasm32-unknown-unknown --toolchain stable-x86_64-pc-windows-gnu
```

The override is stored per-directory in rustup's override table and applies automatically when in `server/spacetimedb/`. It does **not** affect other Rust projects on the machine.

### SpacetimeDB CLI — Windows Gotchas

- `--project-path` flag is **invalid** on the installed CLI version — always use the short form `-p`
- Always pass `-y` to skip interactive confirmation prompts (required in non-TTY contexts like Claude Code)
- The Rust module lives in `server/spacetimedb/` — CLI commands are run from `server/` using `-p ./spacetimedb`

**Canonical commands (use these, not the long-form variants):**

```bash
# Publish to Maincloud
cd server && spacetime publish -p ./spacetimedb agario -y

# Publish with schema migration — drops all table data (required when adding/removing columns)
cd server && spacetime publish -p ./spacetimedb agario -y --delete-data

# Regenerate TypeScript bindings (run from project root)
spacetime generate --lang typescript --out-dir src/module_bindings -p server/spacetimedb -y
```

### SpacetimeDB Maincloud Connection

- **Maincloud URL:** `https://maincloud.spacetimedb.com`
- **Database name:** `agario`
- **Dashboard:** `https://spacetimedb.com/agario`
- **JS SDK package:** `spacetimedb` (npm) — **not** the deprecated `@clockworklabs/spacetimedb-sdk`
- **SDK version:** `^2.0.2`
- **Rust SDK version:** `2.0.2` (in `server/spacetimedb/Cargo.toml`)

### SpacetimeDB Rust SDK — API Patterns (v2.0.2)

Non-obvious API details discovered while building this project:

**Table macro** — both `name` (string literal) and `accessor` (identifier) are required:

```rust
#[spacetimedb::table(name = "player", accessor = player, public)]
pub struct Player { ... }
```

**Context methods and fields:**

```rust
ctx.sender()      // METHOD — returns Identity (note the parentheses)
ctx.timestamp     // FIELD — returns Timestamp
ctx.rng()         // METHOD — returns &StdbRng; use: let mut rng = ctx.rng();
```

**Row update API** — must pass the full row struct:

```rust
ctx.db.player().identity().update(Player { field: new_value, ..old_row });
```

**Scheduled reducers** — table struct requirements:

```rust
use spacetimedb::TimeDuration;

#[spacetimedb::table(name = "game_tick_schedule", accessor = game_tick_schedule, scheduled(game_tick))]
pub struct GameTickSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: spacetimedb::ScheduleAt,
}

// Repeating schedule
scheduled_at: TimeDuration::from_micros(interval_ms * 1000).into()

// One-time schedule
scheduled_at: (ctx.timestamp + TimeDuration::from_micros(delay_ms * 1000)).into()
```

- Schedule tables should **not** be `public` — clients don't need them

### SpacetimeDB JS SDK — TypeScript Patterns

```typescript
// Import the typed connection from generated bindings (not from the npm package directly)
import { DbConnection } from "@/module_bindings";

// Connect to Maincloud
const conn = DbConnection.builder()
  .withUri("https://maincloud.spacetimedb.com")
  .withDatabaseName("agario")
  .onConnect((conn, identity, token) => { /* store token */ })
  .build();

// Table accessors on conn.db — snake_case matching Rust struct names
conn.db.player
conn.db.food_pellet
conn.db.ejected_mass

// Reducers on conn.reducers — camelCase
conn.reducers.spawnPlayer()
conn.reducers.eatPlayer({ targetIdentity })   // args are camelCase objects

// Subscriptions
conn.subscriptionBuilder()
  .onApplied(() => { /* initial data ready */ })
  .subscribe(["SELECT * FROM player", "SELECT * FROM food_pellet"]);
```

**Type mappings:**

- Rust `u64` → TypeScript `bigint`
- Rust `Identity` → TypeScript object with `.toHexString()` method
