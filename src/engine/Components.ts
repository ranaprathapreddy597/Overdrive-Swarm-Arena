// src/engine/Components.ts

import { Component } from './ECS';

export interface PositionComponent extends Component { _type: 'Position'; x: number; y: number; }
export const createPosition = (x: number, y: number): PositionComponent => {
  'worklet';
  return { _type: 'Position', x, y };
};

export interface VelocityComponent extends Component { _type: 'Velocity'; vx: number; vy: number; }
export const createVelocity = (vx: number, vy: number): VelocityComponent => {
  'worklet';
  return { _type: 'Velocity', vx, vy };
};

export type EntityType = 'player' | 'enemy' | 'hunter_boss' | 'projectile' | 'energy_mine';
export interface TypeComponent extends Component { _type: 'Type'; type: EntityType; }
export const createType = (type: EntityType): TypeComponent => {
  'worklet';
  return { _type: 'Type', type };
};

export interface HealthComponent extends Component { _type: 'Health'; current: number; max: number; }
export const createHealth = (max: number): HealthComponent => {
  'worklet';
  return { _type: 'Health', current: max, max };
};

export interface DamageComponent extends Component { _type: 'Damage'; amount: number; }
export const createDamage = (amount: number): DamageComponent => {
  'worklet';
  return { _type: 'Damage', amount };
};

export interface PlayerComponent extends Component {
  _type: 'Player';
  weaponCooldown: number;
  fireRate: number;
  isDashing: boolean;
  dashTimer: number;
  damage: number;
}
export const createPlayer = (fireRate: number): PlayerComponent => {
  'worklet';
  return { _type: 'Player', weaponCooldown: 0, fireRate, isDashing: false, dashTimer: 0, damage: 20 };
};

// variant: 0 = standard, 1 = fast scout, 2 = tank
export interface EnemyComponent extends Component { _type: 'Enemy'; speed: number; variant: number; }
export const createEnemy = (speed: number, variant: number = 0): EnemyComponent => {
  'worklet';
  return { _type: 'Enemy', speed, variant };
};

export interface HunterBossComponent extends Component { _type: 'HunterBoss'; speed: number; mineCooldown: number; }
export const createHunterBoss = (speed: number): HunterBossComponent => {
  'worklet';
  return { _type: 'HunterBoss', speed, mineCooldown: 0 };
};

export interface ProjectileComponent extends Component { _type: 'Projectile'; speed: number; range: number; distanceTraveled: number; }
export const createProjectile = (speed: number, range: number): ProjectileComponent => {
  'worklet';
  return { _type: 'Projectile', speed, range, distanceTraveled: 0 };
};

export interface ColliderComponent extends Component { _type: 'Collider'; radius: number; }
export const createCollider = (radius: number): ColliderComponent => {
  'worklet';
  return { _type: 'Collider', radius };
};
