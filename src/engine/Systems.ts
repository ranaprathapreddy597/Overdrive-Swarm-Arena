// src/engine/Systems.ts

import { WorldState, SpatialHashGridState, getEntitiesWithComponent, getComponent, removeFromGrid, insertIntoGrid, createEntity, addComponent, destroyEntity, queryGrid } from './ECS';
import { PositionComponent, VelocityComponent, PlayerComponent, EnemyComponent, ProjectileComponent, ColliderComponent, HealthComponent, HunterBossComponent, createPosition, createVelocity, createType, createCollider, createDamage, createProjectile, createEnemy } from './Components';

/**
 * Updates player dash timer.
 */
export const updatePlayerSystem = (world: WorldState, dt: number) => {
  'worklet';
  const players = getEntitiesWithComponent(world, 'Player');
  if (players.length === 0) return;
  const playerEntity = players[0];
  const player = getComponent<PlayerComponent>(world, playerEntity, 'Player');

  if (player && player.isDashing) {
    player.dashTimer -= dt;
    if (player.dashTimer <= 0) {
      player.isDashing = false;
      player.dashTimer = 0;
    }
  }
};

/**
 * Updates game time and processes movement + spatial hashing.
 */
export const updateMovementSystem = (world: WorldState, grid: SpatialHashGridState, dt: number) => {
  'worklet';
  world.gameTime += dt;
  const entities = getEntitiesWithComponent(world, 'Position');

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const pos = getComponent<PositionComponent>(world, entity, 'Position');
    const vel = getComponent<VelocityComponent>(world, entity, 'Velocity');
    const proj = getComponent<ProjectileComponent>(world, entity, 'Projectile');

    if (pos && vel) {
      removeFromGrid(grid, entity, pos.x, pos.y);
      const dx = vel.vx * dt;
      const dy = vel.vy * dt;
      pos.x += dx;
      pos.y += dy;
      insertIntoGrid(grid, entity, pos.x, pos.y);

      // Handle projectile max range
      if (proj) {
        proj.distanceTraveled += Math.sqrt(dx * dx + dy * dy);
        if (proj.distanceTraveled >= proj.range) {
          removeFromGrid(grid, entity, pos.x, pos.y);
          destroyEntity(world, entity);
        }
      }
    }
  }
};

/**
 * AI for swarms: move towards the player.
 */
export const updateSwarmSystem = (world: WorldState, dt: number) => {
  'worklet';
  const players = getEntitiesWithComponent(world, 'Player');
  if (players.length === 0) return;
  const playerPos = getComponent<PositionComponent>(world, players[0], 'Position');
  if (!playerPos) return;

  const enemies = getEntitiesWithComponent(world, 'Enemy');
  for (let i = 0; i < enemies.length; i++) {
    const entity = enemies[i];
    const pos = getComponent<PositionComponent>(world, entity, 'Position');
    const vel = getComponent<VelocityComponent>(world, entity, 'Velocity');
    const enemy = getComponent<EnemyComponent>(world, entity, 'Enemy');

    if (pos && vel && enemy) {
      const dx = playerPos.x - pos.x;
      const dy = playerPos.y - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        vel.vx = (dx / dist) * enemy.speed;
        vel.vy = (dy / dist) * enemy.speed;
      }
    }
  }
};

/**
 * Player auto-attack: finds closest enemy and fires projectile.
 * Reads damage from PlayerComponent for level scaling.
 */
export const updateAutoFireSystem = (world: WorldState, grid: SpatialHashGridState, dt: number) => {
  'worklet';
  const players = getEntitiesWithComponent(world, 'Player');
  if (players.length === 0) return;
  const playerEntity = players[0];
  const player = getComponent<PlayerComponent>(world, playerEntity, 'Player');
  const pos = getComponent<PositionComponent>(world, playerEntity, 'Position');
  if (!player || !pos) return;

  if (player.weaponCooldown > 0) {
    player.weaponCooldown -= dt;
  } else {
    // Find closest enemy using grid query
    const nearby = queryGrid(grid, pos.x, pos.y, 500);
    let closestDist = Infinity;
    let closestEnemyPos: PositionComponent | null = null;

    for (let i = 0; i < nearby.length; i++) {
      const e = nearby[i];
      if (getComponent(world, e, 'Enemy') || getComponent(world, e, 'HunterBoss')) {
        const ePos = getComponent<PositionComponent>(world, e, 'Position');
        if (ePos) {
          const dist = Math.sqrt((ePos.x - pos.x) * (ePos.x - pos.x) + (ePos.y - pos.y) * (ePos.y - pos.y));
          if (dist < closestDist) {
            closestDist = dist;
            closestEnemyPos = ePos;
          }
        }
      }
    }

    if (closestEnemyPos) {
      player.weaponCooldown = player.fireRate;
      const dx = closestEnemyPos.x - pos.x;
      const dy = closestEnemyPos.y - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        const pSpeed = 650;
        const vx = (dx / dist) * pSpeed;
        const vy = (dy / dist) * pSpeed;

        const projId = createEntity(world);
        addComponent(world, projId, createType('projectile'));
        addComponent(world, projId, createPosition(pos.x, pos.y));
        addComponent(world, projId, createVelocity(vx, vy));
        addComponent(world, projId, createProjectile(pSpeed, 800));
        addComponent(world, projId, createCollider(10));
        addComponent(world, projId, createDamage(player.damage || 20));
        insertIntoGrid(grid, projId, pos.x, pos.y);
      }
    }
  }
};

/**
 * Handle Collisions: Projectile vs Enemy/Boss, Enemy vs Player.
 */
export const updateCollisionSystem = (world: WorldState, grid: SpatialHashGridState) => {
  'worklet';
  const players = getEntitiesWithComponent(world, 'Player');
  const playerEntity = players[0];
  const playerPos = playerEntity ? getComponent<PositionComponent>(world, playerEntity, 'Position') : null;
  const playerCollider = playerEntity ? getComponent<ColliderComponent>(world, playerEntity, 'Collider') : null;

  const projectiles = getEntitiesWithComponent(world, 'Projectile');

  const entitiesToDestroy: number[] = [];
  const destroyedMap: Record<number, boolean> = {};

  const markForDestruction = (id: number) => {
    if (!destroyedMap[id]) {
      destroyedMap[id] = true;
      entitiesToDestroy.push(id);
    }
  };

  for (let i = 0; i < projectiles.length; i++) {
    const projId = projectiles[i];
    if (destroyedMap[projId]) continue;

    const pPos = getComponent<PositionComponent>(world, projId, 'Position');
    const pCol = getComponent<ColliderComponent>(world, projId, 'Collider');
    const pDmg = getComponent(world, projId, 'Damage') as any;
    if (!pPos || !pCol) continue;

    const nearby = queryGrid(grid, pPos.x, pPos.y, pCol.radius + 50);
    for (let j = 0; j < nearby.length; j++) {
      const targetId = nearby[j];
      if (destroyedMap[targetId] || targetId === projId) continue;

      const isEnemy = getComponent(world, targetId, 'Enemy');
      const isBoss = getComponent(world, targetId, 'HunterBoss');

      if (isEnemy || isBoss) {
        const tPos = getComponent<PositionComponent>(world, targetId, 'Position');
        const tCol = getComponent<ColliderComponent>(world, targetId, 'Collider');

        if (tPos && tCol) {
          const dist = Math.sqrt((tPos.x - pPos.x) * (tPos.x - pPos.x) + (tPos.y - pPos.y) * (tPos.y - pPos.y));
          if (dist < pCol.radius + tCol.radius) {
            markForDestruction(projId);

            const health = getComponent<HealthComponent>(world, targetId, 'Health');
            if (health) {
              health.current -= (pDmg?.amount || 10);
              if (health.current <= 0) {
                markForDestruction(targetId);
                world.events.push({ type: 'EXPLOSION', x: tPos.x, y: tPos.y });
                world.events.push({ type: 'XP_DROP', x: tPos.x, y: tPos.y, value: isBoss ? 50 : 10 });
              }
            } else {
              markForDestruction(targetId);
              world.events.push({ type: 'EXPLOSION', x: tPos.x, y: tPos.y });
              world.events.push({ type: 'XP_DROP', x: tPos.x, y: tPos.y, value: isBoss ? 50 : 10 });
            }
            break;
          }
        }
      }
    }
  }

  // Check Enemy vs Player
  const playerComponent = playerEntity ? getComponent<PlayerComponent>(world, playerEntity, 'Player') : null;
  if (playerEntity && playerPos && playerCollider && !destroyedMap[playerEntity] && playerComponent && !playerComponent.isDashing) {
    const nearby = queryGrid(grid, playerPos.x, playerPos.y, playerCollider.radius + 50);
    for (let i = 0; i < nearby.length; i++) {
      const eId = nearby[i];
      if (destroyedMap[eId]) continue;

      if (getComponent(world, eId, 'Enemy') || getComponent(world, eId, 'HunterBoss') || getComponent(world, eId, 'Type')?.type === 'energy_mine') {
        const ePos = getComponent<PositionComponent>(world, eId, 'Position');
        const eCol = getComponent<ColliderComponent>(world, eId, 'Collider');
        if (ePos && eCol) {
          const dist = Math.sqrt((ePos.x - playerPos.x) * (ePos.x - playerPos.x) + (ePos.y - playerPos.y) * (ePos.y - playerPos.y));
          if (dist < playerCollider.radius + eCol.radius) {
            const playerHealth = getComponent<HealthComponent>(world, playerEntity, 'Health');
            const enemyDmg = getComponent(world, eId, 'Damage') as any;
            if (playerHealth) {
              playerHealth.current -= (enemyDmg?.amount || 10);
              world.events.push({ type: 'PLAYER_HIT', x: playerPos.x, y: playerPos.y });
              if (!getComponent(world, eId, 'HunterBoss')) {
                markForDestruction(eId);
              }
            }
          }
        }
      }
    }
  }

  // Execute Deferred Destructions
  for (let i = 0; i < entitiesToDestroy.length; i++) {
    const id = entitiesToDestroy[i];
    const p = getComponent<PositionComponent>(world, id, 'Position');
    if (p) removeFromGrid(grid, id, p.x, p.y);
    destroyEntity(world, id);
  }
};

/**
 * Dynamic difficulty spawner: scales enemy count, speed, HP, and variety over time.
 */
export const updateSpawnerSystem = (world: WorldState, grid: SpatialHashGridState) => {
  'worklet';

  const minutes = world.gameTime / 60;
  // Balanced spawn interval
  const spawnInterval = Math.max(0.15, 0.8 - minutes * 0.12);
  const baseSpeed = 125 + minutes * 30;
  // Reduced base HP slightly for a better balance
  const baseHP = 35 + Math.floor(minutes) * 12;
  // Balanced spawn batches
  const batchSize = Math.min(6, 2 + Math.floor(minutes * 1.0));

  const enemyCount = getEntitiesWithComponent(world, 'Enemy').length;

  // Cap at 100
  if (enemyCount < 100 && world.gameTime - world.lastSpawnTime > spawnInterval) {
    world.lastSpawnTime = world.gameTime;

    const players = getEntitiesWithComponent(world, 'Player');
    const pPos = players.length > 0 ? getComponent<PositionComponent>(world, players[0], 'Position') : null;
    if (!pPos) return;

    for (let b = 0; b < batchSize && enemyCount + b < 80; b++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 550 + Math.random() * 300;
      const ex = pPos.x + Math.cos(angle) * distance;
      const ey = pPos.y + Math.sin(angle) * distance;

      // Enemy variant: 0 = standard, 1 = fast scout, 2 = tank
      const roll = Math.random();
      let variant = 0;
      let speed = baseSpeed;
      let hp = baseHP;
      let colliderRadius = 15;
      let damage = 10;

      // Enemy variant probabilities: 55% standard, 30% fast scout, 15% tank
      if (roll < 0.55) {
        variant = 0;
      } else if (roll < 0.85) {
        variant = 1;
        speed = baseSpeed * 1.75;
        hp = Math.max(15, baseHP * 0.45);
        colliderRadius = 10;
        damage = 8;
      } else {
        variant = 2;
        speed = baseSpeed * 0.55;
        hp = baseHP * 2.5; // Slightly reduced tank HP multiplier
        colliderRadius = 22;
        damage = 20;
      }

      const eId = createEntity(world);
      addComponent(world, eId, createType('enemy'));
      addComponent(world, eId, createPosition(ex, ey));
      addComponent(world, eId, createVelocity(0, 0));
      addComponent(world, eId, createEnemy(speed, variant));
      addComponent(world, eId, createCollider(colliderRadius));
      addComponent(world, eId, { _type: 'Health', current: hp, max: hp });
      addComponent(world, eId, createDamage(damage));
      insertIntoGrid(grid, eId, ex, ey);
    }
  }

  // Hunter boss spawning every 45 seconds (scaled HP + speed)
  if (world.gameTime - world.lastBossSpawnTime > 45.0 && world.gameTime > 10) {
    world.lastBossSpawnTime = world.gameTime;

    const players = getEntitiesWithComponent(world, 'Player');
    const pPos = players.length > 0 ? getComponent<PositionComponent>(world, players[0], 'Position') : null;
    if (!pPos) return;

    const angle = Math.random() * Math.PI * 2;
    const distance = 900;
    const bx = pPos.x + Math.cos(angle) * distance;
    const by = pPos.y + Math.sin(angle) * distance;

    // Reduced boss HP scaling for better balance
    const bossHP = 1000 + Math.floor(minutes) * 300;
    const bossSpeed = 185 + minutes * 12;

    const bId = createEntity(world);
    addComponent(world, bId, createType('hunter_boss'));
    addComponent(world, bId, createPosition(bx, by));
    addComponent(world, bId, createVelocity(0, 0));
    addComponent(world, bId, { _type: 'HunterBoss', speed: bossSpeed, mineCooldown: 0 });
    addComponent(world, bId, createCollider(40));
    addComponent(world, bId, { _type: 'Health', current: bossHP, max: bossHP });
    addComponent(world, bId, createDamage(35));
    insertIntoGrid(grid, bId, bx, by);

    world.events.push({ type: 'BOSS_SPAWNED', x: bx, y: by });
  }
};

/**
 * Boss AI: Predictive tracking and dropping energy mines.
 */
export const updateBossSystem = (world: WorldState, grid: SpatialHashGridState, dt: number) => {
  'worklet';
  const players = getEntitiesWithComponent(world, 'Player');
  if (players.length === 0) return;
  const playerEntity = players[0];
  const pPos = getComponent<PositionComponent>(world, playerEntity, 'Position');
  const pVel = getComponent<VelocityComponent>(world, playerEntity, 'Velocity');
  if (!pPos) return;

  const bosses = getEntitiesWithComponent(world, 'HunterBoss');
  for (let i = 0; i < bosses.length; i++) {
    const bId = bosses[i];
    const bPos = getComponent<PositionComponent>(world, bId, 'Position');
    const bVel = getComponent<VelocityComponent>(world, bId, 'Velocity');
    const boss = getComponent<HunterBossComponent>(world, bId, 'HunterBoss');

    if (bPos && bVel && boss) {
      // Predictive tracking
      const predictionTime = 0.5;
      const targetX = pPos.x + (pVel?.vx || 0) * predictionTime;
      const targetY = pPos.y + (pVel?.vy || 0) * predictionTime;

      const dx = targetX - bPos.x;
      const dy = targetY - bPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        bVel.vx = (dx / dist) * boss.speed;
        bVel.vy = (dy / dist) * boss.speed;
      }

      // Drop energy mines
      if (boss.mineCooldown > 0) {
        boss.mineCooldown -= dt;
      } else {
        boss.mineCooldown = 2.5;

        const mineId = createEntity(world);
        addComponent(world, mineId, createType('energy_mine'));
        addComponent(world, mineId, createPosition(bPos.x, bPos.y));
        addComponent(world, mineId, createCollider(20));
        addComponent(world, mineId, createDamage(25));
        insertIntoGrid(grid, mineId, bPos.x, bPos.y);
      }
    }
  }
};
