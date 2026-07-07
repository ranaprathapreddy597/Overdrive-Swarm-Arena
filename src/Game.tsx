// ============================================
// OVERDRIVE: SWARM ARENA — Game.tsx
// Premium ECS-driven top-down arena shooter
// ============================================

import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, Text, useWindowDimensions, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useFrameCallback,
  useDerivedValue,
  withSequence,
  withTiming,
  runOnJS,
  useAnimatedStyle,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  Canvas,
  Fill,
  Skia,
  Shader,
  Picture,
  rect,
  BlurStyle,
  PaintStyle,
} from '@shopify/react-native-skia';
import {
  createWorld, createEntity, addComponent, destroyEntity,
  WorldState, SpatialHashGridState, createSpatialHashGrid,
  clearGrid, insertIntoGrid,
} from './engine/ECS';
import {
  createPosition, createVelocity, createPlayer, createCollider,
  createHealth, createType,
} from './engine/Components';
import {
  updatePlayerSystem, updateMovementSystem, updateSwarmSystem,
  updateAutoFireSystem, updateCollisionSystem, updateSpawnerSystem,
  updateBossSystem,
} from './engine/Systems';
import { Joystick } from './components/Joystick';
import { loadStats, updateStatsIfBetter } from './utils/Storage';

// ========== CONSTANTS ==========
const PLAYER_SPEED = 350;
const DASH_COOLDOWN = 3.0;
const DASH_DURATION = 0.5;
const KILLS_PER_LEVEL = 8;

// ========== DARK ARENA BACKGROUND SHADER ==========
const bgShaderSource = Skia.RuntimeEffect.Make(`
uniform float iTime;
uniform vec2 iResolution;
uniform vec2 playerPos;
uniform float playerHP;

vec4 main(vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution;

    // Deep space dark base
    vec3 col = vec3(0.015, 0.015, 0.04);

    // Primary grid
    vec2 gp = fragCoord / 55.0;
    float gx = abs(fract(gp.x) - 0.5);
    float gy = abs(fract(gp.y) - 0.5);
    float grid = smoothstep(0.46, 0.5, gx) + smoothstep(0.46, 0.5, gy);
    float pulse = 0.5 + 0.5 * sin(iTime * 0.25);
    col += vec3(0.006, 0.015, 0.028) * grid * pulse;

    // Fine sub-grid for depth
    vec2 gp2 = fragCoord / 11.0;
    float g2 = smoothstep(0.47, 0.5, abs(fract(gp2.x) - 0.5))
             + smoothstep(0.47, 0.5, abs(fract(gp2.y) - 0.5));
    col += vec3(0.002, 0.005, 0.008) * g2 * 0.3;

    // Player glow on floor
    vec2 pUV = (fragCoord - playerPos) / iResolution.y;
    float pDist = dot(pUV, pUV);
    col += vec3(0.0, 0.02, 0.035) * exp(-pDist * 3.5);

    // Low HP warning: red pulsing vignette
    if (playerHP < 35.0) {
      float warn = sin(iTime * 5.0) * 0.5 + 0.5;
      float edge = smoothstep(0.3, 1.0, length(uv * 2.0 - 1.0));
      col += vec3(0.1, 0.0, 0.0) * warn * edge * (1.0 - playerHP / 35.0);
    }

    // Vignette
    vec2 vig = uv * 2.0 - 1.0;
    col *= 1.0 - dot(vig, vig) * 0.28;

    return vec4(col, 1.0);
}
`);

// ========== WORLD INITIALIZATION ==========
const initializeWorld = (width: number, height: number): WorldState => {
  'worklet';
  const world = createWorld();

  const player = createEntity(world);
  addComponent(world, player, createType('player'));
  addComponent(world, player, createPosition(width / 2, height / 2));
  addComponent(world, player, createVelocity(0, 0));
  addComponent(world, player, createPlayer(0.18));
  addComponent(world, player, createCollider(15));
  addComponent(world, player, createHealth(100));

  return world;
};

// ========== GAME COMPONENT ==========
export default function Game() {
  const { width, height } = useWindowDimensions();
  const w = width || 400;
  const h = height || 800;

  // Time
  const time = useSharedValue(0);

  // Core ECS State
  const worldState = useSharedValue<WorldState>(initializeWorld(w, h));
  const gridState = useSharedValue<SpatialHashGridState>(createSpatialHashGrid(50));

  // Player tracking
  const playerPosX = useSharedValue(w / 2);
  const playerPosY = useSharedValue(h / 2);
  const playerHealthSV = useSharedValue(100);

  // Joystick input
  const joystickX = useSharedValue(0);
  const joystickY = useSharedValue(0);

  // Scores & Level
  const killCountSV = useSharedValue(0);
  const survivalTimeSV = useSharedValue(0);
  const currentLevel = useSharedValue(1);

  // Dash system
  const dashCooldownRemaining = useSharedValue(0);
  const dashTriggered = useSharedValue(false);

  // Visual effects
  const killFlash = useSharedValue(0);
  const levelFlash = useSharedValue(0);
  const shakeOffset = useSharedValue(0);

  // Game state
  const isGameOver = useSharedValue(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [finalKills, setFinalKills] = useState(0);
  const [finalTime, setFinalTime] = useState(0);
  const [finalLevel, setFinalLevel] = useState(1);

  // HUD display state (updated via runOnJS ~10Hz)
  const [displayKills, setDisplayKills] = useState(0);
  const [displayTime, setDisplayTime] = useState(0);
  const [displayHealth, setDisplayHealth] = useState(100);
  const [displayEnemies, setDisplayEnemies] = useState(0);
  const [displayLevel, setDisplayLevel] = useState(1);

  // Frame counter for throttled JS updates
  const frameCounter = useSharedValue(0);

  // ======== CALLBACKS ========

  const triggerHapticLight = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const triggerHapticHeavy = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }, []);

  const updateHUD = useCallback((kills: number, t: number, health: number, enemies: number, level: number) => {
    setDisplayKills(kills);
    setDisplayTime(t);
    setDisplayHealth(Math.max(0, Math.round(health)));
    setDisplayEnemies(enemies);
    setDisplayLevel(level);
  }, []);

  const onGameOverJS = useCallback((kills: number, t: number, level: number) => {
    setFinalKills(kills);
    setFinalTime(t);
    setFinalLevel(level);
    setShowGameOver(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    updateStatsIfBetter({
      bestSurvivalTime: t,
      totalEnemiesDestroyed: kills,
      highestLevel: level,
    });
  }, []);

  const onLevelUpJS = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const restartGame = useCallback(() => {
    const newWorld = initializeWorld(w, h);
    worldState.value = newWorld;
    gridState.value = createSpatialHashGrid(50);
    time.value = 0;
    playerPosX.value = w / 2;
    playerPosY.value = h / 2;
    playerHealthSV.value = 100;
    killCountSV.value = 0;
    survivalTimeSV.value = 0;
    currentLevel.value = 1;
    dashCooldownRemaining.value = 0;
    dashTriggered.value = false;
    killFlash.value = 0;
    levelFlash.value = 0;
    shakeOffset.value = 0;
    isGameOver.value = false;
    frameCounter.value = 0;
    setShowGameOver(false);
    setDisplayHealth(100);
    setDisplayKills(0);
    setDisplayTime(0);
    setDisplayEnemies(0);
    setDisplayLevel(1);
  }, [w, h]);

  const onDashPress = useCallback(() => {
    if (dashCooldownRemaining.value <= 0 && !isGameOver.value) {
      dashTriggered.value = true;
      dashCooldownRemaining.value = DASH_COOLDOWN;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, []);

  useEffect(() => {
    loadStats().then(stats => console.log('Loaded stats:', stats));
  }, []);

  // ======== GAME LOOP (UI Thread) ========

  useFrameCallback((frameInfo: any) => {
    'worklet';
    if (isGameOver.value) return;

    const deltaMs = frameInfo.timeSincePreviousFrame ?? 0;
    let dt = deltaMs / 1000.0;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) return;

    time.value += dt;
    survivalTimeSV.value += dt;

    const ws = worldState.value;
    const g = gridState.value;

    // --- Find player entity ---
    const players = ws.components['Player'] || {};
    const positions = ws.components['Position'] || {};
    const velocities = ws.components['Velocity'] || {};
    const healths = ws.components['Health'] || {};
    let playerId = -1;
    for (const idStr in players) {
      playerId = Number(idStr);
      break;
    }

    // --- Handle dash activation ---
    if (dashTriggered.value && playerId !== -1 && players[playerId]) {
      dashTriggered.value = false;
      players[playerId].isDashing = true;
      players[playerId].dashTimer = DASH_DURATION;
    }
    if (dashCooldownRemaining.value > 0) {
      dashCooldownRemaining.value -= dt;
    }

    // --- Set player velocity from joystick ---
    if (playerId !== -1 && positions[playerId] && velocities[playerId]) {
      const speedMult = players[playerId]?.isDashing ? 3.0 : 1.0;
      velocities[playerId].vx = joystickX.value * PLAYER_SPEED * speedMult;
      velocities[playerId].vy = joystickY.value * PLAYER_SPEED * speedMult;
    }

    // --- Clear and rebuild spatial hash grid ---
    clearGrid(g);
    for (let i = 0; i < ws.entities.length; i++) {
      const id = ws.entities[i];
      const p = positions[id];
      if (p) insertIntoGrid(g, id, p.x, p.y);
    }

    // --- Run ALL ECS Systems ---
    updatePlayerSystem(ws, dt);
    updateSpawnerSystem(ws, g);
    updateSwarmSystem(ws, dt);
    updateBossSystem(ws, g, dt);
    updateAutoFireSystem(ws, g, dt);
    updateMovementSystem(ws, g, dt);
    updateCollisionSystem(ws, g);

    // --- Clamp player to screen ---
    if (playerId !== -1 && positions[playerId]) {
      const pos = positions[playerId];
      pos.x = Math.max(25, Math.min(w - 25, pos.x));
      pos.y = Math.max(25, Math.min(h - 25, pos.y));
      playerPosX.value = pos.x;
      playerPosY.value = pos.y;
    }

    // --- Decay visual effects ---
    if (killFlash.value > 0) killFlash.value = Math.max(0, killFlash.value - dt * 4);
    if (levelFlash.value > 0) levelFlash.value = Math.max(0, levelFlash.value - dt * 2.5);

    // --- Process Events ---
    for (let i = 0; i < ws.events.length; i++) {
      const evt = ws.events[i];
      if (evt.type === 'EXPLOSION') {
        const expId = createEntity(ws);
        addComponent(ws, expId, { _type: 'Position', x: evt.x, y: evt.y });
        addComponent(ws, expId, { _type: 'Explosion', timer: 0.45, maxTimer: 0.45 });
        killFlash.value = 0.12;
      } else if (evt.type === 'XP_DROP') {
        killCountSV.value += 1;
        const xpId = createEntity(ws);
        addComponent(ws, xpId, { _type: 'Position', x: evt.x, y: evt.y });
        addComponent(ws, xpId, { _type: 'XPCore', timer: 5.0 });
      } else if (evt.type === 'PLAYER_HIT') {
        shakeOffset.value = withSequence(
          withTiming(10, { duration: 25 }),
          withTiming(-10, { duration: 25 }),
          withTiming(6, { duration: 20 }),
          withTiming(-6, { duration: 20 }),
          withTiming(0, { duration: 15 })
        );
        runOnJS(triggerHapticHeavy)();
      }
    }
    ws.events = [];

    // --- Level Up System ---
    const newLevel = Math.floor(killCountSV.value / KILLS_PER_LEVEL) + 1;
    if (newLevel > currentLevel.value && playerId !== -1 && players[playerId]) {
      currentLevel.value = newLevel;
      // Upgrade weapons
      players[playerId].fireRate = Math.max(0.06, 0.18 - (newLevel - 1) * 0.012);
      players[playerId].damage = 20 + (newLevel - 1) * 5;
      levelFlash.value = 0.25;
      runOnJS(onLevelUpJS)();
    }

    // --- XP Core decay + collection + health regen ---
    const xpCores = ws.components['XPCore'] || {};
    const xpIds = Object.keys(xpCores);
    for (let i = 0; i < xpIds.length; i++) {
      const id = Number(xpIds[i]);
      const core = xpCores[id];
      if (core) {
        core.timer -= dt;
        if (core.timer <= 0) {
          destroyEntity(ws, id);
        } else if (playerId !== -1 && positions[playerId] && positions[id]) {
          const dx = positions[playerId].x - positions[id].x;
          const dy = positions[playerId].y - positions[id].y;
          if (dx * dx + dy * dy < 45 * 45) {
            destroyEntity(ws, id);
            // Health regen on pickup
            if (healths[playerId]) {
              healths[playerId].current = Math.min(
                healths[playerId].max || 100,
                healths[playerId].current + 3
              );
            }
            runOnJS(triggerHapticLight)();
          }
        }
      }
    }

    // --- Explosion decay ---
    const explosions = ws.components['Explosion'] || {};
    const expIds = Object.keys(explosions);
    for (let i = 0; i < expIds.length; i++) {
      const id = Number(expIds[i]);
      const exp = explosions[id];
      if (exp) {
        exp.timer -= dt;
        if (exp.timer <= 0) destroyEntity(ws, id);
      }
    }

    // --- Check player health ---
    if (playerId !== -1 && healths[playerId]) {
      const hp = healths[playerId].current;
      playerHealthSV.value = hp;
      if (hp <= 0) {
        isGameOver.value = true;
        runOnJS(onGameOverJS)(killCountSV.value, survivalTimeSV.value, currentLevel.value);
      }
    }

    // --- Throttled HUD update ---
    frameCounter.value += 1;
    if (frameCounter.value % 6 === 0) {
      const enemyCount = Object.keys(ws.components['Enemy'] || {}).length;
      runOnJS(updateHUD)(
        killCountSV.value,
        survivalTimeSV.value,
        playerHealthSV.value,
        enemyCount,
        currentLevel.value
      );
    }

    // Trigger reactivity
    worldState.value = { ...ws };
  });

  // ======== SHADER UNIFORMS ========

  const bgUniforms = useDerivedValue(() => ({
    iTime: time.value,
    iResolution: [w, h],
    playerPos: [playerPosX.value, playerPosY.value],
    playerHP: playerHealthSV.value,
  }));

  // ======== ENTITY RENDERING ========

  const entitiesPicture = useDerivedValue(() => {
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(rect(0, 0, w, h));
    const ws = worldState.value;
    const t = time.value;

    // === PAINT CACHE ===
    const playerPaint = Skia.Paint();
    playerPaint.setColor(Skia.Color('#00FFEE'));
    playerPaint.setAntiAlias(true);
    const playerGlowPaint = Skia.Paint();
    playerGlowPaint.setColor(Skia.Color('rgba(0, 255, 238, 0.3)'));
    playerGlowPaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 18, true));
    const playerCorePaint = Skia.Paint();
    playerCorePaint.setColor(Skia.Color('#FFFFFF'));
    playerCorePaint.setAntiAlias(true);

    const exhaustPaint = Skia.Paint();
    exhaustPaint.setColor(Skia.Color('rgba(255, 140, 40, 0.8)'));
    exhaustPaint.setAntiAlias(true);
    const exhaustGlowPaint = Skia.Paint();
    exhaustGlowPaint.setColor(Skia.Color('rgba(255, 80, 10, 0.35)'));
    exhaustGlowPaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 9, true));

    const trailPaint = Skia.Paint();
    trailPaint.setColor(Skia.Color('#00FFEE'));
    trailPaint.setAntiAlias(true);

    // Standard enemy
    const enemyPaint0 = Skia.Paint();
    enemyPaint0.setColor(Skia.Color('#FF00AA'));
    enemyPaint0.setAntiAlias(true);
    const enemyGlow0 = Skia.Paint();
    enemyGlow0.setColor(Skia.Color('rgba(255, 0, 170, 0.3)'));
    enemyGlow0.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 12, true));

    // Fast scout
    const enemyPaint1 = Skia.Paint();
    enemyPaint1.setColor(Skia.Color('#FFDD00'));
    enemyPaint1.setAntiAlias(true);
    const enemyGlow1 = Skia.Paint();
    enemyGlow1.setColor(Skia.Color('rgba(255, 220, 0, 0.3)'));
    enemyGlow1.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 8, true));

    // Tank
    const enemyPaint2 = Skia.Paint();
    enemyPaint2.setColor(Skia.Color('#AA44FF'));
    enemyPaint2.setAntiAlias(true);
    const enemyGlow2 = Skia.Paint();
    enemyGlow2.setColor(Skia.Color('rgba(170, 68, 255, 0.35)'));
    enemyGlow2.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 16, true));

    const enemyRingPaint = Skia.Paint();
    enemyRingPaint.setStyle(PaintStyle.Stroke);
    enemyRingPaint.setStrokeWidth(1.5);
    enemyRingPaint.setAntiAlias(true);

    // Boss
    const bossPaint = Skia.Paint();
    bossPaint.setColor(Skia.Color('#FF2222'));
    bossPaint.setAntiAlias(true);
    const bossGlowPaint = Skia.Paint();
    bossGlowPaint.setColor(Skia.Color('rgba(255, 30, 30, 0.4)'));
    bossGlowPaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 25, true));
    const bossRingPaint = Skia.Paint();
    bossRingPaint.setColor(Skia.Color('rgba(255, 100, 100, 0.5)'));
    bossRingPaint.setStyle(PaintStyle.Stroke);
    bossRingPaint.setStrokeWidth(2);
    bossRingPaint.setAntiAlias(true);
    const bossInnerPaint = Skia.Paint();
    bossInnerPaint.setColor(Skia.Color('#FF6644'));
    bossInnerPaint.setAntiAlias(true);

    // Projectile
    const projPaint = Skia.Paint();
    projPaint.setColor(Skia.Color('#FFFF44'));
    projPaint.setAntiAlias(true);
    const projGlowPaint = Skia.Paint();
    projGlowPaint.setColor(Skia.Color('rgba(255, 255, 68, 0.6)'));
    projGlowPaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 6, true));

    // Mine
    const minePaint = Skia.Paint();
    minePaint.setColor(Skia.Color('#00AAFF'));
    minePaint.setAntiAlias(true);
    const mineGlowPaint = Skia.Paint();
    mineGlowPaint.setColor(Skia.Color('rgba(0, 170, 255, 0.4)'));
    mineGlowPaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 14, true));
    const mineRingPaint = Skia.Paint();
    mineRingPaint.setColor(Skia.Color('rgba(0, 170, 255, 0.5)'));
    mineRingPaint.setStyle(PaintStyle.Stroke);
    mineRingPaint.setStrokeWidth(1.5);
    mineRingPaint.setAntiAlias(true);

    // XP
    const xpPaint = Skia.Paint();
    xpPaint.setColor(Skia.Color('#00FF66'));
    xpPaint.setAntiAlias(true);
    const xpGlowPaint = Skia.Paint();
    xpGlowPaint.setColor(Skia.Color('rgba(0, 255, 100, 0.5)'));
    xpGlowPaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 10, true));

    // Explosion
    const expPaint = Skia.Paint();
    expPaint.setColor(Skia.Color('#FFAA00'));
    expPaint.setAntiAlias(true);
    const expFlashPaint = Skia.Paint();
    expFlashPaint.setColor(Skia.Color('rgba(255, 255, 200, 0.6)'));
    expFlashPaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 10, true));

    const shieldPaint = Skia.Paint();
    shieldPaint.setColor(Skia.Color('rgba(0, 255, 255, 0.2)'));
    shieldPaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 12, true));

    const hpBarBg = Skia.Paint();
    hpBarBg.setColor(Skia.Color('rgba(0, 0, 0, 0.6)'));
    const hpBarFill = Skia.Paint();

    // === FLOATING BACKGROUND PARTICLES ===
    const particlePaint = Skia.Paint();
    particlePaint.setAntiAlias(true);
    for (let i = 0; i < 35; i++) {
      const seed1 = ((i * 137.508 + 23.1) % 997) / 997;
      const seed2 = ((i * 97.31 + 42.7) % 991) / 991;
      const drift = (i % 2 === 0) ? 1 : -1;
      const spd = 3 + (i % 5) * 1.5;
      const px = ((seed1 * w + t * spd * drift + w) % (w + 10)) - 5;
      const py = ((seed2 * h + t * spd * 0.7) % (h + 10)) - 5;
      const sz = 0.6 + (i % 4) * 0.35;
      const alpha = 0.04 + (i % 6) * 0.012;

      if (i % 3 === 0) particlePaint.setColor(Skia.Color('#004466'));
      else if (i % 3 === 1) particlePaint.setColor(Skia.Color('#222255'));
      else particlePaint.setColor(Skia.Color('#333344'));
      particlePaint.setAlphaf(alpha);
      canvas.drawCircle(px, py, sz, particlePaint);
    }

    // === ACCESS ECS DATA ===
    const positions = ws.components['Position'] || {};
    const playerMap = ws.components['Player'] || {};
    const enemies = ws.components['Enemy'] || {};
    const hunters = ws.components['HunterBoss'] || {};
    const projectiles = ws.components['Projectile'] || {};
    const typeMap = ws.components['Type'] || {};
    const xpCores = ws.components['XPCore'] || {};
    const explosionsMap = ws.components['Explosion'] || {};
    const healthsMap = ws.components['Health'] || {};
    const vels = ws.components['Velocity'] || {};

    // === RENDER ENTITIES ===
    for (let i = 0; i < ws.entities.length; i++) {
      const id = ws.entities[i];
      const pos = positions[id];
      if (!pos) continue;
      if (pos.x < -80 || pos.x > w + 80 || pos.y < -80 || pos.y > h + 80) continue;

      // ---- PLAYER ----
      if (playerMap[id]) {
        const vel = vels[id];
        let angle = -Math.PI / 2;
        if (vel && (Math.abs(vel.vx) > 5 || Math.abs(vel.vy) > 5)) {
          angle = Math.atan2(vel.vy, vel.vx);
        }

        // Movement trail
        if (vel) {
          const speed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
          if (speed > 40) {
            const normX = vel.vx / speed;
            const normY = vel.vy / speed;
            for (let ti = 1; ti <= 5; ti++) {
              const tx = pos.x - normX * ti * 9;
              const ty = pos.y - normY * ti * 9;
              trailPaint.setAlphaf(0.18 * (1 - ti / 6));
              canvas.drawCircle(tx, ty, 5 - ti * 0.6, trailPaint);
            }
          }
        }

        // Dash shield
        if (playerMap[id].isDashing) {
          canvas.drawCircle(pos.x, pos.y, 34, shieldPaint);
          // Extra shield ring
          const shieldRing = Skia.Paint();
          shieldRing.setColor(Skia.Color('rgba(0, 255, 255, 0.35)'));
          shieldRing.setStyle(PaintStyle.Stroke);
          shieldRing.setStrokeWidth(2);
          shieldRing.setAntiAlias(true);
          canvas.drawCircle(pos.x, pos.y, 34, shieldRing);
        }

        // Engine exhaust
        const flicker = 12 + Math.sin(t * 25) * 5;
        const exX = pos.x - Math.cos(angle) * (16 + flicker);
        const exY = pos.y - Math.sin(angle) * (16 + flicker);
        canvas.drawCircle(exX, exY, 6, exhaustGlowPaint);
        canvas.drawCircle(exX, exY, 3, exhaustPaint);

        // Ship body
        canvas.save();
        canvas.translate(pos.x, pos.y);
        canvas.rotate(angle * (180 / Math.PI) + 90, 0, 0);

        const glowPath = Skia.Path.Make();
        glowPath.moveTo(0, -22);
        glowPath.lineTo(-15, 15);
        glowPath.lineTo(0, 9);
        glowPath.lineTo(15, 15);
        glowPath.close();
        canvas.drawPath(glowPath, playerGlowPaint);

        const shipPath = Skia.Path.Make();
        shipPath.moveTo(0, -18);
        shipPath.lineTo(-12, 12);
        shipPath.lineTo(-3, 7);
        shipPath.lineTo(0, 9);
        shipPath.lineTo(3, 7);
        shipPath.lineTo(12, 12);
        shipPath.close();
        canvas.drawPath(shipPath, playerPaint);

        canvas.drawCircle(0, -3, 3, playerCorePaint);
        canvas.restore();

        // Dash cooldown arc
        if (dashCooldownRemaining.value > 0) {
          const cdPaint = Skia.Paint();
          cdPaint.setColor(Skia.Color('rgba(0, 255, 255, 0.25)'));
          cdPaint.setStyle(PaintStyle.Stroke);
          cdPaint.setStrokeWidth(2);
          cdPaint.setAntiAlias(true);
          const progress = dashCooldownRemaining.value / DASH_COOLDOWN;
          canvas.drawArc(rect(pos.x - 28, pos.y - 28, 56, 56), -90, 360 * (1 - progress), false, cdPaint);
        }
      }

      // ---- ENEMIES ----
      else if (enemies[id]) {
        const variant = enemies[id].variant || 0;
        const pulse = 0.85 + 0.15 * Math.sin(t * 6 + id * 1.7);

        if (variant === 0) {
          // Standard: magenta diamond
          canvas.drawCircle(pos.x, pos.y, 18, enemyGlow0);
          enemyRingPaint.setColor(Skia.Color('rgba(255, 0, 170, 0.4)'));
          enemyRingPaint.setAlphaf(0.3 + pulse * 0.3);
          canvas.drawCircle(pos.x, pos.y, 13 + pulse * 3, enemyRingPaint);
          const dp = Skia.Path.Make();
          const sz = 10 * pulse;
          dp.moveTo(pos.x, pos.y - sz * 1.3);
          dp.lineTo(pos.x + sz, pos.y);
          dp.lineTo(pos.x, pos.y + sz * 1.3);
          dp.lineTo(pos.x - sz, pos.y);
          dp.close();
          canvas.drawPath(dp, enemyPaint0);
        } else if (variant === 1) {
          // Fast scout: yellow small triangle
          canvas.drawCircle(pos.x, pos.y, 12, enemyGlow1);
          const vel = vels[id];
          let eAngle = 0;
          if (vel && (Math.abs(vel.vx) > 1 || Math.abs(vel.vy) > 1)) {
            eAngle = Math.atan2(vel.vy, vel.vx);
          }
          canvas.save();
          canvas.translate(pos.x, pos.y);
          canvas.rotate(eAngle * (180 / Math.PI) + 90, 0, 0);
          const sp = Skia.Path.Make();
          sp.moveTo(0, -9);
          sp.lineTo(-6, 7);
          sp.lineTo(6, 7);
          sp.close();
          canvas.drawPath(sp, enemyPaint1);
          canvas.restore();
        } else {
          // Tank: purple hexagon
          canvas.drawCircle(pos.x, pos.y, 28, enemyGlow2);
          const hp = Skia.Path.Make();
          for (let a = 0; a < 6; a++) {
            const hAngle = (a * Math.PI * 2 / 6) - Math.PI / 2;
            const hx = Math.cos(hAngle) * 18;
            const hy = Math.sin(hAngle) * 18;
            if (a === 0) hp.moveTo(pos.x + hx, pos.y + hy);
            else hp.lineTo(pos.x + hx, pos.y + hy);
          }
          hp.close();
          canvas.drawPath(hp, enemyPaint2);

          // Tank health bar
          const th = healthsMap[id];
          if (th) {
            const barW = 30;
            const barH = 3;
            const bx = pos.x - barW / 2;
            const by = pos.y - 26;
            canvas.drawRect(rect(bx, by, barW, barH), hpBarBg);
            const fill = Math.max(0, th.current / (th.max || 1));
            hpBarFill.setColor(Skia.Color('#AA44FF'));
            canvas.drawRect(rect(bx, by, barW * fill, barH), hpBarFill);
          }
        }
      }

      // ---- HUNTER BOSS ----
      else if (hunters[id]) {
        const bossRot = t * 40;
        canvas.drawCircle(pos.x, pos.y, 55, bossGlowPaint);

        canvas.save();
        canvas.translate(pos.x, pos.y);
        canvas.rotate(bossRot, 0, 0);
        canvas.drawCircle(0, 0, 38, bossRingPaint);
        canvas.restore();

        const hexPath = Skia.Path.Make();
        for (let a = 0; a < 6; a++) {
          const hAngle = (a * Math.PI * 2 / 6) - Math.PI / 2;
          const hx = pos.x + Math.cos(hAngle) * 30;
          const hy = pos.y + Math.sin(hAngle) * 30;
          if (a === 0) hexPath.moveTo(hx, hy);
          else hexPath.lineTo(hx, hy);
        }
        hexPath.close();
        canvas.drawPath(hexPath, bossPaint);

        // Rotating inner
        const innerPath = Skia.Path.Make();
        for (let a = 0; a < 6; a++) {
          const hAngle = (a * Math.PI * 2 / 6) - Math.PI / 2 + t * 0.6;
          const hx = pos.x + Math.cos(hAngle) * 15;
          const hy = pos.y + Math.sin(hAngle) * 15;
          if (a === 0) innerPath.moveTo(hx, hy);
          else innerPath.lineTo(hx, hy);
        }
        innerPath.close();
        canvas.drawPath(innerPath, bossInnerPaint);

        // Boss HP bar
        const bossHP = healthsMap[id];
        if (bossHP) {
          const barW = 60;
          const barH = 6;
          const bx = pos.x - barW / 2;
          const by = pos.y - 48;
          canvas.drawRect(rect(bx, by, barW, barH), hpBarBg);
          const fill = Math.max(0, bossHP.current / (bossHP.max || 1000));
          hpBarFill.setColor(fill > 0.5 ? Skia.Color('#44FF44') : fill > 0.25 ? Skia.Color('#FFAA00') : Skia.Color('#FF4444'));
          canvas.drawRect(rect(bx, by, barW * fill, barH), hpBarFill);
        }
      }

      // ---- PROJECTILES ----
      else if (projectiles[id]) {
        canvas.drawCircle(pos.x, pos.y, 8, projGlowPaint);
        canvas.drawCircle(pos.x, pos.y, 3, projPaint);
      }

      // ---- ENERGY MINES ----
      else if (typeMap[id]?.type === 'energy_mine') {
        const mPulse = (Math.sin(t * 8 + id * 2) + 1) / 2;
        mineRingPaint.setAlphaf(0.3 + mPulse * 0.5);
        canvas.drawCircle(pos.x, pos.y, 18 + mPulse * 6, mineRingPaint);
        mineGlowPaint.setAlphaf(0.3 + mPulse * 0.3);
        canvas.drawCircle(pos.x, pos.y, 14, mineGlowPaint);

        const octPath = Skia.Path.Make();
        for (let a = 0; a < 8; a++) {
          const oAngle = a * Math.PI * 2 / 8;
          const ox = pos.x + Math.cos(oAngle) * (8 + mPulse * 2);
          const oy = pos.y + Math.sin(oAngle) * (8 + mPulse * 2);
          if (a === 0) octPath.moveTo(ox, oy);
          else octPath.lineTo(ox, oy);
        }
        octPath.close();
        canvas.drawPath(octPath, minePaint);
      }

      // ---- XP CORES ----
      else if (xpCores[id]) {
        const core = xpCores[id];
        const lifeRatio = Math.max(0, core.timer / 5.0);
        const spin = t * 3 + id;

        xpPaint.setAlphaf(lifeRatio);
        xpGlowPaint.setAlphaf(lifeRatio * 0.5);
        canvas.drawCircle(pos.x, pos.y, 13 * lifeRatio, xpGlowPaint);

        canvas.save();
        canvas.translate(pos.x, pos.y);
        canvas.rotate(spin * (180 / Math.PI), 0, 0);
        const sqSz = 5 * lifeRatio;
        canvas.drawRect(rect(-sqSz, -sqSz, sqSz * 2, sqSz * 2), xpPaint);
        canvas.restore();
      }

      // ---- EXPLOSIONS ----
      else if (explosionsMap[id]) {
        const exp = explosionsMap[id];
        const progress = 1 - (exp.timer / exp.maxTimer);
        const alpha = Math.max(0, 1 - progress * progress);

        if (alpha > 0.02) {
          expPaint.setAlphaf(alpha);
          const radius = progress * 55;

          canvas.drawCircle(pos.x, pos.y, radius * 0.35, expFlashPaint);

          const ringP = Skia.Paint();
          ringP.setColor(Skia.Color('#FFAA00'));
          ringP.setStyle(PaintStyle.Stroke);
          ringP.setStrokeWidth(3.5 * (1 - progress));
          ringP.setAlphaf(alpha);
          ringP.setAntiAlias(true);
          canvas.drawCircle(pos.x, pos.y, radius, ringP);

          // Second ring
          const ring2 = Skia.Paint();
          ring2.setColor(Skia.Color('#FF4400'));
          ring2.setStyle(PaintStyle.Stroke);
          ring2.setStrokeWidth(2 * (1 - progress));
          ring2.setAlphaf(alpha * 0.6);
          ring2.setAntiAlias(true);
          canvas.drawCircle(pos.x, pos.y, radius * 0.65, ring2);

          // Debris particles
          for (let a = 0; a < 10; a++) {
            const pAngle = (a * Math.PI * 2 / 10) + progress * 0.8;
            const px = pos.x + Math.cos(pAngle) * radius * 1.15;
            const py = pos.y + Math.sin(pAngle) * radius * 1.15;
            canvas.drawCircle(px, py, 2.5 * (1 - progress), expPaint);
          }
        }
      }
    }

    // === SCREEN FLASH EFFECTS ===
    if (killFlash.value > 0.01) {
      const flashP = Skia.Paint();
      flashP.setColor(Skia.Color('#FFFFFF'));
      flashP.setAlphaf(killFlash.value);
      canvas.drawRect(rect(0, 0, w, h), flashP);
    }
    if (levelFlash.value > 0.01) {
      const lvlP = Skia.Paint();
      lvlP.setColor(Skia.Color('#00FFEE'));
      lvlP.setAlphaf(levelFlash.value);
      canvas.drawRect(rect(0, 0, w, h), lvlP);
    }

    return recorder.finishRecordingAsPicture();
  });

  // ======== ANIMATED STYLES ========

  const shakeStyle = useAnimatedStyle(() => ({
    flex: 1,
    transform: [
      { translateX: shakeOffset.value },
      { translateY: shakeOffset.value * 0.5 },
    ],
  }));

  const healthBarStyle = useAnimatedStyle(() => {
    const pct = Math.max(0, playerHealthSV.value / 100);
    return {
      width: `${pct * 100}%` as any,
      backgroundColor: pct > 0.5 ? '#00FF88' : pct > 0.25 ? '#FFAA00' : '#FF3333',
    };
  });

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // ======== RENDER ========

  return (
    <View style={styles.container}>
      {/* ===== GAME CANVAS ===== */}
      <Animated.View style={shakeStyle}>
        <Canvas style={StyleSheet.absoluteFill}>
          {bgShaderSource && (
            <Fill>
              <Shader source={bgShaderSource} uniforms={bgUniforms} />
            </Fill>
          )}
          <Picture picture={entitiesPicture} />
        </Canvas>
      </Animated.View>

      {/* ===== HUD ===== */}
      <View style={styles.hudTop} pointerEvents="none">
        <View style={styles.healthSection}>
          <Text style={styles.healthIcon}>♥</Text>
          <View style={styles.healthBarOuter}>
            <Animated.View style={[styles.healthBarFill, healthBarStyle]} />
          </View>
          <Text style={styles.healthText}>{displayHealth}</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statBox, styles.levelBox]}>
            <Text style={styles.statLabel}>LVL</Text>
            <Text style={[styles.statValue, styles.levelValue]}>{displayLevel}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>KILLS</Text>
            <Text style={styles.statValue}>{displayKills}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>TIME</Text>
            <Text style={styles.statValue}>{formatTime(displayTime)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>SWARM</Text>
            <Text style={styles.statValue}>{displayEnemies}</Text>
          </View>
        </View>
      </View>

      {/* ===== VIRTUAL JOYSTICK ===== */}
      <Joystick
        joystickX={joystickX}
        joystickY={joystickY}
        size={140}
        knobSize={56}
        bottom={30}
        left={30}
      />

      {/* ===== DASH BUTTON ===== */}
      <TouchableOpacity
        style={styles.dashButton}
        activeOpacity={0.6}
        onPress={onDashPress}
      >
        <Text style={styles.dashIcon}>⚡</Text>
        <Text style={styles.dashLabel}>DASH</Text>
      </TouchableOpacity>

      {/* ===== GAME OVER ===== */}
      {showGameOver && (
        <View style={styles.gameOverOverlay}>
          <View style={styles.gameOverCard}>
            <Text style={styles.gameOverTitle}>SYSTEM FAILURE</Text>
            <View style={styles.gameOverDivider} />
            <View style={styles.gameOverStats}>
              <View style={styles.goStatRow}>
                <Text style={styles.goStatLabel}>SURVIVED</Text>
                <Text style={styles.goStatValue}>{formatTime(finalTime)}</Text>
              </View>
              <View style={styles.goStatRow}>
                <Text style={styles.goStatLabel}>DESTROYED</Text>
                <Text style={styles.goStatValue}>{finalKills}</Text>
              </View>
              <View style={styles.goStatRow}>
                <Text style={styles.goStatLabel}>LEVEL REACHED</Text>
                <Text style={[styles.goStatValue, { color: '#00FFEE' }]}>{finalLevel}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.restartButton} onPress={restartGame}>
              <Text style={styles.restartText}>▶  REBOOT SYSTEM</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ========== STYLES ==========

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  hudTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  healthSection: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  healthIcon: {
    color: '#FF3333', fontSize: 18, marginRight: 8,
    textShadowColor: '#FF3333',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  healthBarOuter: {
    flex: 1, height: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 5, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  healthBarFill: { height: '100%', borderRadius: 5 },
  healthText: {
    color: '#FFF', fontSize: 13, fontWeight: '800',
    marginLeft: 8, minWidth: 30, textAlign: 'right',
  },
  statsRow: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  statBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  levelBox: {
    borderColor: 'rgba(0, 255, 238, 0.25)',
    backgroundColor: 'rgba(0, 30, 30, 0.4)',
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.35)',
    fontSize: 9, fontWeight: '700', letterSpacing: 2,
  },
  statValue: { color: '#FFF', fontSize: 16, fontWeight: '900' },
  levelValue: { color: '#00FFEE' },

  dashButton: {
    position: 'absolute', bottom: 35, right: 30,
    width: 74, height: 74, borderRadius: 37,
    backgroundColor: 'rgba(0, 20, 30, 0.6)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(0, 255, 255, 0.45)',
    shadowColor: '#00FFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4, shadowRadius: 12,
    elevation: 5,
  },
  dashIcon: { fontSize: 22, marginBottom: -2 },
  dashLabel: {
    color: '#00FFEE', fontSize: 10, fontWeight: '900', letterSpacing: 2,
  },

  gameOverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 1000,
  },
  gameOverCard: {
    backgroundColor: 'rgba(8, 8, 18, 0.95)',
    borderWidth: 1, borderColor: 'rgba(255, 50, 50, 0.35)',
    borderRadius: 16, padding: 32, alignItems: 'center',
    minWidth: 280,
    shadowColor: '#FF0000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3, shadowRadius: 30,
    elevation: 10,
  },
  gameOverTitle: {
    color: '#FF3333', fontSize: 28, fontWeight: '900',
    letterSpacing: 4,
    textShadowColor: '#FF0000',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  gameOverDivider: {
    width: '80%', height: 1,
    backgroundColor: 'rgba(255, 50, 50, 0.25)',
    marginVertical: 20,
  },
  gameOverStats: { width: '100%', marginBottom: 24 },
  goStatRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  goStatLabel: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 12, fontWeight: '700', letterSpacing: 1,
  },
  goStatValue: { color: '#FFF', fontSize: 18, fontWeight: '900' },
  restartButton: {
    backgroundColor: 'rgba(0, 255, 200, 0.12)',
    borderWidth: 1, borderColor: 'rgba(0, 255, 200, 0.45)',
    borderRadius: 8, paddingHorizontal: 28, paddingVertical: 14,
  },
  restartText: { color: '#00FFC8', fontSize: 16, fontWeight: '900', letterSpacing: 2 },
});
