'use strict';

/**
 * config/routes.json と data/ 以下の JSON 整合性を検証するスクリプト。
 * Node 標準機能のみで動作する(外部パッケージ不要)。
 * GitHub Actions (.github/workflows/validate.yml) から実行される。
 */

const fs = require('fs');
const path = require('path');
const { LEVELS } = require('./lib/condition');

const ROOT = path.join(__dirname, '..');
const ROUTES_PATH = path.join(ROOT, 'config', 'routes.json');
const META_PATH = path.join(ROOT, 'data', 'meta.json');
const HISTORY_DIR = path.join(ROOT, 'data', 'history');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const errors = [];
const fail = (msg) => errors.push(msg);

function readJson(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    fail(`${label} を読み込めませんでした: ${err.message}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`${label} が正しい JSON としてパースできません: ${err.message}`);
    return null;
  }
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// ---------- config/routes.json ----------

const routesConfig = readJson(ROUTES_PATH, 'config/routes.json');
const routeIds = new Set();

if (routesConfig) {
  if (!DATE_RE.test(routesConfig.backfillStart || '')) {
    fail('config/routes.json: backfillStart は YYYY-MM-DD 形式である必要があります。');
  }

  ['wave', 'wind'].forEach((key) => {
    const t = routesConfig.thresholds && routesConfig.thresholds[key];
    if (!t || !isFiniteNumber(t.calm) || !isFiniteNumber(t.moderate) || !isFiniteNumber(t.rough)) {
      fail(`config/routes.json: thresholds.${key} には数値の calm/moderate/rough が必要です。`);
    } else if (!(t.calm < t.moderate && t.moderate < t.rough)) {
      fail(`config/routes.json: thresholds.${key} は calm < moderate < rough の順である必要があります。`);
    }
  });

  const routes = Array.isArray(routesConfig.routes) ? routesConfig.routes : [];
  if (routes.length === 0) {
    fail('config/routes.json: routes が空です。');
  }

  routes.forEach((route, i) => {
    const label = route && route.id ? route.id : `routes[${i}]`;
    if (!route.id || typeof route.id !== 'string') {
      fail(`config/routes.json: "${label}" に id がありません。`);
    } else if (routeIds.has(route.id)) {
      fail(`config/routes.json: route id "${route.id}" が重複しています。`);
    } else {
      routeIds.add(route.id);
    }
    if (!route.name) fail(`config/routes.json: "${label}" に name がありません。`);

    const points = Array.isArray(route.points) ? route.points : [];
    if (points.length === 0) {
      fail(`config/routes.json: "${label}" の points が空です。`);
    }
    points.forEach((pt, j) => {
      const ptLabel = `${label}.points[${j}]`;
      if (!pt.name) fail(`config/routes.json: ${ptLabel} に name がありません。`);
      if (!isFiniteNumber(pt.lat) || pt.lat < -90 || pt.lat > 90) {
        fail(`config/routes.json: ${ptLabel} の lat が不正です。`);
      }
      if (!isFiniteNumber(pt.lon) || pt.lon < -180 || pt.lon > 180) {
        fail(`config/routes.json: ${ptLabel} の lon が不正です。`);
      }
    });
  });
}

// ---------- data/meta.json (存在する場合のみ) ----------

if (fs.existsSync(META_PATH)) {
  const meta = readJson(META_PATH, 'data/meta.json');
  if (meta) {
    if (meta.updated !== null && !DATE_RE.test(meta.updated || '')) {
      fail('data/meta.json: updated は YYYY-MM-DD 形式である必要があります。');
    }
    if (!isFiniteNumber(meta.recordedDays)) {
      fail('data/meta.json: recordedDays は数値である必要があります。');
    }
  }
}

// ---------- data/history/<route>/<year>.json ----------

if (fs.existsSync(HISTORY_DIR)) {
  const dirs = fs.readdirSync(HISTORY_DIR).filter((f) => fs.statSync(path.join(HISTORY_DIR, f)).isDirectory());

  dirs.forEach((routeId) => {
    if (routesConfig && !routeIds.has(routeId)) {
      fail(`data/history/${routeId}/: config/routes.json に存在しない route id のディレクトリです。`);
    }

    const routeDir = path.join(HISTORY_DIR, routeId);
    const files = fs.readdirSync(routeDir);

    files.forEach((file) => {
      const filePath = path.join(routeDir, file);
      if (!/^\d{4}\.json$/.test(file)) {
        fail(`data/history/${routeId}/${file}: ファイル名は YYYY.json 形式である必要があります。`);
        return;
      }

      const yearFromName = Number(file.replace('.json', ''));
      const data = readJson(filePath, `data/history/${routeId}/${file}`);
      if (!data) return;

      if (data.route !== routeId) {
        fail(`data/history/${routeId}/${file}: route フィールド ("${data.route}") がディレクトリ名と一致しません。`);
      }
      if (data.year !== yearFromName) {
        fail(`data/history/${routeId}/${file}: year フィールド (${data.year}) がファイル名と一致しません。`);
      }

      const days = data.days && typeof data.days === 'object' ? data.days : null;
      if (!days) {
        fail(`data/history/${routeId}/${file}: days がオブジェクトではありません。`);
        return;
      }

      Object.entries(days).forEach(([date, rec]) => {
        if (!DATE_RE.test(date) || Number(date.slice(0, 4)) !== yearFromName) {
          fail(`data/history/${routeId}/${file}: 日付キー "${date}" が不正、または年が一致しません。`);
          return;
        }
        if (rec === null) return;
        if (typeof rec !== 'object') {
          fail(`data/history/${routeId}/${file}: "${date}" のエントリはオブジェクトまたは null である必要があります。`);
          return;
        }
        ['waveMax', 'windMax', 'gustMax'].forEach((field) => {
          const v = rec[field];
          if (v !== null && v !== undefined && typeof v !== 'number') {
            fail(`data/history/${routeId}/${file}: "${date}".${field} は数値または null である必要があります。`);
          }
        });
        if (rec.cond !== null && rec.cond !== undefined && !LEVELS.includes(rec.cond)) {
          fail(`data/history/${routeId}/${file}: "${date}".cond の値 "${rec.cond}" が不正です(${LEVELS.join('/')}/null のいずれか)。`);
        }
      });
    });
  });
}

// ---------- 結果 ----------

if (errors.length > 0) {
  console.error(`検証に失敗しました (${errors.length} 件のエラー):\n`);
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
}

console.log('✓ config/routes.json および data/ の検証に成功しました。');
process.exit(0);
