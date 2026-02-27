# ROADMAP.md — Agar.io Clone

This file tracks the progress of each phase. Update the status of each phase as work progresses.

---

## Phases

### Phase 1 — Project Foundation & Game Canvas
**Status:** ✅ Complete (Opus Approved)

**Goal:** Working Next.js app with a Phaser canvas, local single-player gameplay, and food pellet eating.

**Scope:**
- T3 app scaffolded (no auth, no Prisma) ✅
- Phaser.js installed ✅
- SpacetimeDB JS SDK installed ✅
- `.claude/settings.json` with Opus Stop hook ✅
- SpacetimeDB Rust module scaffolded ✅
- Lobby screen — player enters name and clicks Play
- Phaser game canvas fills the screen
- Player cell rendered, moves toward mouse cursor
- Large world (3000x3000) with grid background and boundary walls
- Viewport camera follows the player
- Food pellets spawned randomly (200+ pellets), client-side
- Player eats food on overlap and grows in radius

**Opus Audit:** ✅ Approved

---

### Phase 2 — SpacetimeDB Integration
**Status:** ✅ Complete (Opus Approved)

**Goal:** Move all game state to SpacetimeDB Maincloud and sync between clients in real-time.

**Scope:**

- SpacetimeDB Rust module tables: `Player`, `FoodPellet`, `GameConfig` ✅
- Reducers: `spawn_player`, `update_position`, `eat_food`, `despawn_player` ✅
- Client connects via SpacetimeDB JS SDK to Maincloud ✅
- Player positions broadcast in real-time to all clients ✅
- Food pellets managed server-side (respawn on eat) ✅
- Player disconnection cleans up their cell ✅
- Two browser tabs show each other's cells moving and eating food ✅

**Opus Audit:** ✅ Approved

---

### Phase 3 — Core Game Mechanics
**Status:** 🔲 Not Started

**Goal:** Full Agar.io gameplay loop.

**Scope:**
- Player-eats-player logic (larger absorbs smaller on overlap)
- Mass/size decay over time
- Minimap showing all players
- Live leaderboard (top 5 by size)
- Eject mass mechanic (W key)
- Cell split mechanic (Space key) — merges back after delay
- Respawn flow after being eaten

**Opus Audit:** 🔲 Pending

---

### Phase 4 — Polish & Shareability
**Status:** 🔲 Not Started

**Goal:** Fun, shareable game playable by friends via a URL.

**Scope:**
- Player name displayed above cell
- Random cell color on spawn (or player picks)
- Visual feedback: eating animation, death animation
- Grid background (classic Agar.io look)
- Zoom scaling as cell grows
- Basic mobile touch support
- Deploy frontend to Vercel
- SpacetimeDB module confirmed live on Maincloud
- Shareable URL — friends open link and play

**Opus Audit:** 🔲 Pending

---

## Status Legend

| Icon | Meaning |
|------|---------|
| 🔲 | Not Started |
| 🔄 | In Progress |
| ✅ | Complete (Opus Approved) |
| ❌ | Blocked |
