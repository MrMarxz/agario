use spacetimedb::{Identity, ReducerContext, Table, TimeDuration};
use spacetimedb::rand::Rng;

const WORLD_WIDTH: f32 = 3000.0;
const WORLD_HEIGHT: f32 = 3000.0;
const MAX_FOOD: u32 = 200;
const FOOD_RADIUS: f32 = 6.0;
const INITIAL_MASS: f32 = 100.0;
const EJECT_MASS_AMOUNT: f32 = 10.0;
const MIN_SPLIT_MASS: f32 = 200.0;
const MASS_DECAY_RATE: f32 = 0.998;

fn mass_to_radius(mass: f32) -> f32 {
    mass.sqrt() * 2.0
}

#[spacetimedb::table(name = "game_config", accessor = game_config, public)]
pub struct GameConfig {
    #[primary_key]
    pub id: u32,
    pub max_food: u32,
    pub world_width: u32,
    pub world_height: u32,
}

/// Main player row: identity, name, position, mass, color.
#[spacetimedb::table(name = "player", accessor = player, public)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    pub mass: f32,
    pub color: u32,
}

/// Each split half is a separate row so both halves can move independently.
#[spacetimedb::table(name = "player_cell", accessor = player_cell, public)]
pub struct PlayerCell {
    #[primary_key]
    #[auto_inc]
    pub cell_id: u64,
    pub player_identity: Identity,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    pub mass: f32,
}

#[spacetimedb::table(name = "food_pellet", accessor = food_pellet, public)]
pub struct FoodPellet {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
}

/// Ejected mass pellets visible to all players.
#[spacetimedb::table(name = "ejected_mass", accessor = ejected_mass, public)]
pub struct EjectedMass {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    pub mass: f32,
}

/// Drives mass decay every 2 seconds (repeating schedule).
#[spacetimedb::table(name = "mass_decay_schedule", accessor = mass_decay_schedule, scheduled(decay_mass))]
pub struct MassDecaySchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: spacetimedb::ScheduleAt,
}

/// One-time schedule to merge a split cell back after 10 seconds.
#[spacetimedb::table(name = "split_merge_schedule", accessor = split_merge_schedule, scheduled(merge_split))]
pub struct SplitMergeSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: spacetimedb::ScheduleAt,
    pub player_identity: Identity,
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) {
    ctx.db.game_config().insert(GameConfig {
        id: 0,
        max_food: MAX_FOOD,
        world_width: WORLD_WIDTH as u32,
        world_height: WORLD_HEIGHT as u32,
    });

    let mut rng = ctx.rng();
    for _ in 0..MAX_FOOD {
        let x = rng.gen_range(20.0_f32..(WORLD_WIDTH - 20.0));
        let y = rng.gen_range(20.0_f32..(WORLD_HEIGHT - 20.0));
        ctx.db.food_pellet().insert(FoodPellet { id: 0, x, y, radius: FOOD_RADIUS });
    }

    // Start the repeating mass-decay schedule
    let two_secs = TimeDuration::from_micros(2_000_000);
    ctx.db.mass_decay_schedule().insert(MassDecaySchedule {
        scheduled_id: 0,
        scheduled_at: two_secs.into(),
    });
}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(_ctx: &ReducerContext) {}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    let identity = ctx.sender();
    ctx.db.player().identity().delete(identity);
    delete_player_cells(ctx, identity);
}

// ---------------------------------------------------------------------------
// Player management
// ---------------------------------------------------------------------------

#[spacetimedb::reducer]
pub fn spawn_player(ctx: &ReducerContext, name: String) {
    let identity = ctx.sender();

    // Remove any stale session data
    ctx.db.player().identity().delete(identity);
    delete_player_cells(ctx, identity);

    let mut rng = ctx.rng();
    let x = rng.gen_range(100.0_f32..(WORLD_WIDTH - 100.0));
    let y = rng.gen_range(100.0_f32..(WORLD_HEIGHT - 100.0));

    let colors: &[u32] = &[
        0x4a90d9, 0xe74c3c, 0x2ecc71, 0xf39c12,
        0x9b59b6, 0x1abc9c, 0xe91e63, 0x00bcd4,
    ];
    let color = colors[rng.gen_range(0..colors.len())];

    ctx.db.player().insert(Player {
        identity,
        name,
        x,
        y,
        radius: mass_to_radius(INITIAL_MASS),
        mass: INITIAL_MASS,
        color,
    });
}

#[spacetimedb::reducer]
pub fn despawn_player(ctx: &ReducerContext) {
    let identity = ctx.sender();
    ctx.db.player().identity().delete(identity);
    delete_player_cells(ctx, identity);
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

#[spacetimedb::reducer]
pub fn update_position(ctx: &ReducerContext, x: f32, y: f32) {
    let identity = ctx.sender();
    if let Some(player) = ctx.db.player().identity().find(identity) {
        let clamped_x = x.clamp(player.radius, WORLD_WIDTH - player.radius);
        let clamped_y = y.clamp(player.radius, WORLD_HEIGHT - player.radius);
        ctx.db.player().identity().update(Player {
            x: clamped_x,
            y: clamped_y,
            ..player
        });
    }
}

/// Update the position of a split-cell half. Caller must own the cell.
#[spacetimedb::reducer]
pub fn update_cell_position(ctx: &ReducerContext, cell_id: u64, x: f32, y: f32) {
    let identity = ctx.sender();
    let Some(cell) = ctx.db.player_cell().cell_id().find(cell_id) else { return; };
    if cell.player_identity != identity { return; }
    let clamped_x = x.clamp(cell.radius, WORLD_WIDTH - cell.radius);
    let clamped_y = y.clamp(cell.radius, WORLD_HEIGHT - cell.radius);
    ctx.db.player_cell().cell_id().update(PlayerCell {
        x: clamped_x,
        y: clamped_y,
        ..cell
    });
}

// ---------------------------------------------------------------------------
// Eating
// ---------------------------------------------------------------------------

#[spacetimedb::reducer]
pub fn eat_food(ctx: &ReducerContext, food_id: u64) {
    let identity = ctx.sender();
    if let Some(player) = ctx.db.player().identity().find(identity) {
        if let Some(food) = ctx.db.food_pellet().id().find(food_id) {
            let dx = food.x - player.x;
            let dy = food.y - player.y;
            let dist_sq = dx * dx + dy * dy;
            let eat_dist = player.radius + food.radius;
            if dist_sq > (eat_dist * 2.0) * (eat_dist * 2.0) {
                return;
            }
            ctx.db.food_pellet().id().delete(food_id);

            let new_mass = player.mass + 1.0;
            ctx.db.player().identity().update(Player {
                mass: new_mass,
                radius: mass_to_radius(new_mass),
                ..player
            });

            let mut rng = ctx.rng();
            let new_x = rng.gen_range(20.0_f32..(WORLD_WIDTH - 20.0));
            let new_y = rng.gen_range(20.0_f32..(WORLD_HEIGHT - 20.0));
            ctx.db.food_pellet().insert(FoodPellet { id: 0, x: new_x, y: new_y, radius: FOOD_RADIUS });
        }
    }
}

/// Eat another player: caller must be 10%+ larger and overlapping.
/// The target's entire mass (including any split cells) is absorbed.
#[spacetimedb::reducer]
pub fn eat_player(ctx: &ReducerContext, target_identity: Identity) {
    let eater_id = ctx.sender();
    if eater_id == target_identity { return; }

    let Some(eater) = ctx.db.player().identity().find(eater_id) else { return; };
    let Some(target) = ctx.db.player().identity().find(target_identity) else { return; };

    if eater.mass < target.mass * 1.1 { return; }

    let dx = eater.x - target.x;
    let dy = eater.y - target.y;
    let dist_sq = dx * dx + dy * dy;
    if dist_sq > (eater.radius * 2.0) * (eater.radius * 2.0) { return; }

    // Absorb target's split-cell mass too
    let split_mass: f32 = ctx.db.player_cell().iter()
        .filter(|c| c.player_identity == target_identity)
        .map(|c| c.mass)
        .sum();

    let new_mass = eater.mass + target.mass + split_mass;
    ctx.db.player().identity().update(Player {
        mass: new_mass,
        radius: mass_to_radius(new_mass),
        ..eater
    });

    ctx.db.player().identity().delete(target_identity);
    delete_player_cells(ctx, target_identity);
}

/// Eat an ejected mass pellet.
#[spacetimedb::reducer]
pub fn eat_ejected_mass(ctx: &ReducerContext, mass_id: u64) {
    let identity = ctx.sender();
    let Some(player) = ctx.db.player().identity().find(identity) else { return; };
    let Some(em) = ctx.db.ejected_mass().id().find(mass_id) else { return; };

    let dx = em.x - player.x;
    let dy = em.y - player.y;
    let dist_sq = dx * dx + dy * dy;
    let eat_dist = player.radius + em.radius;
    if dist_sq > (eat_dist * 2.0) * (eat_dist * 2.0) { return; }

    ctx.db.ejected_mass().id().delete(mass_id);
    let new_mass = player.mass + em.mass;
    ctx.db.player().identity().update(Player {
        mass: new_mass,
        radius: mass_to_radius(new_mass),
        ..player
    });
}

// ---------------------------------------------------------------------------
// Decay (scheduled)
// ---------------------------------------------------------------------------

#[spacetimedb::reducer]
pub fn decay_mass(_ctx: &ReducerContext, _schedule: MassDecaySchedule) {
    for player in _ctx.db.player().iter() {
        if player.mass > INITIAL_MASS {
            let new_mass = (player.mass * MASS_DECAY_RATE).max(INITIAL_MASS);
            _ctx.db.player().identity().update(Player {
                mass: new_mass,
                radius: mass_to_radius(new_mass),
                ..player
            });
        }
    }
    // Also decay split cells (floor: half the starting mass)
    let min_cell_mass = INITIAL_MASS / 2.0;
    for cell in _ctx.db.player_cell().iter() {
        if cell.mass > min_cell_mass {
            let new_mass = (cell.mass * MASS_DECAY_RATE).max(min_cell_mass);
            _ctx.db.player_cell().cell_id().update(PlayerCell {
                mass: new_mass,
                radius: mass_to_radius(new_mass),
                ..cell
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Eject mass
// ---------------------------------------------------------------------------

#[spacetimedb::reducer]
pub fn eject_mass(ctx: &ReducerContext, dir_x: f32, dir_y: f32) {
    let identity = ctx.sender();
    let Some(player) = ctx.db.player().identity().find(identity) else { return; };

    if player.mass <= INITIAL_MASS + EJECT_MASS_AMOUNT { return; }

    let len = (dir_x * dir_x + dir_y * dir_y).sqrt();
    if len < 0.001 { return; }
    let nx = dir_x / len;
    let ny = dir_y / len;

    let eject_dist = 300.0_f32;
    let ej_x = (player.x + nx * eject_dist).clamp(20.0, WORLD_WIDTH - 20.0);
    let ej_y = (player.y + ny * eject_dist).clamp(20.0, WORLD_HEIGHT - 20.0);

    let new_mass = player.mass - EJECT_MASS_AMOUNT;
    ctx.db.player().identity().update(Player {
        mass: new_mass,
        radius: mass_to_radius(new_mass),
        ..player
    });

    ctx.db.ejected_mass().insert(EjectedMass {
        id: 0,
        x: ej_x,
        y: ej_y,
        radius: mass_to_radius(EJECT_MASS_AMOUNT),
        mass: EJECT_MASS_AMOUNT,
    });
}

// ---------------------------------------------------------------------------
// Split / merge
// ---------------------------------------------------------------------------

/// Split the player's cell in two. The split half is inserted as a PlayerCell row,
/// enabling both halves to move independently toward the cursor.
#[spacetimedb::reducer]
pub fn split_cell(ctx: &ReducerContext, dir_x: f32, dir_y: f32) {
    let identity = ctx.sender();
    let Some(player) = ctx.db.player().identity().find(identity) else { return; };

    // Require minimum mass and must not already be split
    if player.mass < MIN_SPLIT_MASS { return; }
    let already_split = ctx.db.player_cell().iter().any(|c| c.player_identity == identity);
    if already_split { return; }

    let len = (dir_x * dir_x + dir_y * dir_y).sqrt();
    if len < 0.001 { return; }
    let nx = dir_x / len;
    let ny = dir_y / len;

    let half_mass = player.mass / 2.0;
    let split_offset = mass_to_radius(half_mass) * 2.5;
    let split_x = (player.x + nx * split_offset).clamp(50.0, WORLD_WIDTH - 50.0);
    let split_y = (player.y + ny * split_offset).clamp(50.0, WORLD_HEIGHT - 50.0);

    // Reduce main cell to half mass
    ctx.db.player().identity().update(Player {
        mass: half_mass,
        radius: mass_to_radius(half_mass),
        ..player
    });

    // Create the split half as a separate controllable row
    ctx.db.player_cell().insert(PlayerCell {
        cell_id: 0,
        player_identity: identity,
        x: split_x,
        y: split_y,
        radius: mass_to_radius(half_mass),
        mass: half_mass,
    });

    // Schedule merge back after 10 seconds
    let merge_time = ctx.timestamp + TimeDuration::from_micros(10_000_000);
    ctx.db.split_merge_schedule().insert(SplitMergeSchedule {
        scheduled_id: 0,
        scheduled_at: merge_time.into(),
        player_identity: identity,
    });
}

/// Merge all split cells back into the main cell.
#[spacetimedb::reducer]
pub fn merge_split(_ctx: &ReducerContext, schedule: SplitMergeSchedule) {
    let identity = schedule.player_identity;

    let cells: Vec<PlayerCell> = _ctx.db.player_cell().iter()
        .filter(|c| c.player_identity == identity)
        .collect();

    if cells.is_empty() { return; }

    let split_mass: f32 = cells.iter().map(|c| c.mass).sum();

    if let Some(player) = _ctx.db.player().identity().find(identity) {
        let merged_mass = player.mass + split_mass;
        _ctx.db.player().identity().update(Player {
            mass: merged_mass,
            radius: mass_to_radius(merged_mass),
            ..player
        });
    }

    for cell in cells {
        _ctx.db.player_cell().cell_id().delete(cell.cell_id);
    }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

fn delete_player_cells(ctx: &ReducerContext, identity: Identity) {
    let ids: Vec<u64> = ctx.db.player_cell().iter()
        .filter(|c| c.player_identity == identity)
        .map(|c| c.cell_id)
        .collect();
    for id in ids {
        ctx.db.player_cell().cell_id().delete(id);
    }
}
