#!/usr/bin/env node
'use strict';

/**
 * 過去データの一括取得(手動実行、workflow_dispatch)。
 * 環境変数 START_DATE / END_DATE / ROUTE で範囲・対象航路を指定する(すべて省略可)。
 * 月単位のチャンクに分けて取得し、失敗はリトライ、それでも失敗した日は null として続行する。
 * GitHub Actions (.github/workflows/backfill.yml) から実行される。
 */

const routesConfig = require('../config/routes.json');
const { fetchMarineHistorical, fetchArchiveHistorical } = require('./lib/openmeteo');
const { loadYear, saveYear, loadMeta, saveMeta, updateMetaFromDisk } = require('./lib/store');
const { aggregateDay } = require('./lib/aggregate');
const { jstTodayString, addDaysStr } = require('./lib/date');

const WAIT_MS = 1500;
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function lastDayOfMonth(year, month1to12) {
  // Date.UTC の日0指定は「前月の末日」を返す仕様を利用する
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function monthChunks(startDate, endDate) {
  const chunks = [];
  let cur = startDate.slice(0, 7); // "YYYY-MM"
  const endMonth = endDate.slice(0, 7);

  while (cur <= endMonth) {
    const [y, m] = cur.split('-').map(Number);
    const first = `${cur}-01`;
    const last = `${cur}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}`;
    const chunkStart = first < startDate ? startDate : first;
    const chunkEnd = last > endDate ? endDate : last;
    chunks.push([chunkStart, chunkEnd]);
    cur = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  }

  return chunks;
}

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (err) {
      lastErr = err;
      console.error(`  リトライ ${attempt}/${MAX_RETRIES} 失敗 (${label}): ${err.message}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(WAIT_MS * attempt);
    }
  }
  console.error(`  断念 (${label}): ${lastErr.message}`);
  return null;
}

async function backfillRoute(route, startDate, endDate, thresholds, summary) {
  const chunks = monthChunks(startDate, endDate);
  const yearCache = new Map();
  const getYear = (year) => {
    if (!yearCache.has(year)) yearCache.set(year, loadYear(route.id, year));
    return yearCache.get(year);
  };

  for (const [chunkStart, chunkEnd] of chunks) {
    console.log(`[${route.id}] ${chunkStart} 〜 ${chunkEnd}`);

    const pointResults = [];
    for (const point of route.points) {
      // eslint-disable-next-line no-await-in-loop
      const marine = await withRetry(
        () => fetchMarineHistorical(point.lat, point.lon, chunkStart, chunkEnd),
        `${route.id}/${point.name} 波浪`,
      );
      // eslint-disable-next-line no-await-in-loop
      await sleep(WAIT_MS);
      // eslint-disable-next-line no-await-in-loop
      const wind = await withRetry(
        () => fetchArchiveHistorical(point.lat, point.lon, chunkStart, chunkEnd),
        `${route.id}/${point.name} 風`,
      );
      // eslint-disable-next-line no-await-in-loop
      await sleep(WAIT_MS);

      if (marine === null) summary.failures.push(`${route.id}/${point.name} 波浪 ${chunkStart}〜${chunkEnd}`);
      if (wind === null) summary.failures.push(`${route.id}/${point.name} 風 ${chunkStart}〜${chunkEnd}`);

      pointResults.push({ marine: marine || {}, wind: wind || {} });
    }

    let d = chunkStart;
    while (d <= chunkEnd) {
      const year = Number(d.slice(0, 4));
      const yearData = getYear(year);
      yearData.days[d] = aggregateDay(d, pointResults, thresholds);
      d = addDaysStr(d, 1);
    }
  }

  yearCache.forEach((data, year) => saveYear(route.id, year, data));
}

async function main() {
  const today = jstTodayString();
  const yesterday = addDaysStr(today, -1);

  const startDate = (process.env.START_DATE || '').trim() || routesConfig.backfillStart;
  const endDate = (process.env.END_DATE || '').trim() || yesterday;
  const routeFilter = (process.env.ROUTE || '').trim();

  if (startDate > endDate) {
    console.error(`start_date (${startDate}) が end_date (${endDate}) より後です。`);
    process.exit(1);
  }

  const targets =
    routeFilter && routeFilter !== 'all'
      ? routesConfig.routes.filter((r) => r.id === routeFilter)
      : routesConfig.routes;

  if (targets.length === 0) {
    console.error(`不明な route id: "${routeFilter}"`);
    process.exit(1);
  }

  const summary = { failures: [] };

  for (const route of targets) {
    // eslint-disable-next-line no-await-in-loop
    await backfillRoute(route, startDate, endDate, routesConfig.thresholds, summary);
  }

  const meta = loadMeta();
  updateMetaFromDisk(meta, routesConfig);
  meta.updated = today;
  saveMeta(meta);

  console.log('--- backfill サマリー ---');
  console.log(`航路: ${targets.map((r) => r.id).join(', ')}`);
  console.log(`範囲: ${startDate} 〜 ${endDate}`);
  console.log(`失敗チャンク数: ${summary.failures.length}`);
  summary.failures.forEach((f) => console.log(`  - ${f}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
