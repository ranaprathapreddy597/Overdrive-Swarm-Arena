import AsyncStorage from '@react-native-async-storage/async-storage';

const STATS_KEY = '@overdrive_stats';

export interface GameStats {
  bestSurvivalTime: number; // in seconds
  highestLevel: number;
  totalEnemiesDestroyed: number;
}

export const defaultStats: GameStats = {
  bestSurvivalTime: 0,
  highestLevel: 1,
  totalEnemiesDestroyed: 0,
};

export const loadStats = async (): Promise<GameStats> => {
  try {
    const jsonValue = await AsyncStorage.getItem(STATS_KEY);
    return jsonValue != null ? JSON.parse(jsonValue) : defaultStats;
  } catch (e) {
    console.warn('Failed to load stats', e);
    return defaultStats;
  }
};

export const saveStats = async (stats: GameStats): Promise<void> => {
  try {
    const jsonValue = JSON.stringify(stats);
    await AsyncStorage.setItem(STATS_KEY, jsonValue);
  } catch (e) {
    console.warn('Failed to save stats', e);
  }
};

export const updateStatsIfBetter = async (currentRun: GameStats): Promise<boolean> => {
  const bestStats = await loadStats();
  let updated = false;

  if (currentRun.bestSurvivalTime > bestStats.bestSurvivalTime) {
    bestStats.bestSurvivalTime = currentRun.bestSurvivalTime;
    updated = true;
  }
  
  if (currentRun.highestLevel > bestStats.highestLevel) {
    bestStats.highestLevel = currentRun.highestLevel;
    updated = true;
  }

  // We accumulate total enemies destroyed across all runs, or just track max?
  // Usually "total" means accumulated. But if the prompt means "max enemies destroyed in a run":
  // The prompt: "check run metrics (survival time, highest level, total enemies destroyed) against historic bests"
  // Let's assume it means most enemies destroyed in a single run.
  if (currentRun.totalEnemiesDestroyed > bestStats.totalEnemiesDestroyed) {
    bestStats.totalEnemiesDestroyed = currentRun.totalEnemiesDestroyed;
    updated = true;
  }

  if (updated) {
    await saveStats(bestStats);
  }

  return updated;
};
