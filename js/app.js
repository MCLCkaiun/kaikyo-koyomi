(function () {
  'use strict';

  var CONFIG_URL = 'config/routes.json';
  var META_URL = 'data/meta.json';
  var HISTORY_DIR = 'data/history';

  var COND_LABEL = { calm: '静穏', moderate: 'やや荒れ', rough: '荒れ', severe: '大荒れ' };
  var COND_COLOR_VAR = {
    calm: 'var(--cond-calm)',
    moderate: 'var(--cond-moderate)',
    rough: 'var(--cond-rough)',
    severe: 'var(--cond-severe)',
  };
  var COND_MISSING_VAR = 'var(--cond-missing)';
  var MAX_YEARS_BACK = 10;

  var routesConfig = null;
  var meta = null;
  var routesById = new Map();

  // route -> year -> Promise<yearData>
  var yearDataCache = new Map();

  var state = {
    view: 'almanac',
    almanac: { routeId: null, year: null },
    koyomi: { date: null },
  };

  var els = {};

  // ---------- ユーティリティ ----------

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function todayDateString() {
    // JST を基準に「今日」を求める(データ収集側と揃える)
    var jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
  }

  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function dateStringOf(year, month1, day) {
    return year + '-' + pad2(month1) + '-' + pad2(day);
  }

  function formatDateJP(dateStr) {
    var parts = dateStr.split('-');
    return parts[0] + '年' + Number(parts[1]) + '月' + Number(parts[2]) + '日';
  }

  function condLabel(cond) {
    return cond && COND_LABEL[cond] ? COND_LABEL[cond] : 'データなし';
  }

  function condColorVar(cond) {
    return cond && COND_COLOR_VAR[cond] ? COND_COLOR_VAR[cond] : COND_MISSING_VAR;
  }

  function fmtNum(v, unit) {
    return v === null || v === undefined ? '-' : v.toFixed(1) + unit;
  }

  function daysInYear(year) {
    return isLeapYear(year) ? 366 : 365;
  }

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ---------- データ取得 ----------

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      return res.json();
    });
  }

  function loadYearData(routeId, year) {
    var key = routeId + ':' + year;
    if (!yearDataCache.has(key)) {
      var promise = fetchJSON(HISTORY_DIR + '/' + routeId + '/' + year + '.json')
        .then(function (data) {
          return data && data.days ? data.days : {};
        })
        .catch(function () {
          return {};
        });
      yearDataCache.set(key, promise);
    }
    return yearDataCache.get(key);
  }

  function loadAllYearsForRoute(routeId) {
    var years = (meta.routes && meta.routes[routeId] && meta.routes[routeId].years) || [];
    return Promise.all(
      years.map(function (year) {
        return loadYearData(routeId, year).then(function (days) {
          return { year: year, days: days };
        });
      }),
    );
  }

  // ---------- 初期化 ----------

  function init() {
    els.recordedDays = document.getElementById('recorded-days');
    els.lastUpdated = document.getElementById('last-updated');
    els.tabAlmanac = document.getElementById('tab-almanac');
    els.tabKoyomi = document.getElementById('tab-koyomi');
    els.viewAlmanac = document.getElementById('view-almanac');
    els.viewKoyomi = document.getElementById('view-koyomi');
    els.thresholdNote = document.getElementById('threshold-note');
    els.routeChips = document.getElementById('route-chips');
    els.yearSelect = document.getElementById('year-select');
    els.almanacStatus = document.getElementById('almanac-status');
    els.heatmapSvg = document.getElementById('heatmap-svg');
    els.condLegend = document.getElementById('cond-legend');
    els.monthlySvg = document.getElementById('monthly-svg');
    els.tooltip = document.getElementById('tooltip');
    els.emptyState = document.getElementById('empty-state');
    els.loadError = document.getElementById('load-error');
    els.koyomiDate = document.getElementById('koyomi-date');
    els.koyomiPrev = document.getElementById('koyomi-prev');
    els.koyomiNext = document.getElementById('koyomi-next');
    els.koyomiTodayCards = document.getElementById('koyomi-today-cards');
    els.koyomiTimeline = document.getElementById('koyomi-timeline');

    wireTabs();
    wireKoyomiControls();
    wireTooltipDismiss();

    Promise.all([fetchJSON(CONFIG_URL), fetchJSON(META_URL).catch(function () {
      return { updated: null, recordedDays: 0, routes: {} };
    })])
      .then(function (results) {
        routesConfig = results[0];
        meta = results[1];
        routesConfig.routes.forEach(function (r) {
          routesById.set(r.id, r);
        });

        renderHeaderStats();
        renderThresholdNote();
        renderRouteChips();

        var hashDate = parseHashDate();
        if (hashDate) {
          state.koyomi.date = hashDate;
          switchView('koyomi', { skipHash: true });
        } else {
          state.koyomi.date = todayDateString();
          switchView('almanac', { skipHash: true });
        }

        var defaultRoute = routesConfig.routes[0];
        state.almanac.routeId = defaultRoute ? defaultRoute.id : null;
        state.almanac.year = latestYearFor(state.almanac.routeId);
        setActiveRouteChip(state.almanac.routeId);
        setYearOptions(state.almanac.routeId);

        renderAlmanac();
        els.koyomiDate.value = state.koyomi.date;
        renderKoyomi();

        window.addEventListener('hashchange', onHashChange);
      })
      .catch(function (err) {
        console.error('初期データの読み込みに失敗しました', err);
        showLoadError();
      });
  }

  function showLoadError() {
    els.loadError.hidden = false;
    document.getElementById('view-tabs').hidden = true;
    els.viewAlmanac.hidden = true;
    els.viewKoyomi.hidden = true;
  }

  function renderHeaderStats() {
    els.recordedDays.textContent = meta.recordedDays != null ? meta.recordedDays : '-';
    els.lastUpdated.textContent = meta.updated || '-';
  }

  function renderThresholdNote() {
    var t = routesConfig.thresholds;
    els.thresholdNote.textContent =
      '荒れ判定の目安: 波高 ' + t.wave.rough.toFixed(1) + 'm以上 または 風速 ' + t.wind.rough.toFixed(1) + 'm/s以上 で「荒れ」。' +
      'さらに超えると「大荒れ」。';
  }

  // ---------- タブ切り替え ----------

  function wireTabs() {
    var tabs = [els.tabAlmanac, els.tabKoyomi];
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchView(tab.id === 'tab-koyomi' ? 'koyomi' : 'almanac');
      });
    });

    document.getElementById('view-tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var next = e.key === 'ArrowRight' ? 'koyomi' : 'almanac';
      switchView(next);
      (next === 'koyomi' ? els.tabKoyomi : els.tabAlmanac).focus();
    });
  }

  function switchView(view, opts) {
    opts = opts || {};
    state.view = view;
    var isAlmanac = view === 'almanac';

    els.tabAlmanac.classList.toggle('is-active', isAlmanac);
    els.tabAlmanac.setAttribute('aria-selected', String(isAlmanac));
    els.tabAlmanac.tabIndex = isAlmanac ? 0 : -1;

    els.tabKoyomi.classList.toggle('is-active', !isAlmanac);
    els.tabKoyomi.setAttribute('aria-selected', String(!isAlmanac));
    els.tabKoyomi.tabIndex = !isAlmanac ? 0 : -1;

    els.viewAlmanac.hidden = !isAlmanac;
    els.viewKoyomi.hidden = isAlmanac;

    if (!isAlmanac && !opts.skipHash) {
      history.replaceState(null, '', '#' + state.koyomi.date);
    } else if (isAlmanac && !opts.skipHash) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function parseHashDate() {
    var m = location.hash.match(/^#(\d{4}-\d{2}-\d{2})$/);
    return m ? m[1] : null;
  }

  function onHashChange() {
    var hashDate = parseHashDate();
    if (hashDate) {
      state.koyomi.date = hashDate;
      els.koyomiDate.value = hashDate;
      switchView('koyomi', { skipHash: true });
      renderKoyomi();
    }
  }

  // ---------- 年鑑: 航路チップ・年セレクタ ----------

  function latestYearFor(routeId) {
    var years = (meta.routes && meta.routes[routeId] && meta.routes[routeId].years) || [];
    if (years.length === 0) return Number(todayDateString().slice(0, 4));
    return years[years.length - 1];
  }

  function renderRouteChips() {
    els.routeChips.innerHTML = '';
    routesConfig.routes.forEach(function (route) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.dataset.routeId = route.id;
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = route.name;
      els.routeChips.appendChild(btn);
    });

    els.routeChips.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      var routeId = btn.dataset.routeId;
      if (routeId === state.almanac.routeId) return;
      state.almanac.routeId = routeId;
      state.almanac.year = latestYearFor(routeId);
      setActiveRouteChip(routeId);
      setYearOptions(routeId);
      renderAlmanac();
    });
  }

  function setActiveRouteChip(routeId) {
    var chips = els.routeChips.querySelectorAll('.chip');
    chips.forEach(function (chip) {
      var active = chip.dataset.routeId === routeId;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
  }

  function setYearOptions(routeId) {
    var years = (meta.routes && meta.routes[routeId] && meta.routes[routeId].years) || [];
    els.yearSelect.innerHTML = '';
    if (years.length === 0) {
      var opt = document.createElement('option');
      opt.textContent = 'データなし';
      els.yearSelect.appendChild(opt);
      els.yearSelect.disabled = true;
      return;
    }
    els.yearSelect.disabled = false;
    years
      .slice()
      .sort(function (a, b) { return b - a; })
      .forEach(function (year) {
        var opt = document.createElement('option');
        opt.value = String(year);
        opt.textContent = year + '年';
        if (year === state.almanac.year) opt.selected = true;
        els.yearSelect.appendChild(opt);
      });

    els.yearSelect.onchange = function () {
      state.almanac.year = Number(els.yearSelect.value);
      renderAlmanac();
    };
  }

  // ---------- 年鑑: 描画 ----------

  function renderAlmanac() {
    var routeId = state.almanac.routeId;
    var year = state.almanac.year;
    var years = (meta.routes && meta.routes[routeId] && meta.routes[routeId].years) || [];

    if (!routeId || years.length === 0) {
      els.emptyState.hidden = false;
      els.heatmapSvg.innerHTML = '';
      els.monthlySvg.innerHTML = '';
      els.almanacStatus.textContent = '';
      return;
    }
    els.emptyState.hidden = true;

    var route = routesById.get(routeId);
    els.almanacStatus.textContent = route.name + ' / ' + year + '年';

    loadAllYearsForRoute(routeId).then(function (allYears) {
      // renderAlmanac が古い呼び出しの結果で上書きしないよう、現在の選択と一致する場合のみ描画
      if (state.almanac.routeId !== routeId) return;
      var current = allYears.filter(function (y) { return y.year === year; })[0];
      var currentDays = current ? current.days : {};
      renderCondLegend();
      renderHeatmap(year, currentDays);
      renderMonthlySummary(year, currentDays, allYears);
    });
  }

  function renderCondLegend() {
    var order = ['calm', 'moderate', 'rough', 'severe'];
    var html = '<span>静穏</span>';
    order.forEach(function (cond) {
      html += '<span class="cond-legend__swatch" style="background:' + condColorVar(cond) + '"></span>';
    });
    html += '<span>大荒れ</span>';
    html += '<span class="cond-legend__swatch" style="background:' + COND_MISSING_VAR + '"></span><span>データなし</span>';
    els.condLegend.innerHTML = html;
  }

  var CELL = 11;
  var GAP = 3;
  var STEP = CELL + GAP;
  var MARGIN_LEFT = 24;
  var MARGIN_TOP = 18;

  function renderHeatmap(year, days) {
    var svg = els.heatmapSvg;
    svg.innerHTML = '';
    svg.setAttribute('aria-label', year + '年の年間ヒートマップ');

    var firstDate = new Date(Date.UTC(year, 0, 1));
    var firstDow = firstDate.getUTCDay();
    var total = daysInYear(year);
    var columns = Math.ceil((total + firstDow) / 7);
    var width = MARGIN_LEFT + columns * STEP;
    var height = MARGIN_TOP + 7 * STEP;
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    var ns = 'http://www.w3.org/2000/svg';

    var defs = document.createElementNS(ns, 'defs');
    var pattern = document.createElementNS(ns, 'pattern');
    pattern.setAttribute('id', 'hatch-missing');
    pattern.setAttribute('width', '4');
    pattern.setAttribute('height', '4');
    pattern.setAttribute('patternTransform', 'rotate(45)');
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    var patRect = document.createElementNS(ns, 'rect');
    patRect.setAttribute('width', '4');
    patRect.setAttribute('height', '4');
    patRect.setAttribute('fill', COND_MISSING_VAR);
    var patLine = document.createElementNS(ns, 'line');
    patLine.setAttribute('x1', '0');
    patLine.setAttribute('y1', '0');
    patLine.setAttribute('x2', '0');
    patLine.setAttribute('y2', '4');
    patLine.setAttribute('stroke', 'rgba(18,40,63,0.18)');
    patLine.setAttribute('stroke-width', '2');
    pattern.appendChild(patRect);
    pattern.appendChild(patLine);
    defs.appendChild(pattern);
    svg.appendChild(defs);

    // 曜日ラベル(月・水・金)
    [1, 3, 5].forEach(function (row) {
      var label = document.createElementNS(ns, 'text');
      label.setAttribute('x', MARGIN_LEFT - 6);
      label.setAttribute('y', MARGIN_TOP + row * STEP + CELL - 1);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('font-size', '9');
      label.setAttribute('fill', 'var(--color-ink)');
      label.setAttribute('opacity', '0.55');
      label.textContent = ['日', '月', '火', '水', '木', '金', '土'][row];
      svg.appendChild(label);
    });

    var lastMonth = -1;

    for (var i = 0; i < total; i++) {
      var d = new Date(Date.UTC(year, 0, 1 + i));
      var month = d.getUTCMonth();
      var dateStr = dateStringOf(year, month + 1, d.getUTCDate());
      var col = Math.floor((i + firstDow) / 7);
      var row = (i + firstDow) % 7;

      if (month !== lastMonth) {
        lastMonth = month;
        var mLabel = document.createElementNS(ns, 'text');
        mLabel.setAttribute('x', MARGIN_LEFT + col * STEP);
        mLabel.setAttribute('y', MARGIN_TOP - 6);
        mLabel.setAttribute('font-size', '9');
        mLabel.setAttribute('fill', 'var(--color-ink)');
        mLabel.setAttribute('opacity', '0.55');
        mLabel.textContent = (month + 1) + '月';
        svg.appendChild(mLabel);
      }

      var rec = days[dateStr];
      var rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('class', 'heatmap-cell');
      rect.setAttribute('x', MARGIN_LEFT + col * STEP);
      rect.setAttribute('y', MARGIN_TOP + row * STEP);
      rect.setAttribute('width', CELL);
      rect.setAttribute('height', CELL);
      rect.setAttribute('rx', '2');
      rect.setAttribute('fill', rec === undefined ? 'url(#hatch-missing)' : rec === null ? 'url(#hatch-missing)' : condColorVar(rec.cond));
      rect.dataset.date = dateStr;

      rect.addEventListener('mouseenter', function (e) { onCellHover(e, days); });
      rect.addEventListener('mousemove', function (e) { onCellHover(e, days); });
      rect.addEventListener('mouseleave', hideTooltip);
      rect.addEventListener('click', function (e) { onCellHover(e, days); });

      svg.appendChild(rect);
    }
  }

  function onCellHover(e, days) {
    var dateStr = e.currentTarget.dataset.date;
    var rec = days[dateStr];
    var lines = [formatDateJP(dateStr)];
    if (rec) {
      lines.push('波高: ' + fmtNum(rec.waveMax, 'm') + ' / 風速: ' + fmtNum(rec.windMax, 'm/s'));
      lines.push('判定: ' + condLabel(rec.cond));
    } else {
      lines.push('データなし');
    }
    showTooltip(e.clientX, e.clientY, lines.join('\n'));
  }

  function showTooltip(x, y, text) {
    els.tooltip.textContent = '';
    text.split('\n').forEach(function (line, i) {
      if (i > 0) els.tooltip.appendChild(document.createElement('br'));
      els.tooltip.appendChild(document.createTextNode(line));
    });
    els.tooltip.hidden = false;
    var offset = 14;
    var left = Math.min(x + offset, window.innerWidth - 230);
    var top = Math.min(y + offset, window.innerHeight - 90);
    els.tooltip.style.left = left + 'px';
    els.tooltip.style.top = top + 'px';
  }

  function hideTooltip() {
    els.tooltip.hidden = true;
  }

  function wireTooltipDismiss() {
    document.addEventListener('scroll', hideTooltip, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideTooltip();
    });
  }

  function renderMonthlySummary(year, currentDays, allYears) {
    var svg = els.monthlySvg;
    svg.innerHTML = '';

    var counts = countRoughDaysByMonth(currentDays);
    var otherYears = allYears.filter(function (y) { return y.year !== year; });
    var avgCounts = averageRoughDaysByMonth(otherYears);

    var barW = 28;
    var gap = 10;
    var chartH = 100;
    var width = 12 * (barW + gap) + gap;
    var height = chartH + 34;
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    var maxVal = Math.max(31, Math.max.apply(null, counts), Math.max.apply(null, avgCounts));
    var ns = 'http://www.w3.org/2000/svg';

    for (var m = 0; m < 12; m++) {
      var x = gap + m * (barW + gap);
      var barH = (counts[m] / maxVal) * chartH;
      var rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('class', 'monthly-bar');
      rect.setAttribute('x', x);
      rect.setAttribute('y', chartH - barH);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', Math.max(barH, counts[m] > 0 ? 2 : 0));
      svg.appendChild(rect);

      if (otherYears.length > 0) {
        var avgY = chartH - (avgCounts[m] / maxVal) * chartH;
        var marker = document.createElementNS(ns, 'line');
        marker.setAttribute('class', 'monthly-avg-marker');
        marker.setAttribute('x1', x - 2);
        marker.setAttribute('x2', x + barW + 2);
        marker.setAttribute('y1', avgY);
        marker.setAttribute('y2', avgY);
        svg.appendChild(marker);
      }

      var label = document.createElementNS(ns, 'text');
      label.setAttribute('class', 'monthly-bar-label');
      label.setAttribute('x', x + barW / 2);
      label.setAttribute('y', chartH + 12);
      label.setAttribute('text-anchor', 'middle');
      label.textContent = (m + 1) + '月';
      svg.appendChild(label);

      var valLabel = document.createElementNS(ns, 'text');
      valLabel.setAttribute('class', 'monthly-bar-label');
      valLabel.setAttribute('x', x + barW / 2);
      valLabel.setAttribute('y', chartH - barH - 3 < 9 ? 9 : chartH - barH - 3);
      valLabel.setAttribute('text-anchor', 'middle');
      valLabel.textContent = counts[m] > 0 ? String(counts[m]) : '';
      svg.appendChild(valLabel);
    }

    var caption = document.createElementNS(ns, 'text');
    caption.setAttribute('class', 'monthly-avg-label');
    caption.setAttribute('x', gap);
    caption.setAttribute('y', height - 4);
    caption.textContent = otherYears.length > 0 ? '点線: 記録年平均(' + otherYears.length + '年分)' : '';
    svg.appendChild(caption);
  }

  function countRoughDaysByMonth(days) {
    var counts = new Array(12).fill(0);
    Object.keys(days).forEach(function (dateStr) {
      var rec = days[dateStr];
      if (!rec || (rec.cond !== 'rough' && rec.cond !== 'severe')) return;
      var month = Number(dateStr.slice(5, 7)) - 1;
      counts[month] += 1;
    });
    return counts;
  }

  function averageRoughDaysByMonth(yearsData) {
    if (yearsData.length === 0) return new Array(12).fill(0);
    var sums = new Array(12).fill(0);
    yearsData.forEach(function (y) {
      var c = countRoughDaysByMonth(y.days);
      for (var m = 0; m < 12; m++) sums[m] += c[m];
    });
    return sums.map(function (s) { return s / yearsData.length; });
  }

  // ---------- こよみビュー ----------

  function wireKoyomiControls() {
    els.koyomiDate.addEventListener('change', function () {
      if (!els.koyomiDate.value) return;
      setKoyomiDate(els.koyomiDate.value);
    });
    els.koyomiPrev.addEventListener('click', function () {
      setKoyomiDate(addDays(state.koyomi.date, -1));
    });
    els.koyomiNext.addEventListener('click', function () {
      setKoyomiDate(addDays(state.koyomi.date, 1));
    });
  }

  function setKoyomiDate(dateStr) {
    state.koyomi.date = dateStr;
    els.koyomiDate.value = dateStr;
    if (state.view === 'koyomi') {
      history.replaceState(null, '', '#' + dateStr);
    }
    renderKoyomi();
  }

  function renderKoyomi() {
    var date = state.koyomi.date;
    var year = Number(date.slice(0, 4));

    var loads = routesConfig.routes.map(function (route) {
      return loadYearData(route.id, year).then(function (days) {
        return { route: route, rec: days[date] || null };
      });
    });

    Promise.all(loads).then(function (results) {
      if (state.koyomi.date !== date) return; // 選択が変わっていたら描画しない
      renderKoyomiTodayCards(results);
      renderKoyomiTimeline(date);
    });
  }

  function renderKoyomiTodayCards(results) {
    els.koyomiTodayCards.innerHTML = '';
    results.forEach(function (r) {
      els.koyomiTodayCards.appendChild(buildRouteCard(r.route, r.rec));
    });
    var heading = document.getElementById('koyomi-today-heading');
    heading.textContent = formatDateJP(state.koyomi.date) + 'の海況';
  }

  function buildRouteCard(route, rec) {
    var card = document.createElement('div');
    card.className = 'route-card';
    card.style.borderTopColor = rec ? condColorVar(rec.cond) : COND_MISSING_VAR;

    var name = document.createElement('p');
    name.className = 'route-card__name';
    name.textContent = route.name;
    card.appendChild(name);

    var waveRow = document.createElement('p');
    waveRow.className = 'route-card__row';
    waveRow.innerHTML = '<span>波高</span><span class="route-card__value">' + fmtNum(rec && rec.waveMax, 'm') + '</span>';
    card.appendChild(waveRow);

    var windRow = document.createElement('p');
    windRow.className = 'route-card__row';
    windRow.innerHTML = '<span>風速</span><span class="route-card__value">' + fmtNum(rec && rec.windMax, 'm/s') + '</span>';
    card.appendChild(windRow);

    var cond = document.createElement('span');
    var condVal = rec ? rec.cond : null;
    cond.className = 'route-card__cond' + (condVal === 'rough' || condVal === 'severe' ? ' is-' + condVal : '');
    cond.style.background = rec ? condColorVar(rec.cond) : COND_MISSING_VAR;
    cond.textContent = condLabel(condVal);
    card.appendChild(cond);

    return card;
  }

  function pastYearDate(dateStr, yearsBack) {
    var parts = dateStr.split('-').map(Number);
    var year = parts[0] - yearsBack;
    var month = parts[1];
    var day = parts[2];
    // 2/29 は非うるう年に存在しないため 2/28 に丸める
    if (month === 2 && day === 29 && !isLeapYear(year)) day = 28;
    return dateStringOf(year, month, day);
  }

  function renderKoyomiTimeline(baseDate) {
    els.koyomiTimeline.innerHTML = '';

    var backfillYear = Number((routesConfig.backfillStart || '1900-01-01').slice(0, 4));
    var currentYear = Number(baseDate.slice(0, 4));
    var maxBack = Math.min(MAX_YEARS_BACK, currentYear - backfillYear + 1);
    if (maxBack < 1) maxBack = Math.min(MAX_YEARS_BACK, 5);

    var tasks = [];
    for (var n = 1; n <= maxBack; n++) {
      tasks.push(buildTimelineYearTask(baseDate, n));
    }

    Promise.all(tasks).then(function (rows) {
      if (state.koyomi.date !== baseDate) return;
      var rendered = 0;
      rows.forEach(function (row) {
        if (!row.hasAnyData) return;
        els.koyomiTimeline.appendChild(row.el);
        rendered += 1;
      });
      if (rendered === 0) {
        var empty = document.createElement('p');
        empty.className = 'timeline-empty';
        empty.textContent = '過去の同日データはまだありません。backfill 実行後に表示されます。';
        els.koyomiTimeline.appendChild(empty);
      }
    });
  }

  function buildTimelineYearTask(baseDate, yearsBack) {
    var pastDate = pastYearDate(baseDate, yearsBack);
    var year = Number(pastDate.slice(0, 4));

    var loads = routesConfig.routes.map(function (route) {
      return loadYearData(route.id, year).then(function (days) {
        return { route: route, rec: days[pastDate] || null };
      });
    });

    return Promise.all(loads).then(function (results) {
      var hasAnyData = results.some(function (r) { return !!r.rec; });
      var el = document.createElement('div');
      el.className = 'timeline-year';
      el.style.zIndex = String(100 - yearsBack);
      if (!prefersReducedMotion() && yearsBack > 1) {
        el.style.marginTop = '-18px';
        var inset = Math.min(yearsBack * 3, 24);
        el.style.marginInline = inset + 'px';
        el.style.opacity = String(Math.max(0.72, 1 - yearsBack * 0.045));
      }

      var label = document.createElement('p');
      label.className = 'timeline-year__label';
      label.innerHTML =
        '<span>' + yearsBack + '年前</span><span class="timeline-year__date">' + formatDateJP(pastDate) + '</span>';
      el.appendChild(label);

      var chips = document.createElement('div');
      chips.className = 'timeline-year__chips';
      results.forEach(function (r) {
        var chip = document.createElement('span');
        chip.className = 'timeline-chip';
        var dot = document.createElement('span');
        dot.className = 'timeline-chip__dot';
        dot.style.background = r.rec ? condColorVar(r.rec.cond) : COND_MISSING_VAR;
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode(r.route.name + ' ' + condLabel(r.rec && r.rec.cond)));
        chips.appendChild(chip);
      });
      el.appendChild(chips);

      return { el: el, hasAnyData: hasAnyData };
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
