'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HISTORY_DIR = path.join(ROOT, 'data', 'history');
const META_PATH = path.join(ROOT, 'data', 'meta.json');

function yearFilePath(routeId, year) {
  return path.join(HISTORY_DIR, routeId, `${year}.json`);
}

function loadYear(routeId, year) {
  const file = yearFilePath(routeId, year);
  if (!fs.existsSync(file)) {
    return { route: routeId, year, days: {} };
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveYear(routeId, year, data) {
  const dir = path.join(HISTORY_DIR, routeId);
  fs.mkdirSync(dir, { recursive: true });
  const sortedDays = {};
  Object.keys(data.days)
    .sort()
    .forEach((d) => {
      sortedDays[d] = data.days[d];
    });
  const out = { route: routeId, year, days: sortedDays };
  fs.writeFileSync(yearFilePath(routeId, year), `${JSON.stringify(out, null, 2)}\n`);
}

function loadMeta() {
  if (!fs.existsSync(META_PATH)) {
    return { updated: null, recordedDays: 0, routes: {} };
  }
  return JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
}

function saveMeta(meta) {
  fs.writeFileSync(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);
}

// 航路ディレクトリを走査し、実データ範囲(波/風それぞれの開始日、最終記録日、収録年)を求める
function scanRoute(routeId) {
  const dir = path.join(HISTORY_DIR, routeId);
  const result = { waveStart: null, windStart: null, lastRecorded: null, years: [], days: new Set() };
  if (!fs.existsSync(dir)) return result;

  const files = fs.readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f));
  result.years = files.map((f) => Number(f.replace('.json', ''))).sort((a, b) => a - b);

  files.forEach((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    Object.entries(data.days || {}).forEach(([date, rec]) => {
      if (!rec) return;
      result.days.add(date);
      if (rec.waveMax !== null && rec.waveMax !== undefined) {
        if (!result.waveStart || date < result.waveStart) result.waveStart = date;
      }
      if (rec.windMax !== null && rec.windMax !== undefined) {
        if (!result.windStart || date < result.windStart) result.windStart = date;
      }
      if (!result.lastRecorded || date > result.lastRecorded) result.lastRecorded = date;
    });
  });

  return result;
}

// data/history/ 以下を全走査して meta.json の routes / recordedDays を再計算する
function updateMetaFromDisk(meta, routesConfig) {
  const allDays = new Set();
  meta.routes = meta.routes || {};

  routesConfig.routes.forEach((route) => {
    const scan = scanRoute(route.id);
    scan.days.forEach((d) => allDays.add(d));
    meta.routes[route.id] = {
      name: route.name,
      years: scan.years,
      waveStart: scan.waveStart,
      windStart: scan.windStart,
      lastRecorded: scan.lastRecorded,
    };
  });

  meta.recordedDays = allDays.size;
  return meta;
}

module.exports = {
  HISTORY_DIR,
  META_PATH,
  loadYear,
  saveYear,
  loadMeta,
  saveMeta,
  scanRoute,
  updateMetaFromDisk,
};
