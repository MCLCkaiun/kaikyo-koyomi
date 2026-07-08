'use strict';

/**
 * Open-Meteo API クライアント。Node 標準の fetch のみで動作する(外部パッケージ不要)。
 */

const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

async function fetchJson(baseUrl, params) {
  const qs = new URLSearchParams(params).toString();
  const url = `${baseUrl}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function dailyMapFromResponse(json, fields) {
  const out = {};
  const time = json && json.daily && json.daily.time;
  if (!Array.isArray(time)) return out;
  time.forEach((date, i) => {
    const rec = {};
    fields.forEach((field) => {
      const arr = json.daily[field];
      const v = Array.isArray(arr) ? arr[i] : null;
      rec[field] = v === undefined ? null : v;
    });
    out[date] = rec;
  });
  return out;
}

// 過去の波浪データ(marine-api の historical 範囲。地点によって開始可能日が異なる)
async function fetchMarineHistorical(lat, lon, startDate, endDate) {
  const json = await fetchJson(MARINE_URL, {
    latitude: lat,
    longitude: lon,
    daily: 'wave_height_max',
    start_date: startDate,
    end_date: endDate,
    timezone: 'Asia/Tokyo',
    cell_selection: 'sea',
  });
  return dailyMapFromResponse(json, ['wave_height_max']);
}

// 過去の風データ(archive-api、ERA5 再解析。1940年から取得可)
async function fetchArchiveHistorical(lat, lon, startDate, endDate) {
  const json = await fetchJson(ARCHIVE_URL, {
    latitude: lat,
    longitude: lon,
    daily: 'wind_speed_10m_max,wind_gusts_10m_max',
    start_date: startDate,
    end_date: endDate,
    timezone: 'Asia/Tokyo',
    wind_speed_unit: 'ms',
  });
  return dailyMapFromResponse(json, ['wind_speed_10m_max', 'wind_gusts_10m_max']);
}

// 直近の波浪データ(marine-api の past_days。ERA5 の遅延に先んじて直近日を埋める)
async function fetchMarineRecent(lat, lon, pastDays) {
  const json = await fetchJson(MARINE_URL, {
    latitude: lat,
    longitude: lon,
    daily: 'wave_height_max',
    past_days: pastDays,
    forecast_days: 1,
    timezone: 'Asia/Tokyo',
    cell_selection: 'sea',
  });
  return dailyMapFromResponse(json, ['wave_height_max']);
}

// 直近の風データ(forecast-api の past_days。実況に近い値が入る)
async function fetchForecastRecent(lat, lon, pastDays) {
  const json = await fetchJson(FORECAST_URL, {
    latitude: lat,
    longitude: lon,
    daily: 'wind_speed_10m_max,wind_gusts_10m_max',
    past_days: pastDays,
    forecast_days: 1,
    timezone: 'Asia/Tokyo',
    wind_speed_unit: 'ms',
  });
  return dailyMapFromResponse(json, ['wind_speed_10m_max', 'wind_gusts_10m_max']);
}

module.exports = {
  fetchMarineHistorical,
  fetchArchiveHistorical,
  fetchMarineRecent,
  fetchForecastRecent,
};
