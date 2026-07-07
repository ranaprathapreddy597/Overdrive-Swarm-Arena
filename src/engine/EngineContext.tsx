// src/engine/EngineContext.tsx

import React, { createContext, useContext, ReactNode } from 'react';
import { useSharedValue, SharedValue } from 'react-native-reanimated';
import { WorldState, createWorld, SpatialHashGridState, createSpatialHashGrid } from './ECS';

interface EngineContextValue {
  world: SharedValue<WorldState>;
  grid: SharedValue<SpatialHashGridState>;
}

const EngineContext = createContext<EngineContextValue | null>(null);

/**
 * Provides the ECS World and Spatial Grid state as Reanimated SharedValues.
 * This allows systems and renderers to mutate and read the state strictly on the UI thread.
 */
export const EngineProvider = ({ children }: { children: ReactNode }) => {
  // Initialize the world
  const world = useSharedValue<WorldState>(createWorld());
  
  // Initialize spatial hash grid with cell size 50 (tune this based on entity sizes)
  const grid = useSharedValue<SpatialHashGridState>(createSpatialHashGrid(50));

  return (
    <EngineContext.Provider value={{ world, grid }}>
      {children}
    </EngineContext.Provider>
  );
};

export const useEngine = () => {
  const ctx = useContext(EngineContext);
  if (!ctx) {
    throw new Error('useEngine must be used within an EngineProvider');
  }
  return ctx;
};
