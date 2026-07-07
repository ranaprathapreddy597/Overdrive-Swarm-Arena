// src/engine/GameLoop.ts

import { useFrameCallback, FrameInfo } from 'react-native-reanimated';

export type GameLoopCallback = (deltaTime: number) => void;

/**
 * useGameLoop Hook
 * 
 * Runs the game loop directly on the UI thread using Reanimated's useFrameCallback.
 * - Supports 120fps natively by using dynamic delta-time (dt) calculations instead of fixed steps.
 * - Caps delta-time to avoid huge physics leaps (e.g. when app resumes from background).
 */
export const useGameLoop = (callback: GameLoopCallback, isActive: boolean = true) => {
  useFrameCallback((frameInfo: FrameInfo) => {
    'worklet';

    // timeSincePreviousFrame is in milliseconds. It is null on the very first frame.
    const deltaMs = frameInfo.timeSincePreviousFrame ?? 0;
    
    // Convert to seconds for physics/movement calculations
    let dt = deltaMs / 1000.0;

    // Cap dt to prevent massive jumps when app comes back from background (e.g., max 100ms step)
    if (dt > 0.1) {
      dt = 0.1;
    }

    // Only process logic if time has actually elapsed
    if (dt > 0) {
      callback(dt);
    }
  }, isActive);
};
