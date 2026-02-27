use spacetimedb::{Identity, ReducerContext, Table};
use spacetimedb::rand::Rng;

const WORLD_WIDTH: f32 = 3000.0;
const WORLD_HEIGHT: f32 = 3000.0;
const MAX_FOOD: u32 = 200;
const FOOD_RADIUS: f32 = 6.0;
const INITIAL_MASS: f32 = 100.0;

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

#[spacetimedb::table(name = "food_pellet", accessor = food_pellet, public)]
pub struct FoodPellet {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
}

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
        ctx.db.food_pellet().insert(FoodPellet {
            id: 0,
            x,
            y,
            radius: FOOD_RADIUS,
        });
    }
}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(_ctx: &ReducerContext) {
    // Spawn happens explicitly via spawn_player reducer
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    ctx.db.player().identity().delete(ctx.sender());
}

#[spacetimedb::reducer]
pub fn spawn_player(ctx: &ReducerContext, name: String) {
    let identity = ctx.sender();

    // Remove any stale entry from a previous session
    ctx.db.player().identity().delete(identity);

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

#[spacetimedb::reducer]
pub fn eat_food(ctx: &ReducerContext, food_id: u64) {
    let identity = ctx.sender();

    if let Some(player) = ctx.db.player().identity().find(identity) {
        if let Some(food) = ctx.db.food_pellet().id().find(food_id) {
            // Validate proximity: player must overlap with food to eat it
            let dx = food.x - player.x;
            let dy = food.y - player.y;
            let dist_sq = dx * dx + dy * dy;
            let eat_dist = player.radius + food.radius;
            // Allow 2x leeway for network latency
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

            // Respawn food at a new random location
            let mut rng = ctx.rng();
            let new_x = rng.gen_range(20.0_f32..(WORLD_WIDTH - 20.0));
            let new_y = rng.gen_range(20.0_f32..(WORLD_HEIGHT - 20.0));
            ctx.db.food_pellet().insert(FoodPellet {
                id: 0,
                x: new_x,
                y: new_y,
                radius: FOOD_RADIUS,
            });
        }
    }
}

#[spacetimedb::reducer]
pub fn despawn_player(ctx: &ReducerContext) {
    ctx.db.player().identity().delete(ctx.sender());
}
