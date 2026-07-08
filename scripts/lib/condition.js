'use strict';

const LEVELS = ['calm', 'moderate', 'rough', 'severe'];

function levelOf(value, thresholds) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value < thresholds.calm) return 0;
  if (value < thresholds.moderate) return 1;
  if (value < thresholds.rough) return 2;
  return 3;
}

function computeCond(waveMax, windMax, thresholds) {
  const levels = [levelOf(waveMax, thresholds.wave), levelOf(windMax, thresholds.wind)]
    .filter((l) => l !== null);
  if (levels.length === 0) return null;
  return LEVELS[Math.max(...levels)];
}

module.exports = { LEVELS, levelOf, computeCond };
