// src/engine/ECS.ts

/**
 * Entity Component System (ECS) Core
 * 
 * Designed to be highly optimized and strictly serializable.
 * State is represented via plain objects and arrays to maintain compatibility 
 * with React Native Reanimated SharedValues (Worklets).
 */

export type EntityId = number;

export interface Component {
  _type: string;
  [key: string]: any;
}

export interface WorldState {
  nextEntityId: number;
  entities: EntityId[];
  // componentType -> { entityId: Component }
  components: Record<string, Record<EntityId, Component>>;
  events: any[];
  gameTime: number;
  lastSpawnTime: number;
  lastBossSpawnTime: number;
}

/**
 * Creates a new, empty world state.
 */
export const createWorld = (): WorldState => ({
  nextEntityId: 1,
  entities: [],
  components: {},
  events: [],
  gameTime: 0,
  lastSpawnTime: 0,
  lastBossSpawnTime: 0,
});

/**
 * Creates a new entity in the given world state.
 */
export const createEntity = (world: WorldState): EntityId => {
  'worklet';
  const id = world.nextEntityId++;
  world.entities.push(id);
  return id;
};

/**
 * Destroys an entity and removes all its components.
 */
export const destroyEntity = (world: WorldState, id: EntityId) => {
  'worklet';
  const index = world.entities.indexOf(id);
  if (index !== -1) {
    world.entities.splice(index, 1);
  }
  for (const type in world.components) {
    delete world.components[type][id];
  }
};

/**
 * Adds a component to an entity.
 */
export const addComponent = <T extends Component>(world: WorldState, entity: EntityId, component: T) => {
  'worklet';
  if (!world.components[component._type]) {
    world.components[component._type] = {};
  }
  world.components[component._type][entity] = component;
};

/**
 * Removes a component from an entity.
 */
export const removeComponent = (world: WorldState, entity: EntityId, componentType: string) => {
  'worklet';
  if (world.components[componentType]) {
    delete world.components[componentType][entity];
  }
};

/**
 * Retrieves a component for a specific entity.
 */
export const getComponent = <T extends Component>(world: WorldState, entity: EntityId, componentType: string): T | undefined => {
  'worklet';
  return world.components[componentType]?.[entity] as T | undefined;
};

/**
 * Retrieves all entities that have a specific component type.
 */
export const getEntitiesWithComponent = (world: WorldState, componentType: string): EntityId[] => {
  'worklet';
  const comps = world.components[componentType];
  if (!comps) return [];
  return Object.keys(comps).map(Number);
};

// ==========================================
// Spatial Hashing for O(1) / O(N) Collisions
// ==========================================

export interface SpatialHashGridState {
  cellSize: number;
  // "x,y" -> EntityId[]
  cells: Record<string, EntityId[]>;
}

export const createSpatialHashGrid = (cellSize: number): SpatialHashGridState => ({
  cellSize,
  cells: {},
});

const getCellKey = (cellSize: number, x: number, y: number): string => {
  'worklet';
  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);
  return `${cx},${cy}`;
};

/**
 * Inserts an entity into the spatial hash grid.
 */
export const insertIntoGrid = (grid: SpatialHashGridState, entity: EntityId, x: number, y: number) => {
  'worklet';
  const key = getCellKey(grid.cellSize, x, y);
  if (!grid.cells[key]) {
    grid.cells[key] = [];
  }
  if (!grid.cells[key].includes(entity)) {
    grid.cells[key].push(entity);
  }
};

/**
 * Removes an entity from a specific position in the grid.
 */
export const removeFromGrid = (grid: SpatialHashGridState, entity: EntityId, x: number, y: number) => {
  'worklet';
  const key = getCellKey(grid.cellSize, x, y);
  const cell = grid.cells[key];
  if (cell) {
    const index = cell.indexOf(entity);
    if (index !== -1) {
      cell.splice(index, 1);
    }
    if (cell.length === 0) {
      delete grid.cells[key];
    }
  }
};

/**
 * Clears the entire grid. Useful to call at the start of each frame before re-populating.
 */
export const clearGrid = (grid: SpatialHashGridState) => {
  'worklet';
  grid.cells = {};
};

/**
 * Queries the grid for all entities within a given bounding box (defined by radius around x,y).
 */
export const queryGrid = (grid: SpatialHashGridState, x: number, y: number, radius: number): EntityId[] => {
  'worklet';
  const minX = Math.floor((x - radius) / grid.cellSize);
  const maxX = Math.floor((x + radius) / grid.cellSize);
  const minY = Math.floor((y - radius) / grid.cellSize);
  const maxY = Math.floor((y + radius) / grid.cellSize);

  const result: EntityId[] = [];
  const resultSet: Record<number, boolean> = {};

  for (let cx = minX; cx <= maxX; cx++) {
    for (let cy = minY; cy <= maxY; cy++) {
      const key = `${cx},${cy}`;
      const cell = grid.cells[key];
      if (cell) {
        for (let i = 0; i < cell.length; i++) {
          const entity = cell[i];
          if (!resultSet[entity]) {
            resultSet[entity] = true;
            result.push(entity);
          }
        }
      }
    }
  }
  return result;
};
