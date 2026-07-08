'use strict';

const { computeCond } = require('./condition');

// 複数地点の marine/wind 日次マップから、航路代表値(最大値)の1日分エントリを作る
function aggregateDay(date, pointResults, thresholds) {
  let waveMax = null;
  let windMax = null;
  let gustMax = null;

  pointResults.forEach(({ marine, wind }) => {
    const w = marine[date] && marine[date].wave_height_max;
    if (w !== null && w !== undefined && (waveMax === null || w > waveMax)) waveMax = w;

    const ws = wind[date] && wind[date].wind_speed_10m_max;
    if (ws !== null && ws !== undefined && (windMax === null || ws > windMax)) windMax = ws;

    const gs = wind[date] && wind[date].wind_gusts_10m_max;
    if (gs !== null && gs !== undefined && (gustMax === null || gs > gustMax)) gustMax = gs;
  });

  if (waveMax === null && windMax === null) return null;

  return {
    waveMax,
    windMax,
    gustMax,
    cond: computeCond(waveMax, windMax, thresholds),
  };
}

module.exports = { aggregateDay };
