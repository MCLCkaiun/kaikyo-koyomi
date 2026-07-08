#!/usr/bin/env node
'use strict';

/**
 * 毎日の海況記録。前日(JST)分を全航路取得し、該当年ファイルに追記する。
 * 直近7日以内に欠損(null)があれば、あわせて埋め直しを試みる(自己修復)。
 * GitHub Actions (.github/workflows/daily.yml) から実行される。
 */

const routesConfig = require('../config/routes.json');
const { fetchMarineRecent, fetchForecastRecent } = require('./lib/openmeteo');
const { loadYear, saveYear, loadMeta, saveMeta, updateMetaFromDisk } = require('./lib/store');
const { aggregateDay } = require('./lib/aggregate');
const { jstTodayString, addDaysStr } = require('./lib/date');

const SELF_HEAL_DAYS = 7;

async function fetchPointRecent(point) {
  const [marine, wind] = await Promise.all([
    fetchMarineRecent(point.lat, point.lon, SELF_HEAL_DAYS).catch((err) => {
      console.error(`  波浪データ取得失敗 (${point.name}): ${err.message}`);
      return {};
    }),
    fetchForecastRecent(point.lat, point.lon, SELF_HEAL_DAYS).catch((err) => {
      console.error(`  風データ取得失敗 (${point.name}): ${err.message}`);
      return {};
    }),
  ]);
  return { marine, wind };
}

async function processRoute(route, targetDates, yesterday) {
  console.log(`[${route.id}] 取得中...`);
  const pointResults = await Promise.all(route.points.map(fetchPointRecent));

  const yearCache = new Map();
  const getYear = (year) => {
    if (!yearCache.has(year)) yearCache.set(year, loadYear(route.id, year));
    return yearCache.get(year);
  };

  let touched = false;

  targetDates.forEach((date) => {
    const year = Number(date.slice(0, 4));
    const yearData = getYear(year);
    const existing = yearData.days[date];

    // 昨日分は常に上書き(冪等)。それ以前は既存に欠損がある場合のみ埋め直す。
    const needsFetch =
      date === yesterday ||
      existing === undefined ||
      existing === null ||
      existing.waveMax === null ||
      existing.windMax === null;
    if (!needsFetch) return;

    yearData.days[date] = aggregateDay(date, pointResults, routesConfig.thresholds);
    touched = true;
  });

  if (touched) {
    yearCache.forEach((data, year) => saveYear(route.id, year, data));
  }

  return touched;
}

async function main() {
  const today = jstTodayString();
  const yesterday = addDaysStr(today, -1);
  const targetDates = [];
  for (let i = 1; i <= SELF_HEAL_DAYS; i += 1) targetDates.push(addDaysStr(today, -i));

  const touchedRoutes = [];
  for (const route of routesConfig.routes) {
    // eslint-disable-next-line no-await-in-loop
    const touched = await processRoute(route, targetDates, yesterday);
    if (touched) touchedRoutes.push(route.id);
  }

  const meta = loadMeta();
  updateMetaFromDisk(meta, routesConfig);
  meta.updated = today;
  saveMeta(meta);

  console.log(`更新した航路: ${touchedRoutes.join(', ') || '(なし)'}`);
  console.log(`対象日: ${yesterday}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
