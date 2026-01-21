/* ========================
   DASHBOARD.JS - FIXED LOGIC
   ======================== */

const $ = (id) => document.getElementById(id);

let assessmentData = null;
let allKpis = [];
let sortDirection = 'desc';

// ========================
// MRSM / Recommendation helpers
// ========================
const SOFT_KO_IDS = new Set(['OP-04', 'PEN-01', 'CO-01', 'SC-02']);

function normalizeKpiId(item) {
    // IMPORTANT: Some datasets use item.id as a "group" (e.g., "Operation") not a KPI code.
    // So we only accept candidates that look like a KPI ID (e.g., OP-04, CS-01, KO-*, BR-01...).
    const normalize = (v) => String(v ?? '')
        .trim()
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
        .replace(/\s+/g, '')
        .toUpperCase();

    const looksLikeKpi = (s) => {
        // OP-01, CS-02, BR-03, CAT-01, SC-02, PEN-01, CO-01, KO-XYZ...
        return /^([A-Z]{2,4}|CAT|PEN|KO)-[A-Z0-9]{2,}$/i.test(s);
    };

    const candidates = [
        item?.kpiId, item?.kpi_id, item?.KPI_ID,
        item?.rule_id, item?.ruleId, item?.Rule_ID, item?.RuleID,
        item?.kpi_code, item?.kpiCode, item?.ma_kpi, item?.maKpi,
        item?.code, item?.metric_id, item?.kpi,
        // put item.id LAST because it is the most likely to be a group label in your case
        item?.id,
    ];

    for (const c of candidates) {
        const s = normalize(c);
        if (s && looksLikeKpi(s)) return s;
    }

    // Last-resort: scan string values inside the object to find something that matches a KPI pattern.
    if (item && typeof item === 'object') {
        for (const v of Object.values(item)) {
            const s = normalize(v);
            if (s && looksLikeKpi(s)) return s;
        }
    }

    return normalize(item ?? '');
}

function normalizeGroupName(group) {
    const g = String(group || '').trim().toLowerCase();
    if (!g) return '';
    if (g === 'operation' || g.includes('ops') || g.includes('vận hành') || g.includes('van hanh')) return 'Vận hành';
    if (g === 'brand' || g.includes('thương hiệu') || g.includes('thuong hieu')) return 'Thương hiệu';
    if (g === 'category' || g.includes('danh mục') || g.includes('danh muc')) return 'Danh mục';
    if (g === 'scale' || g.includes('quy mô') || g.includes('quy mo')) return 'Quy mô';
    return group;
}

function getRecommendation(kpiId) {
    try {
        return (window.RECOMMENDATIONS && window.RECOMMENDATIONS[kpiId])
            ? window.RECOMMENDATIONS[kpiId]
            : null;
    } catch (_) {
        return null;
    }
}

// ========================
// ENRICH META TỪ recommendation.js
// ========================
function getRecMeta(kpiId) {
    try {
        const rec = (window.RECOMMENDATIONS && window.RECOMMENDATIONS[kpiId])
            ? window.RECOMMENDATIONS[kpiId]
            : null;
        if (!rec) return null;
        return rec.meta || rec.rule || rec.threshold || rec.thresholds || rec.scoring || null;
    } catch (_) {
        return null;
    }
}

function enrichKpisWithRecMeta(kpis) {
    if (!Array.isArray(kpis)) return kpis;

    return kpis.map((k) => {
        const id = normalizeKpiId(k);
        const meta = getRecMeta(id);
        if (!meta) return k;

        const next = { ...k };

        // method/direction
        if (!next.method && meta.method) next.method = String(meta.method).toUpperCase();
        if (!next.direction && meta.direction) next.direction = String(meta.direction).toUpperCase();

        // thresholds
        if (next.t1 === undefined || next.t1 === null) {
            if (meta.t1 !== undefined) next.t1 = meta.t1;
            else if (meta.target !== undefined) next.t1 = meta.target;
        }
        if (next.t2 === undefined || next.t2 === null) {
            if (meta.t2 !== undefined) next.t2 = meta.t2;
            else if (meta.min !== undefined) next.t2 = meta.min;
        }

        return next;
    });
}

function calcImpactGap(item) {
    const score = Number(item?.score ?? 0);
    const w = Number(item?.weight_final ?? item?.weight_final ?? item?.weight ?? 0);
    return (100 - score) * (isFinite(w) ? w : 0);
}

function estimateEffort(kpiId, group, gateType) {
    if (gateType && gateType !== 'NONE') return 2;
    const id = (kpiId || '').toUpperCase();
    const g = (group || '').toLowerCase();
    if (id.startsWith('OP-') || id.startsWith('CS-') || id.startsWith('PEN-') || id.startsWith('CO-')) return 2;
    if (id.startsWith('BR-') || id.startsWith('CAT-')) return 3;
    if (id.startsWith('SC-') || g.includes('quy mô')) return 3;
    return 3;
}

function detectGateType(kpiId, kpiItem) {
    const id = (kpiId || '').toUpperCase();
    const rec = getRecommendation(id);
    const recGate = (rec?.gate || '').toUpperCase();
    if (recGate === 'HARD_KO') return 'HARD_KO';
    if (recGate === 'SOFT_KO') return 'SOFT_KO';
    if (id.startsWith('KO-')) return 'HARD_KO';
    if (SOFT_KO_IDS.has(id)) return 'SOFT_KO';

    // Backup: if local breakdown carries gate/status flags
    const g = (kpiItem?.gate || kpiItem?.gateType || '').toString().toUpperCase();
    if (g === 'HARD_KO') return 'HARD_KO';
    if (g === 'SOFT_KO') return 'SOFT_KO';
    return 'NONE';
}

function priorityOf(kpiId, kpiItem, topImpactThreshold) {
    const gateType = detectGateType(kpiId, kpiItem);
    if (gateType !== 'NONE') return 'P0';
    const impactGap = calcImpactGap(kpiItem);
    if (impactGap >= topImpactThreshold) return 'P1';
    return 'P2';
}

function buildFixlist(breakdownItems) {
    const items = (breakdownItems || []).map((k) => {
        const kpiId = normalizeKpiId(k);
        const group = k.group || groupOf(kpiId);
        const gateType = detectGateType(kpiId, k);
        const impactGap = calcImpactGap(k);
        const effort = Number(k.effort ?? k.meta?.effort ?? estimateEffort(kpiId, group, gateType));
        return {
            ...k,
            kpiId,
            group,
            gateType,
            impactGap,
            effort,
        };
    });

    // P1 threshold = top 20% ImpactGap (exclude P0 to avoid bias)
    const nonP0 = items.filter(it => it.gateType === 'NONE');
    const impacts = nonP0.map(it => it.impactGap).sort((a, b) => b - a);
    const idx = Math.max(0, Math.floor(impacts.length * 0.2) - 1);
    const top20 = impacts.length ? impacts[idx] : 0;

    items.forEach(it => {
        it.priority = priorityOf(it.kpiId, it, top20);
    });

    // Sort: P0 > ImpactGap desc > Effort asc
    const pRank = { P0: 0, P1: 1, P2: 2 };
    items.sort((a, b) => {
        const pa = pRank[a.priority] ?? 9;
        const pb = pRank[b.priority] ?? 9;
        if (pa !== pb) return pa - pb;
        if (b.impactGap !== a.impactGap) return b.impactGap - a.impactGap;
        return (a.effort ?? 99) - (b.effort ?? 99);
    });

    return { items, top20Threshold: top20 };
}

// ========================
// LOAD DỮ LIỆU
// ========================
async function loadData() {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = (urlParams.get('mode') || '').toLowerCase();
    const assessmentId = urlParams.get('assessment_id');

    // ✅ 1) LOCAL MODE: ưu tiên đọc record đã được RESULTS lưu sẵn
    if (mode === 'local') {
        const rawRecord = localStorage.getItem('assessment_record_local');
        if (rawRecord) {
            try {
                assessmentData = JSON.parse(rawRecord);
                renderDashboard();
                return;
            } catch (err) {
                console.error('Lỗi parse assessment_record_local:', err);
            }
        }

        // fallback: nếu không có record thì mới dùng assessment_result
        const localData = localStorage.getItem('assessment_result');
        if (!localData) {
            showEmptyState();
            return;
        }

        try {
            const parsed = JSON.parse(localData);
            assessmentData = adaptLocalData(parsed);
            renderDashboard();
            return;
        } catch (err) {
            console.error('Lỗi parse assessment_result:', err);
            showEmptyState();
            return;
        }
    }

    // ✅ 2) ONLINE MODE: có assessment_id thì thử API như cũ
    if (assessmentId) {
        try {
            const response = await fetch(`/api/assessments/${encodeURIComponent(assessmentId)}`);
            if (response.ok) {
                const data = await response.json();
                if (data && data.assessment_id) {
                    assessmentData = data;
                    renderDashboard();
                    return;
                }
            }
        } catch (err) {
            console.error('Lỗi API:', err);
        }
    }

    // ✅ 3) DEFAULT FALLBACK: dùng localStorage (giữ logic cũ)
    const localData = localStorage.getItem('assessment_result');
    if (!localData) {
        showEmptyState();
        return;
    }

    try {
        const parsed = JSON.parse(localData);
        assessmentData = adaptLocalData(parsed);
        renderDashboard();
    } catch (err) {
        console.error('Lỗi parse dữ liệu:', err);
        showEmptyState();
    }
}

// ========================
// ADAPT DỮ LIỆU TỪ LOCAL
// ========================
function adaptLocalData(local) {
    const breakdown = Array.isArray(local?.breakdown) ? local.breakdown : [];

    // ✅ Giữ schema localStorage, nhưng normalize đủ field để dashboard hiểu đúng:
    // - value: CHO PHÉP value = 0 (0 vẫn là dữ liệu hợp lệ)
    // - method/direction/t1/t2: nếu breakdown có thì giữ, thiếu sẽ enrich từ recommendation.js
    let kpis = breakdown.map(k => {
        const kpiId = normalizeKpiId(k);
        const groupNormalized = normalizeGroupName(k.group || k.nhom || k.group_name || k.groupName);

        // value: ưu tiên value, fallback raw_value/input/actual/current
        const value = (k.value !== undefined) ? k.value
            : (k.raw_value !== undefined) ? k.raw_value
                : (k.input !== undefined) ? k.input
                    : (k.user_input !== undefined) ? k.user_input
                        : (k.actual !== undefined) ? k.actual
                            : (k.current !== undefined) ? k.current
                                : null;

        return {
            ...k,
            rule_id: kpiId, // legacy name used by existing UI
            kpiId: kpiId,
            name: k.name || k.title || k.kpiName || '—',
            group: groupNormalized || groupOf(kpiId),

            score: Number(k.score ?? 0),

            // weight: accept many names
            weight_final: Number(k.weight_final ?? k.weightFinal ?? k.Weight_Final ?? k.WEIGHT_FINAL ?? k.weight ?? k.wf ?? 0),
            weight: Number(k.weight_final ?? k.weightFinal ?? k.Weight_Final ?? k.WEIGHT_FINAL ?? k.weight ?? k.wf ?? 0),

            // ✅ keep raw value (including 0)
            value: value,

            // ✅ keep scoring meta if present
            method: k.method ? String(k.method).toUpperCase() : (k.meta?.method ? String(k.meta.method).toUpperCase() : undefined),
            direction: k.direction ? String(k.direction).toUpperCase() : (k.meta?.direction ? String(k.meta.direction).toUpperCase() : undefined),
            t1: (k.t1 !== undefined) ? k.t1 : (k.meta?.t1 !== undefined ? k.meta.t1 : undefined),
            t2: (k.t2 !== undefined) ? k.t2 : (k.meta?.t2 !== undefined ? k.meta.t2 : undefined),

            status: k.status ?? k.passFail ?? null,
            meta: k.meta ?? null,
        };
    });

    // ✅ enrich thêm meta từ recommendation.js nếu thiếu
    kpis = enrichKpisWithRecMeta(kpis);

    const groups = calcGroups(kpis);
    const shopInfo = bestEffortShopInfo(local);
    const gate = local?.gate || { status: 'PASS', hard: { failed_rules: [] }, soft: { items: {}, deadline_at: null } };
    const totalScore = Number(local.totalScore ?? 0);
    const tier = normalizeTier(local.tier, totalScore);

    return {
        assessment_id: 'LOCAL_' + (local.computedAt || new Date().toISOString()).replace(/[:.]/g, ''),
        evaluated_at: local.computedAt || new Date().toISOString(),
        shop: shopInfo,
        gate: gate,
        mrsm: {
            final_score: totalScore,
            tier: tier
        },
        groups: groups,
        kpis: kpis
    };
}

function groupOf(ruleId) {
    if (ruleId.startsWith('OP-') || ruleId.startsWith('CS-') || ruleId.startsWith('PEN-') || ruleId.startsWith('CO-')) {
        return 'Vận hành';
    }
    if (ruleId.startsWith('BR-')) return 'Thương hiệu';
    if (ruleId.startsWith('CAT-')) return 'Danh mục';
    if (ruleId.startsWith('SC-')) return 'Quy mô';
    return 'Vận hành';
}



function calcGroups(kpis) {
    const groups = {};
    ['Vận hành', 'Thương hiệu', 'Danh mục', 'Quy mô'].forEach(g => {
        const items = kpis.filter(k => normalizeGroupName(k.group) === g);
        const wsum = items.reduce((s, k) => s + (k.weight_final || 0), 0);
        const contrib = items.reduce((s, k) => s + k.score * (k.weight_final || 0), 0);
        groups[g] = { score: wsum > 0 ? contrib / wsum : 0, contribution: contrib };
    });
    return groups;
}

function bestEffortShopInfo(local) {
    const shopRaw = localStorage.getItem('shop_info');
    let shopInfo = null;

    if (shopRaw) {
        try { shopInfo = JSON.parse(shopRaw); } catch { shopInfo = null; }
    }

    const shopName = shopInfo?.shop_name || local?.shop_name || local?.shop?.shop_name;
    const shopId = shopInfo?.shop_id || local?.shop_id || local?.shop?.shop_id;

    return { shop_name: shopName || '—', shop_id: shopId || '—' };
}


function normalizeTier(rawTier, score) {
    const t = String(rawTier || '').trim().toLowerCase();
    if (t === 'not ready' || t === 'not_ready') return 'NOT_READY';
    if (t === 'partially ready' || t === 'partially_ready') return 'PARTIALLY_READY';
    if (t === 'near mall-ready' || t === 'near_mall_ready') return 'NEAR_MALL_READY';
    if (t === 'mall-ready' || t === 'mall_ready') return 'MALL_READY';
    if (['NOT_READY', 'PARTIALLY_READY', 'NEAR_MALL_READY', 'MALL_READY'].includes(rawTier)) return rawTier;

    // Tính từ điểm
    if (score < 50) return 'NOT_READY';
    if (score <= 69) return 'PARTIALLY_READY';
    if (score <= 84) return 'NEAR_MALL_READY';
    return 'MALL_READY';
}
function renderTrendChart() {
    const container = $('trendChart');
    if (!container) return;

    const historyRaw = localStorage.getItem('assessment_history');
    let history = [];

    if (historyRaw) {
        try { history = JSON.parse(historyRaw); } catch { history = []; }
    }

    if (!Array.isArray(history) || history.length === 0) {
        container.innerHTML = `
      <div class="trend-empty">
        <div class="trend-empty-icon">📊</div>
        <h4>Chưa có dữ liệu xu hướng</h4>
        <p>Thực hiện nhiều lần đánh giá để xem xu hướng điểm số.</p>
      </div>
    `;
        return;
    }

    const width = container.offsetWidth || 520;
    const height = 200;
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const maxScore = 100;
    const recent = history.slice(-10);

    const points = recent.map((h, i) => {
        const total = Number(h.totalScore ?? 0);
        const x = padding + (i / ((recent.length - 1) || 1)) * chartWidth;
        const y = padding + chartHeight - (Math.max(0, Math.min(100, total)) / maxScore) * chartHeight;
        return { x, y, score: total };
    });

    const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

    container.innerHTML = `
    <svg width="${width}" height="${height}" style="overflow: visible;">
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="var(--duong-ke)" stroke-width="2"/>
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="var(--duong-ke)" stroke-width="2"/>
      <path d="${pathData}" fill="none" stroke="var(--cam)" stroke-width="3" stroke-linejoin="round"/>
      ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="5" fill="var(--cam)"/>`).join('')}
      ${points.map(p => `<text x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="12" fill="var(--chu-phu)">${Math.round(p.score)}</text>`).join('')}
    </svg>
  `;
}

// ========================
// RENDER DASHBOARD
// ========================
function renderDashboard() {
    if (!assessmentData) return;

    allKpis = (assessmentData.kpis || []).map(k => {
        const pid = normalizeKpiId(k);
        const g = normalizeGroupName(k.group) || groupOf(pid);
        return {
            ...k,
            rule_id: pid || k.rule_id,
            kpiId: pid || k.kpiId,
            group: g,
            score: Number(k.score ?? 0),
            weight_final: Number(k.weight_final ?? k.weightFinal ?? k.Weight_Final ?? k.WEIGHT_FINAL ?? k.weight ?? k.wf ?? 0),
        };
    });



    // ✅ Enrich meta từ recommendation.js (nếu breakdown thiếu direction/t1/t2/method)
    allKpis = enrichKpisWithRecMeta(allKpis);
    // Ensure group aggregation is always correct even when local payload lacks `groups`
    assessmentData.groups = calcGroups(allKpis);

    renderSidebar();
    renderGateWarning();
    renderInsightCards();
    renderGroupChart();
    renderPareto();
    renderScoreDist();
    renderTrendChart();
    renderFixlist();
    renderPriorityMap();
    renderKpiTable();

    setupEventListeners();
}

// ========================
// INSIGHT CARDS
// ========================
function renderInsightCards() {
    const topDragBody = $('insightTopDragBody');
    const gateRiskBody = $('insightGateRiskBody');
    const weakestGroupBody = $('insightWeakestGroupBody');
    const coverageBody = $('insightCoverageBody');
    if (!topDragBody && !gateRiskBody && !weakestGroupBody) return;

    const { items: fixItems, top20Threshold } = buildFixlist(allKpis);

    // Card 1: Top KPI kéo tụt readiness
    if (topDragBody) {
        const top3 = [...fixItems].sort((a, b) => b.impactGap - a.impactGap).slice(0, 3);
        if (!top3.length) {
            topDragBody.innerHTML = '<div style="color: var(--chu-phu);">Không có dữ liệu KPI.</div>';
        } else {
            topDragBody.innerHTML = top3.map(it => {
                const pid = it.kpiId;
                const prio = priorityOf(pid, it, top20Threshold).toLowerCase();
                const badge = `<span class="badge ${prio}">${prio.toUpperCase()}</span>`;
                return `
          <div class="kpi-pill" data-kpi="${pid}">
            <div class="kpi-pill-left">
              <div class="kpi-pill-id">${pid} ${badge}</div>
              <div class="kpi-pill-meta">${it.group || groupOf(pid)} • Score: ${Number(it.score ?? 0)}</div>
            </div>
            <div class="kpi-pill-right">
              <div class="kpi-pill-impact">ImpactGap</div>
              <div style="font-weight: 900; font-size: 13px;">${it.impactGap.toFixed(4)}</div>
            </div>
          </div>`;
            }).join('');
        }
    }

    // Card 2: Gate Risk
    if (gateRiskBody) {
        const gate = assessmentData?.gate || {};
        const status = (gate.status || 'PASS').toUpperCase();
        let html = '';

        if (status === 'HARD_FAIL' || status === 'FAIL' || status === 'HARD_KO_FAILED') {
            html = `<div class="kpi-pill" style="cursor: default;">
              <div class="kpi-pill-left">
                <div class="kpi-pill-id">Hard KO Failed <span class="badge p0 gate">P0</span></div>
                <div class="kpi-pill-meta">MRSM bị block (Final = 0) cho đến khi xử lý KO</div>
              </div>
            </div>`;
        } else if (status === 'SOFT_PENDING' || status === 'SOFT_KO_PENDING') {
            const computedAt = assessmentData?.evaluated_at;
            const daysLeft = calcSoftKoDaysLeft(computedAt);
            const label = daysLeft < 0 ? 'Soft KO Overdue' : `Soft KO Pending • còn ${daysLeft} ngày`;
            html = `<div class="kpi-pill" style="cursor: default;">
              <div class="kpi-pill-left">
                <div class="kpi-pill-id">${label} <span class="badge p0 gate">P0</span></div>
                <div class="kpi-pill-meta">Cửa sổ khắc phục 7 ngày theo thesis</div>
              </div>
            </div>`;
        } else {
            html = `<div class="kpi-pill" style="cursor: default;">
              <div class="kpi-pill-left">
                <div class="kpi-pill-id">Gate: Passed <span class="badge p2 gate">OK</span></div>
                <div class="kpi-pill-meta">Đủ điều kiện tính MRSM theo weighted sum</div>
              </div>
            </div>`;
        }

        gateRiskBody.innerHTML = html;
    }

    // Card 3: Nhóm yếu nhất
    if (weakestGroupBody) {
        const groups = assessmentData?.groups || {};
        const entries = Object.entries(groups)
            .map(([g, v]) => ({ group: g, score: Number(v?.score ?? 0) }))
            .filter(x => !Number.isNaN(x.score));
        if (!entries.length) {
            weakestGroupBody.innerHTML = '<div style="color: var(--chu-phu);">Chưa có điểm nhóm.</div>';
        } else {
            entries.sort((a, b) => a.score - b.score);
            const worst = entries[0];
            weakestGroupBody.innerHTML = `
        <div class="kpi-pill" style="cursor: default;">
          <div class="kpi-pill-left">
            <div class="kpi-pill-id">${groupIcon(worst.group)} ${worst.group}</div>
            <div class="kpi-pill-meta">Điểm trung bình theo weight trong nhóm</div>
          </div>
          <div class="kpi-pill-right">
            <div class="kpi-pill-impact">Score</div>
            <div style="font-weight: 900; font-size: 18px;">${worst.score.toFixed(1)}%</div>
          </div>
        </div>`;
        }
    }
    // Card 4: KPI Coverage
    if (coverageBody) {
        const expected = 19; // theo thesis
        const have = Array.isArray(allKpis) ? allKpis.length : 0;

        // count KPI có value hợp lệ (0 vẫn tính)
        const withValue = allKpis.filter(k => {
            const v = (k.value !== undefined) ? k.value : extractValue(k);
            return (v === 0 || v === false) ? true : (v !== null && v !== undefined && String(v).trim() !== '');
        }).length;

        const coverage = expected ? Math.round((have / expected) * 100) : 0;
        const valueCoverage = expected ? Math.round((withValue / expected) * 100) : 0;

        coverageBody.innerHTML = `
    <div class="kpi-pill" style="cursor: default;">
      <div class="kpi-pill-left">
        <div class="kpi-pill-id">Coverage: ${have}/${expected} (${coverage}%)</div>
        <div class="kpi-pill-meta">Có dữ liệu value: ${withValue}/${expected} (${valueCoverage}%)</div>
      </div>
    </div>
  `;
    }

    // Click pill -> open recommendation
    document.querySelectorAll('.kpi-pill[data-kpi]').forEach(el => {
        el.addEventListener('click', () => {
            const kpiId = el.getAttribute('data-kpi');
            openKpiModal(kpiId);
        });
    });
}

function calcSoftKoDaysLeft(computedAtIso) {
    try {
        const t = new Date(computedAtIso).getTime();
        if (!t) return 7;
        const daysSince = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
        return 7 - daysSince;
    } catch {
        return 7;
    }
}

function groupIcon(groupName) {
    const g = (groupName || '').toLowerCase();
    if (g.includes('vận hành')) return '⚙️';
    if (g.includes('thương hiệu')) return '🏷️';
    if (g.includes('danh mục')) return '🧾';
    if (g.includes('quy mô')) return '📦';
    return '📌';
}

// ========================
// RENDER SIDEBAR
// ========================

function renderSidebar() {
    if (!assessmentData) return;

    const gate = assessmentData.gate || {};
    const isPass = gate.status === 'PASS';

    // Final score: nếu chưa pass gate thì hiển thị 0 theo thesis
    const finalScore = isPass ? Number(assessmentData.mrsm?.final_score ?? 0) : 0;

    // Tier: nếu chưa pass gate thì hiển thị GATE_BLOCKED
    const tier = isPass ? (assessmentData.mrsm?.tier || normalizeTier(null, finalScore)) : 'GATE_BLOCKED';

    // ===== Donut arc =====
    const circumference = 2 * Math.PI * 85;
    const offset = circumference - (finalScore / 100) * circumference;

    const arc = $('scoreArc');
    if (arc) arc.style.strokeDashoffset = String(offset);

    // ===== Score text =====
    const scoreDisplay = $('totalScoreDisplay');
    if (scoreDisplay) scoreDisplay.textContent = String(Math.round(finalScore));

    // ===== Tier badge + note =====
    const tierBadge = $('tierBadge');
    const tierNote = $('tierNote');
    const tierMeta = getTierMeta(tier);

    if (tierBadge) {
        tierBadge.textContent = tierMeta.label;
        tierBadge.className = 'tier-badge ' + tierMeta.cls;
    }
    if (tierNote) {
        tierNote.textContent = tierMeta.note;
    }

    // ===== Gate status badge =====
    const gateStatus = $('gateStatus');
    const gateMeta = getGateMeta(gate.status);

    if (gateStatus) {
        gateStatus.innerHTML = `
            <div class="gate-badge ${gateMeta.cls}">${gateMeta.icon} ${gateMeta.text}</div>
            <p class="gate-description">${gateMeta.desc}</p>
        `;
    }

    // ===== Shop info =====
    const shopNameEl = $('shopName');
    const shopIdEl = $('shopId');
    const computedAtEl = $('computedAt');
    const assessmentIdEl = $('assessmentId');

    if (shopNameEl) shopNameEl.textContent = assessmentData.shop?.shop_name || '—';
    if (shopIdEl) shopIdEl.textContent = assessmentData.shop?.shop_id || '—';
    if (computedAtEl) computedAtEl.textContent = formatDateTime(assessmentData.evaluated_at);
    if (assessmentIdEl) assessmentIdEl.textContent = assessmentData.assessment_id || '—';
}

function getTierMeta(tier) {
    const map = {
        'MALL_READY': { label: 'Đạt chuẩn Mall', cls: 'tier-ready', note: 'Đủ điều kiện tham gia Shopee Mall.' },
        'NEAR_MALL_READY': { label: 'Gần đạt chuẩn', cls: 'tier-near', note: 'Rất gần với tiêu chuẩn Mall — ưu tiên Fixlist.' },
        'PARTIALLY_READY': { label: 'Sẵn sàng một phần', cls: 'tier-partial', note: 'Có nền tảng nhưng chưa đủ chuẩn.' },
        'NOT_READY': { label: 'Chưa sẵn sàng', cls: 'tier-not-ready', note: 'Cần cải thiện toàn diện.' },
        'GATE_BLOCKED': { label: 'Bị chặn', cls: 'tier-not-ready', note: 'Bị chặn bởi điều kiện — điểm tổng = 0.' }
    };
    return map[tier] || { label: tier, cls: 'tier-not-ready', note: '' };
}

function getGateMeta(status) {
    const map = {
        'PASS': { text: 'Đạt', cls: 'pass', icon: '✅', desc: 'Tất cả điều kiện đều đạt.' },
        'G0': { text: 'Bị chặn (Hard KO)', cls: 'blocked', icon: '⛔', desc: 'Hard KO bị fail — cần khắc phục ngay.' },
        'G1': { text: 'Trong hạn khắc phục', cls: 'pending', icon: '⏳', desc: 'Soft KO trong hạn 7 ngày khắc phục.' },
        'G2': { text: 'Quá hạn khắc phục', cls: 'blocked', icon: '⏰', desc: 'Soft KO đã quá hạn — cần xử lý gấp.' }
    };
    return map[status] || { text: status || '—', cls: 'pending', icon: 'ℹ️', desc: '' };
}

function formatDateTime(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        return d.toLocaleString('vi-VN', { hour12: false });
    } catch {
        return iso;
    }
}

// ========================
// RENDER GATE WARNING
// ========================
function renderGateWarning() {
    const gate = assessmentData.gate || {};
    const warning = $('gateWarning');
    const warningText = $('gateWarningText');

    if (gate.status !== 'PASS') {
        if (warning) warning.style.display = 'flex';
        if (warningText) {
            let text = 'Điểm tổng bị đặt về 0 do chưa đạt điều kiện. ';
            if (gate.status === 'G0') {
                text += 'Cần hoàn thành Hard KO trước khi tính điểm.';
            } else if (gate.status === 'G1' || gate.status === 'G2') {
                text += 'Cần hoàn thành Soft KO trong hạn 7 ngày.';
            }
            warningText.textContent = text;
        }
    } else {
        if (warning) warning.style.display = 'none';
    }
}

/// ========================
// RENDER GROUP CHART (BEAUTIFIED)
// ========================
function renderGroupChart() {
    const groups = assessmentData?.groups || calcGroups(allKpis);
    const container = $('groupChart');
    if (!container || !groups) return;

    const groupOrder = ['Vận hành', 'Thương hiệu', 'Danh mục', 'Quy mô'];
    const weights = { 'Vận hành': 0.50, 'Thương hiệu': 0.20, 'Danh mục': 0.10, 'Quy mô': 0.15 };
    const maxScore = 100;

    const rows = groupOrder.map(name => {
        const v = Number(groups?.[name]?.score ?? 0);
        const score = Math.max(0, Math.min(100, isFinite(v) ? v : 0));
        return { name, score, w: weights[name] ?? 0 };
    });

    // weakest group
    let weakest = rows[0];
    for (const r of rows) if (r.score < weakest.score) weakest = r;

    const chipsHtml = rows.map(r => `
    <div class="gc-chip ${r.name === weakest.name ? 'weak' : ''}">
      <span class="dot"></span>
      ${r.name}: ${Math.round(r.score)}%
      <span class="muted">• w ${(r.w * 100).toFixed(0)}%</span>
    </div>
  `).join('');

    const barsHtml = rows.map(r => {
        const isWeak = r.name === weakest.name;
        return `
      <div class="gc-col">
        <div class="gc-track">
        <div class="gc-fill ${isWeak ? 'weak' : ''}" style="--h:${r.score}%"
               data-name="${r.name}" data-score="${r.score}" data-weight="${r.w}">
            <div class="gc-value">${Math.round(r.score)}%</div>
          </div>
        </div>
        <div class="gc-x">
          <div class="gc-x-name">${r.name}</div>
          <div class="gc-x-sub">w ${(r.w * 100).toFixed(0)}%</div>
        </div>
      </div>
    `;
    }).join('');

    container.innerHTML = `
    <div class="gc-wrap">
      <div class="gc-head">
        <div class="gc-title">
          <div class="gc-icon">📌</div>
          <div>
            <div class="gc-h">So sánh điểm 4 nhóm</div>
            <div class="gc-sub">Gridline + Highlight nhóm yếu nhất + Tooltip</div>
          </div>
        </div>
        <div class="gc-chips">${chipsHtml}</div>
      </div>

      <div class="gc-area">
        <div class="gc-grid">
          ${[100, 80, 60, 40, 20, 0].map(t => `<div class="gc-gridline" data-tick="${t}"></div>`).join('')}
        </div>

        <div class="gc-bars">${barsHtml}</div>

        <div class="gc-tooltip" id="gcTip"></div>
      </div>

      <div class="gc-legend">
        <span>✅ Cao hơn = tốt hơn</span>
        <span>🔻 Weakest group: <b>${weakest.name}</b></span>
      </div>
    </div>
  `;

    // Tooltip
    const tip = container.querySelector('#gcTip');
    const area = container.querySelector('.gc-area');
    const fills = container.querySelectorAll('.gc-fill');

    const show = (e, name, score, w) => {
        if (!tip || !area) return;
        const rect = area.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        tip.innerHTML = `
      <div><b>${name}: ${Math.round(score)}%</b></div>
      <div class="muted">Weight: ${(w * 100).toFixed(0)}% • Gap: ${(100 - score).toFixed(0)}%</div>
    `;
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
        tip.classList.add('show');
    };

    const hide = () => tip?.classList.remove('show');

    fills.forEach(el => {
        el.addEventListener('mousemove', (e) => {
            const name = el.dataset.name;
            const score = Number(el.dataset.score || 0);
            const w = Number(el.dataset.weight || 0);
            show(e, name, score, w);
        });
        el.addEventListener('mouseleave', hide);
    });

    // hide tooltip if mouse leaves area
    area?.addEventListener('mouseleave', hide);
}

// ========================
// RENDER FIXLIST
// ========================
function renderFixlist() {
    const container = $('fixlist');
    if (!container) return;

    const { items: fixItems } = buildFixlist(allKpis);
    const items = fixItems.slice(0, 8);

    if (!items.length) {
        container.innerHTML = '<p style="color: var(--chu-phu); text-align: center;">Không có mục cần khắc phục.</p>';
        return;
    }

    container.innerHTML = items.map(item => {
        const pid = item.kpiId;
        const prio = (item.priority || 'P2').toLowerCase();
        const gateBadge = item.gateType !== 'NONE' ? `<span class="badge p0 gate">${item.gateType}</span>` : '';
        return `
      <div class="fixlist-item" data-kpi="${pid}" style="cursor:pointer;">
        <div class="fixlist-priority ${prio}">${(item.priority || 'P2').toUpperCase()}</div>
        <div class="fixlist-content">
          <div class="fixlist-title">
            <span class="mono">${pid}</span>
            • ${groupIcon(item.group)} ${item.group || groupOf(pid)}
            ${gateBadge}
          </div>
          <div class="fixlist-desc">Score: ${Number(item.score ?? 0)} • Effort: ${Number(item.effort ?? 0)} • ImpactGap: <b>${item.impactGap.toFixed(4)}</b></div>
        </div>
      </div>
    `;
    }).join('');

    // click open modal
    container.querySelectorAll('.fixlist-item[data-kpi]').forEach(el => {
        el.addEventListener('click', () => openKpiModal(el.getAttribute('data-kpi')));
    });
}
// ========================
// PARETO CHART (ImpactGap) - SVG only (beautified + consistent font)
// ========================
function renderPareto() {
    const container = $('paretoChart');
    if (!container) return;

    const gate = assessmentData?.gate || {};
    const isPass = (gate.status || 'PASS') === 'PASS';

    const { items: fixItems } = buildFixlist(allKpis);

    const topN = 10;
    const data = [...fixItems]
        .filter(d => Number(d.impactGap ?? 0) > 0)
        .sort((a, b) => b.impactGap - a.impactGap)
        .slice(0, topN);

    if (!data.length) {
        container.innerHTML = `
      <div class="trend-empty">
        <div class="trend-empty-icon">📊</div>
        <h4>Chưa có dữ liệu Pareto</h4>
        <p>ImpactGap = (100 - Score) × Weight_Final.</p>
      </div>`;
        return;
    }

    // ====== Style tokens (force consistent font in SVG) ======
    const FONT = `system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
    const C_TEXT = 'var(--chu)';
    const C_MUTED = 'var(--chu-phu)';
    const C_GRID = 'var(--duong-ke)';
    const C_LINE = 'var(--xanh)';

    // ====== Layout ======
    const width = container.clientWidth || 760;
    const height = 300;

    const padL = 64;
    const padR = 72;   // ✅ right room for "Cum %" axis notes
    const padT = 18;
    const padB = 78;   // ✅ more room for x labels (avoid overlap)

    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const maxY = Math.max(...data.map(d => Number(d.impactGap ?? 0)), 0.0001);
    const sum = data.reduce((s, d) => s + Number(d.impactGap ?? 0), 0.0001);

    // cumulative
    let acc = 0;
    const series = data.map(d => {
        acc += Number(d.impactGap ?? 0);
        return { ...d, cum: acc / sum };
    });

    const n = series.length;
    const gap = Math.max(10, Math.floor(plotW * 0.04));
    const barW = Math.max(20, Math.floor((plotW - gap * (n - 1)) / n));

    const xAt = (i) => padL + i * (barW + gap) + barW / 2;
    const barX = (i) => padL + i * (barW + gap);
    const yBar = (v) => padT + plotH - (v / maxY) * plotH;
    const yCum = (p) => padT + plotH - p * plotH;

    // grid
    const yTicks = 4;
    const grid = Array.from({ length: yTicks + 1 }).map((_, i) => {
        const t = i / yTicks;
        const y = padT + plotH - t * plotH;
        const val = (t * maxY);
        return `
      <line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${C_GRID}" stroke-width="1" opacity="0.9"/>
      <text x="${padL - 10}" y="${y + 4}" text-anchor="end"
            font-family="${FONT}" font-size="11" fill="${C_MUTED}" font-weight="700">${val.toFixed(3)}</text>
    `;
    }).join('');

    // 80% line
    const y80 = yCum(0.8);

    // bars
    const bars = series.map((d, i) => {
        const v = Number(d.impactGap ?? 0);
        const h = (v / maxY) * plotH;
        const x = barX(i);
        const y = padT + plotH - h;

        const pr = (d.priority || 'P2').toLowerCase();
        const fill = pr === 'p0' ? 'var(--nguy-hiem)' : (pr === 'p1' ? 'var(--canh-bao)' : 'var(--cam)');

        const label = String(d.kpiId || d.rule_id || '—');

        // ✅ x label: rotate -25deg to avoid overlap
        const lx = x + barW / 2;
        const ly = padT + plotH + 26;

        return `
      <g class="pareto-bar" data-kpi="${label}" style="cursor:pointer;">
        <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="12" fill="${fill}" opacity="0.92"></rect>
        <text x="${lx}" y="${ly}" text-anchor="middle"
              font-family="${FONT}" font-size="11" fill="${C_TEXT}" font-weight="800"
              transform="rotate(-25 ${lx} ${ly})">${label}</text>
      </g>
    `;
    }).join('');

    // cum line
    const linePath = series.map((d, i) => {
        const x = xAt(i);
        const y = yCum(d.cum);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    const dots = series.map((d, i) => {
        const x = xAt(i);
        const y = yCum(d.cum);
        return `<circle cx="${x}" cy="${y}" r="4" fill="${C_LINE}" opacity="0.95"></circle>`;
    }).join('');

    container.innerHTML = `
    <div style="position:relative;">
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Pareto ImpactGap"
           style="font-family:${FONT};">
        <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" rx="14"></rect>

        ${grid}

        <!-- plot border -->
        <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" stroke="${C_GRID}" stroke-width="2"></rect>

        <!-- 80% reference -->
        <line x1="${padL}" y1="${y80}" x2="${padL + plotW}" y2="${y80}" stroke="${C_LINE}" stroke-width="2"
              stroke-dasharray="6 6" opacity="0.7"></line>

        <!-- bars -->
        ${bars}

        <!-- cum line -->
        <path d="${linePath}" fill="none" stroke="${C_LINE}" stroke-width="3" stroke-linejoin="round"></path>
        ${dots}

        <!-- right labels (avoid overlap) -->
        <text x="${padL + plotW + 10}" y="${padT + 12}" text-anchor="start"
              font-family="${FONT}" font-size="11" fill="${C_LINE}" font-weight="900">Cumulative %</text>
        <text x="${padL + plotW + 10}" y="${y80 + 4}" text-anchor="start"
              font-family="${FONT}" font-size="11" fill="${C_LINE}" font-weight="900">80%</text>

        <!-- axis labels -->
        <text x="${padL + plotW / 2}" y="${height - 10}" text-anchor="middle"
              font-family="${FONT}" font-size="12" fill="${C_TEXT}" font-weight="800">
          Top KPI theo ImpactGap (cao → kéo tụt nhiều)
        </text>
        <text x="18" y="${padT + plotH / 2}" text-anchor="middle"
              font-family="${FONT}" font-size="12" fill="${C_TEXT}" font-weight="800"
              transform="rotate(-90 18 ${padT + plotH / 2})">ImpactGap</text>
      </svg>

      <div id="paretoTip" class="gc-tooltip" style="z-index:60;"></div>

      <div style="display:flex;justify-content:space-between;gap:10px;margin-top:10px;color:var(--chu-phu);font-weight:800;font-size:12px;">
        <span>${isPass ? '✅ Gate PASS: ImpactGap phản ánh đúng “kéo tụt readiness”.' : '⚠️ Gate chưa PASS: Chart vẫn cho thấy KPI cần ưu tiên.'}</span>
        <span>ImpactGap = (100 − Score) × Weight_Final</span>
      </div>
    </div>
  `;

    // Tooltip + click open modal
    const tip = $('paretoTip');

    const show = (e, html) => {
        if (!tip) return;
        const rect = container.getBoundingClientRect();
        tip.innerHTML = html;
        tip.style.left = `${e.clientX - rect.left}px`;
        tip.style.top = `${e.clientY - rect.top}px`;
        tip.classList.add('show');
    };
    const hide = () => tip?.classList.remove('show');

    container.querySelectorAll('.pareto-bar[data-kpi]').forEach(el => {
        const id = el.getAttribute('data-kpi');
        const item = series.find(x => String(x.kpiId || x.rule_id).toUpperCase() === String(id).toUpperCase());
        el.addEventListener('mousemove', (e) => {
            const ig = Number(item?.impactGap ?? 0);
            const sc = Number(item?.score ?? 0);
            const w = Number(item?.weight_final ?? item?.weight ?? 0);
            const pr = item?.priority || 'P2';
            show(e, `
        <div><b>${escapeHtml(id)} • ${escapeHtml(pr)}</b></div>
        <div class="muted">Score: ${Math.round(sc)} • Weight: ${(w * 100).toFixed(2)}%</div>
        <div class="muted">ImpactGap: ${ig.toFixed(4)}</div>
      `);
        });
        el.addEventListener('mouseleave', hide);
        el.addEventListener('click', () => openKpiModal(id));
    });

    container.addEventListener('mouseleave', hide);
}


// ========================
// SCORE DISTRIBUTION (0/50/100) - SVG only (beautified + consistent font)
// ========================
function renderScoreDist() {
    const container = $('distChart');
    if (!container) return;

    const kpis = Array.isArray(allKpis) ? allKpis : [];
    if (!kpis.length) {
        container.innerHTML = `
      <div class="trend-empty">
        <div class="trend-empty-icon">🧮</div>
        <h4>Chưa có dữ liệu phân bố</h4>
        <p>Hãy đảm bảo breakdown KPI đã được lưu.</p>
      </div>`;
        return;
    }

    const buckets = [
        { key: '0', label: '0', value: 0 },
        { key: '50', label: '50', value: 0 },
        { key: '100', label: '100', value: 0 },
        { key: 'other', label: 'Other', value: 0 },
    ];

    for (const k of kpis) {
        const s = Number(k.score ?? 0);
        if (s === 0) buckets[0].value++;
        else if (s === 50) buckets[1].value++;
        else if (s === 100) buckets[2].value++;
        else buckets[3].value++;
    }

    const total = buckets.reduce((s, b) => s + b.value, 0) || 1;

    const FONT = `system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
    const C_TEXT = 'var(--chu)';
    const C_MUTED = 'var(--chu-phu)';
    const C_GRID = 'var(--duong-ke)';

    const width = container.clientWidth || 760;
    const height = 260;

    const padL = 64;
    const padR = 20;
    const padT = 18;
    const padB = 72; // ✅ more room for x + % labels

    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const maxY = Math.max(...buckets.map(b => b.value), 1);

    const n = buckets.length;
    const gap = 18;
    const barW = Math.max(38, Math.floor((plotW - gap * (n - 1)) / n));

    const x0 = (i) => padL + i * (barW + gap);
    const yBar = (v) => padT + plotH - (v / maxY) * plotH;
    const hBar = (v) => (v / maxY) * plotH;

    const yTicks = 4;
    const grid = Array.from({ length: yTicks + 1 }).map((_, i) => {
        const t = i / yTicks;
        const y = padT + plotH - t * plotH;
        const val = Math.round(t * maxY);
        return `
      <line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${C_GRID}" stroke-width="1" opacity="0.9"/>
      <text x="${padL - 10}" y="${y + 4}" text-anchor="end"
            font-family="${FONT}" font-size="11" fill="${C_MUTED}" font-weight="700">${val}</text>
    `;
    }).join('');

    const colors = {
        '0': 'var(--nguy-hiem)',
        '50': 'var(--canh-bao)',
        '100': 'var(--tot)',
        'other': 'var(--xanh)'
    };

    const bars = buckets.map((b, i) => {
        const x = x0(i);
        const y = yBar(b.value);
        const h = hBar(b.value);
        const pct = (b.value / total) * 100;

        const cx = x + barW / 2;

        return `
      <g>
        <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="12" fill="${colors[b.key]}" opacity="0.92"></rect>

        <!-- count on top (safe, not clipped) -->
        <text x="${cx}" y="${Math.max(14, y - 8)}" text-anchor="middle"
              font-family="${FONT}" font-size="12" fill="${C_TEXT}" font-weight="900">${b.value}</text>

        <!-- label + % below -->
        <text x="${cx}" y="${padT + plotH + 24}" text-anchor="middle"
              font-family="${FONT}" font-size="12" fill="${C_TEXT}" font-weight="900">${b.label}</text>
        <text x="${cx}" y="${padT + plotH + 42}" text-anchor="middle"
              font-family="${FONT}" font-size="11" fill="${C_MUTED}" font-weight="800">${pct.toFixed(0)}%</text>
      </g>
    `;
    }).join('');

    container.innerHTML = `
    <div style="position:relative;">
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Score distribution"
           style="font-family:${FONT};">
        <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" rx="14"></rect>

        ${grid}

        <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" stroke="${C_GRID}" stroke-width="2"></rect>

        ${bars}

        <text x="${padL + plotW / 2}" y="${height - 10}" text-anchor="middle"
              font-family="${FONT}" font-size="12" fill="${C_TEXT}" font-weight="800">
          Số KPI theo thang điểm rulebook (0/50/100)
        </text>
        <text x="18" y="${padT + plotH / 2}" text-anchor="middle"
              font-family="${FONT}" font-size="12" fill="${C_TEXT}" font-weight="800"
              transform="rotate(-90 18 ${padT + plotH / 2})">Count</text>
      </svg>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;color:var(--chu-phu);font-weight:800;font-size:12px;">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:var(--tot);margin-right:6px;"></span>100</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:var(--canh-bao);margin-right:6px;"></span>50</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:var(--nguy-hiem);margin-right:6px;"></span>0</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:var(--xanh);margin-right:6px;"></span>Other</span>
      </div>
    </div>
  `;
}

// ========================
// PRIORITY MAP (Impact × Effort)
// ========================
function renderPriorityMap() {
    const container = $('priorityMap');
    if (!container) return;

    const { items: fixItems } = buildFixlist(allKpis);
    const top = fixItems.slice(0, 10);
    if (!top.length) {
        container.innerHTML = '<div style="padding: 18px; color: var(--chu-phu);">Không có dữ liệu để vẽ Priority Map.</div>';
        return;
    }

    const width = container.clientWidth || 680;
    const height = 280;
    const pad = 44;
    const plotW = width - pad * 2;
    const plotH = height - pad * 2;

    const yMax = Math.max(0.0001, ...top.map(d => Number(d.impactGap ?? 0)));
    const yMin = 0;

    // Effort heuristic scale: 1..5 (we mostly use 2..3)
    const xMin = 1;
    const xMax = 5;

    const xScale = (e) => pad + ((Number(e ?? 0) - xMin) / (xMax - xMin)) * plotW;
    const yScale = (v) => pad + plotH - ((Number(v ?? 0) - yMin) / (yMax - yMin)) * plotH;

    const grid = [1, 2, 3, 4, 5].map(t => {
        const x = xScale(t);
        return `<line x1="${x}" y1="${pad}" x2="${x}" y2="${pad + plotH}" stroke="var(--duong-ke)" stroke-width="1" />
                <text x="${x}" y="${pad + plotH + 20}" text-anchor="middle" font-size="12" fill="var(--chu-phu)">${t}</text>`;
    }).join('');

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(p => yMin + p * (yMax - yMin));
    const yGrid = yTicks.map(v => {
        const y = yScale(v);
        return `<line x1="${pad}" y1="${y}" x2="${pad + plotW}" y2="${y}" stroke="var(--duong-ke)" stroke-width="1" />
                <text x="${pad - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="var(--chu-phu)">${v.toFixed(3)}</text>`;
    }).join('');

    const dots = top.map(d => {
        const x = xScale(d.effort);
        const y = yScale(d.impactGap);
        const cls = (d.priority || 'P2').toLowerCase();
        const color = cls === 'p0' ? 'var(--nguy-hiem)' : (cls === 'p1' ? 'var(--canh-bao)' : 'var(--xanh)');
        return `<g class="pm-dot" data-kpi="${d.kpiId}" style="cursor:pointer;">
            <circle cx="${x}" cy="${y}" r="7" fill="${color}" opacity="0.9" />
            <text x="${x}" y="${y - 10}" text-anchor="middle" font-size="11" fill="var(--chu)" font-weight="800">${d.kpiId}</text>
          </g>`;
    }).join('');

    const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Priority map">
        <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" />
        ${grid}
        ${yGrid}
        <rect x="${pad}" y="${pad}" width="${plotW}" height="${plotH}" fill="transparent" stroke="var(--duong-ke)" stroke-width="2" />
        <text x="${pad + plotW / 2}" y="${height - 8}" text-anchor="middle" font-size="12" fill="var(--chu)">Effort (1 thấp → 5 cao)</text>
        <text x="14" y="${pad + plotH / 2}" text-anchor="middle" font-size="12" fill="var(--chu)" transform="rotate(-90 14 ${pad + plotH / 2})">ImpactGap</text>
        ${dots}
      </svg>`;

    container.innerHTML = svg;

    container.querySelectorAll('.pm-dot[data-kpi]').forEach(el => {
        el.addEventListener('click', () => openKpiModal(el.getAttribute('data-kpi')));
    });
}

// ========================
// RENDER KPI TABLE
// ========================
function renderKpiTable() {
    renderTableRows(allKpis);
    renderMobileCards(allKpis);
}

function renderTableRows(kpis) {
    const tbody = $('kpiTableBody');
    if (!tbody) return;

    if (kpis.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--chu-phu)">Không có KPI.</td></tr>';
        return;
    }

    const gate = assessmentData.gate || {};
    const isPass = gate.status === 'PASS';

    const { items: fixItems } = buildFixlist(allKpis);
    const prioMap = new Map(fixItems.map(it => [it.kpiId, it]));

    const maxImpact = isPass
        ? Math.max(...allKpis.map(x => (100 - Number(x.score ?? 0)) * Number(x.weight_final ?? 0)), 1)
        : 1;

    const html = kpis.map(k => {
        const pid = normalizeKpiId(
            k.rule_id ?? k.Rule_ID ?? k.RuleID ?? k.KPI_ID ?? k.kpi_id ?? k.kpiId ?? k
        );
        const pr = prioMap.get(pid)?.priority || 'P2';
        const prCls = pr.toLowerCase();
        const score = Number(k.score ?? 0);
        const w = Number(k.weight_final ?? 0);
        const impact = isPass ? (100 - score) * w : 0;
        const impactPercent = isPass ? (impact / maxImpact) * 100 : 0;

        const scoreClass = score === 100 ? 'score-100' : (score === 50 ? 'score-50' : 'score-0');

        return `
        <tr data-kpi="${pid}">
            <td>
                <div style="display:flex;gap:8px;align-items:center">
                    <span class="kpi-id">${pid}</span>
                    <span class="badge ${prCls}">${pr}</span>
                </div>
            </td>
            <td class="kpi-name">${k.name}</td>
            <td>${groupIcon(k.group)} ${k.group}</td>
            <td><span class="kpi-score ${scoreClass}">${score}</span></td>
            <td>
                ${isPass ? `
                    <div class="impact-bar">
                        <div class="impact-bar-bg">
                            <div class="impact-bar-fill" style="width:${impactPercent}%"></div>
                        </div>
                        <span class="impact-value">${impact.toFixed(4)}</span>
                    </div>
                ` : '<b style="color:var(--nguy-hiem)">Bị chặn</b>'}
            </td>
            <td><button class="btn-rec" data-rec="${pid}">View Recommendation</button></td>
        </tr>`;
    }).join('');

    tbody.innerHTML = html;
}


function renderMobileCards(kpis) {
    const container = $('kpiCards');
    if (!container) return;

    if (kpis.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--chu-phu);">Không có KPI.</p>';
        return;
    }

    const { items: fixItems } = buildFixlist(allKpis);
    const prioMap = new Map(fixItems.map(it => [it.kpiId, it]));

    const html = kpis.map(k => {
        const pid = normalizeKpiId(
            k.rule_id ?? k.Rule_ID ?? k.RuleID ?? k.KPI_ID ?? k.kpi_id ?? k.kpiId ?? k
        );
        const pr = prioMap.get(pid)?.priority || 'P2';
        const prCls = pr.toLowerCase();
        const score = Number(k.score ?? 0);
        const scoreClass = score === 100 ? 'score-100' : (score === 50 ? 'score-50' : 'score-0');

        return `
      <div class="kpi-card" data-kpi="${pid}">
        <div class="kpi-card-header">
          <span class="kpi-id">${pid}</span>
          <span class="badge ${prCls}">${pr}</span>
          <span class="kpi-score ${scoreClass}">${score}</span>
        </div>
        <div class="kpi-card-body">
          <div style="font-weight: 700; color: var(--chu); margin-bottom: 4px;">${k.name}</div>
          <div style="font-size: 12px;">Nhóm: ${groupIcon(k.group)} ${k.group}</div>
          <div style="margin-top: 10px;">
            <button class="btn-rec" data-rec="${pid}" type="button" style="width:100%;">View Recommendation</button>
          </div>
        </div>
      </div>
    `;
    }).join('');

    container.innerHTML = html;
}

// ========================
// SEARCH & FILTER
// ========================
function setupEventListeners() {
    // Search
    const searchInput = $('searchKPI');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            filterKpis();
        });
    }

    // Filter
    const filterGroup = $('filterGroup');
    if (filterGroup) {
        filterGroup.addEventListener('change', () => {
            filterKpis();
        });
    }

    // Sort
    const sortHeader = document.querySelector('.sortable');
    if (sortHeader) {
        sortHeader.addEventListener('click', () => {
            sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
            filterKpis();
        });
    }

    // Click row để mở modal
    document.addEventListener('click', (e) => {
        // Dedicated recommendation button
        const recBtn = e.target.closest('button.btn-rec[data-rec]');
        if (recBtn) {
            e.preventDefault();
            e.stopPropagation();
            openKpiModal(recBtn.getAttribute('data-rec'));
            return;
        }

        const row = e.target.closest('tr[data-kpi]');
        if (row) {
            const kpiId = row.getAttribute('data-kpi');
            openKpiModal(kpiId);
        }

        const card = e.target.closest('.kpi-card[data-kpi]');
        if (card) {
            const kpiId = card.getAttribute('data-kpi');
            openKpiModal(kpiId);
        }
    });

    // Close modal
    const modalClose = $('modalClose');
    const modalOverlay = document.querySelector('.modal-overlay');
    if (modalClose) {
        modalClose.addEventListener('click', closeKpiModal);
    }
    if (modalOverlay) {
        modalOverlay.addEventListener('click', closeKpiModal);
    }

    // Export JSON
    const btnExport = $('btnExportJSON');
    if (btnExport) {
        btnExport.addEventListener('click', exportJSON);
    }

    // Navigation buttons
    const btnBackToResult = $('btnBackToResult');
    const btnBackToKPI = $('btnBackToKPI');

    if (btnBackToResult) {
        btnBackToResult.addEventListener('click', () => {
            const assessmentId = assessmentData?.assessment_id;
            const url = assessmentId ? `RESULTS.html?assessment_id=${encodeURIComponent(assessmentId)}` : 'RESULTS.html';
            window.location.href = url;
        });
    }

    if (btnBackToKPI) {
        btnBackToKPI.addEventListener('click', () => {
            window.location.href = 'KPI_SCORING.html';
        });
    }
}

function filterKpis() {
    const searchValue = ($('searchKPI')?.value || '').toLowerCase();
    const groupValue = $('filterGroup')?.value || '';

    let filtered = allKpis.filter(k => {
        const id = String(k.rule_id || '').toLowerCase();
        const name = String(k.name || '').toLowerCase();

        const matchSearch = !searchValue || id.includes(searchValue) || name.includes(searchValue);
        const matchGroup = !groupValue || k.group === groupValue;
        return matchSearch && matchGroup;
    });

    // Sort theo Impact (nếu Gate PASS)
    const gate = assessmentData.gate || {};
    const isPass = gate.status === 'PASS';

    if (isPass) {
        filtered.sort((a, b) => {
            const impactA = (100 - Number(a.score ?? 0)) * Number(a.weight_final ?? 0);
            const impactB = (100 - Number(b.score ?? 0)) * Number(b.weight_final ?? 0);
            return sortDirection === 'desc' ? impactB - impactA : impactA - impactB;
        });
    }

    renderTableRows(filtered);
    renderMobileCards(filtered);
}

// ========================
// MODAL CHI TIẾT KPI
// ========================
function openKpiModal(kpiId) {
    const target = String(kpiId || '').trim().toUpperCase();
    const kpi = allKpis.find(k => normalizeKpiId(k).trim().toUpperCase() === target);
    if (!kpi) return;
    renderRecommendationModal(target, kpi);
}


function closeKpiModal() {
    const modal = $('kpiModal');
    if (modal) modal.classList.remove('active');
}

// ========================
// MODAL RENDERER (Recommendation)
// ========================
function renderRecommendationModal(kpiIdRaw, kpiItem) {
    const kpiId = normalizeKpiId(kpiIdRaw || kpiItem);
    const modal = $('kpiModal');
    const modalTitle = $('modalTitle');
    const modalBody = $('modalBody');
    if (!modal || !modalBody) return;

    const rec = getRecommendation(kpiId);
    const group = kpiItem?.group || rec?.nhom || groupOf(kpiId);
    const gateType = detectGateType(kpiId, { ...kpiItem, ...(rec || {}) });

    const gateBadge = gateType === 'HARD_KO'
        ? `<span class="badge p0 gate">HARD_KO</span>`
        : (gateType === 'SOFT_KO'
            ? `<span class="badge p0 gate">SOFT_KO</span>`
            : `<span class="badge p2 gate">NONE</span>`);

    // ✅ (1) META CHIPS: phải tính trước để nhánh !rec cũng dùng được
    const impactGap = calcImpactGap(kpiItem);
    const score = Number(kpiItem?.score ?? 0);
    const w = Number(kpiItem?.weight_final ?? 0);
    const scoreChipCls = score >= 100 ? 'good' : (score >= 50 ? 'warn' : 'bad');

    const scoreBadge =
        score >= 100 ? `<span class="badge p2">PASS</span>` :
        (score >= 50 ? `<span class="badge p1">PARTIAL</span>` : `<span class="badge p0">FAIL</span>`);

    if (modalTitle) modalTitle.textContent = `${kpiId} • ${group}`;

    // ✅ (2) Insight luôn build từ actual (rec có thể null vẫn chạy được)
    const insight = buildInsightFromActual(kpiId, kpiItem, rec);

    // ✅ (3) Nếu KHÔNG có recommendation.js -> render tối giản + fallback + RETURN
    if (!rec) {
        modalBody.innerHTML = `
          <div class="modal-section">
            <div class="rec-head">
              <div class="rec-kpi">${kpiId}</div>
              <div class="rec-meta">${groupIcon(group)} ${escapeHtml(group)} ${scoreBadge} ${gateBadge}</div>
            </div>

            <div class="rec-meta" style="margin-top:10px;">
              <span class="chip ${scoreChipCls}">Score: ${score}</span>
              <span class="chip">WF: ${w.toFixed(3)}</span>
              <span class="chip">ImpactGap: ${impactGap.toFixed(4)}</span>
            </div>

            <div class="rec-kpi-grid">
              <div class="kpi-snap"><div class="k">HIỆN TẠI</div><div class="v">${escapeHtml(insight.hien_tai || '—')}</div></div>
              <div class="kpi-snap"><div class="k">MỤC TIÊU</div><div class="v">${escapeHtml(insight.muc_tieu || '—')}</div></div>
              <div class="kpi-snap"><div class="k">CHÊNH LỆCH</div><div class="v">${escapeHtml(insight.chenhlech || '—')}</div></div>
              <div class="kpi-snap"><div class="k">ĐÁNH GIÁ</div><div class="v">${escapeHtml(insight.danh_gia || '—')}</div></div>
            </div>

            <div class="rec-block" style="margin-top:12px;">
              <div class="rec-block-title">RECOMMENDATION</div>
              ${fallbackRecommendation(kpiId)}
            </div>

            <div class="rec-cta">
              <button class="btn-mini" type="button" onclick="navigator.clipboard.writeText('${kpiId}')">📋 Copy KPI</button>
              <button class="btn-mini primary" type="button" onclick="closeKpiModal()">Đóng</button>
            </div>
          </div>
        `;
        modal.classList.add('active');
        return; // ✅ cực quan trọng
    }

    // ======= (4) Nếu CÓ rec -> giữ nguyên phần bạn đã viết (actions/fixes/impact/warn) =======
    const actions = Array.isArray(rec.hanh_dong_uu_tien) ? rec.hanh_dong_uu_tien : [];
    const fixes = Array.isArray(rec.hanh_dong_khac_phuc) ? rec.hanh_dong_khac_phuc : [];
    const impact = rec.tac_dong_MRSM || {};
    const warn = rec.canh_bao || {};

    const insightHtml = `
      <div class="rec-block">
        <div class="rec-block-title">INSIGHT</div>
        <div class="rec-lines">
          <div class="rec-line"><span class="rec-k">Hiện tại:</span> <span class="rec-v">${escapeHtml(insight.hien_tai || '—')}</span></div>
          <div class="rec-line"><span class="rec-k">Mục tiêu:</span> <span class="rec-v">${escapeHtml(insight.muc_tieu || '—')}</span></div>
          <div class="rec-line"><span class="rec-k">Chênh lệch:</span> <span class="rec-v">${escapeHtml(insight.chenhlech || '—')}</span></div>
          <div class="rec-line"><span class="rec-k">Đánh giá:</span> <span class="rec-v">${escapeHtml(insight.danh_gia || '—')}</span></div>
        </div>
      </div>`;

    const actionHtml = `
      <div class="rec-block">
        <div class="rec-block-title">HÀNH ĐỘNG ƯU TIÊN</div>
        <div class="rec-list">
          ${actions.length ? actions.map(a => {
              const badges = [
                a.muc_tieu_ngan_han ? `<span class="badge p2">${escapeHtml(a.muc_tieu_ngan_han)}</span>` : '',
                a.thoi_gian ? `<span class="badge p1">⏱ ${escapeHtml(a.thoi_gian)}</span>` : '',
                a.bo_phan ? `<span class="badge p2">👥 ${escapeHtml(a.bo_phan)}</span>` : ''
              ].filter(Boolean).join(' ');
              return `
                <div class="rec-item">
                  <div class="rec-item-title">${escapeHtml(a.viec || '—')}</div>
                  <div class="rec-item-sub">${escapeHtml(a.chi_tiet_thuc_te || '')}</div>
                  <div class="rec-badges">${badges || '<span class="badge p2">—</span>'}</div>
                </div>`;
          }).join('') : `<div style="color: var(--chu-phu);">—</div>`}
        </div>
      </div>`;

    const fixHtml = `
      <div class="rec-block">
        <div class="rec-block-title">HÀNH ĐỘNG KHẮC PHỤC</div>
        <div class="rec-list">
          ${fixes.length ? fixes.slice(0, 2).map(f => `
            <div class="rec-item">
              <div class="rec-item-title">${escapeHtml(f.viec || '—')}</div>
              <div class="rec-item-sub">${escapeHtml(f.tac_dong_ky_vong || '')}</div>
            </div>`).join('') : `<div style="color: var(--chu-phu);">—</div>`}
        </div>
      </div>`;

    const impactHtml = `
      <div class="rec-block">
        <div class="rec-block-title">TÁC ĐỘNG MRSM</div>
        <div class="rec-lines">
          <div class="rec-line"><span class="rec-k">Nếu đạt:</span> <span class="rec-v">${escapeHtml(impact.neu_dat || '—')}</span></div>
          <div class="rec-line"><span class="rec-k">Lý do:</span> <span class="rec-v">${escapeHtml(impact.ly_do || '—')}</span></div>
        </div>
      </div>`;

    const warnHtml = `
      <div class="rec-block">
        <div class="rec-block-title">CẢNH BÁO</div>
        <div class="rec-lines">
          <div class="rec-line"><span class="rec-k">Deadline:</span> <span class="rec-v">${escapeHtml(warn.deadline || '—')}</span></div>
          <div class="rec-line"><span class="rec-k">Nếu không đạt:</span> <span class="rec-v">${escapeHtml(warn.neu_khong_dat || '—')}</span></div>
        </div>
      </div>`;

    modalBody.innerHTML = `
      <div class="modal-section">
        <div class="rec-head">
          <div class="rec-kpi">${kpiId}</div>
          <div class="rec-meta">${groupIcon(group)} ${escapeHtml(group)} ${scoreBadge} ${gateBadge}</div>
        </div>

        <div class="rec-meta" style="margin-top:10px;">
          <span class="chip ${scoreChipCls}">Score: ${score}</span>
          <span class="chip">WF: ${w.toFixed(3)}</span>
          <span class="chip">ImpactGap: ${impactGap.toFixed(4)}</span>
        </div>
      </div>

      ${insightHtml}
      ${actionHtml}
      ${fixHtml}
      ${impactHtml}
      ${warnHtml}
    `;

    modal.classList.add('active');
}


// simple sanitizer for modal rendering
function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ========================
// VALUE-AWARE INSIGHT BUILDER (OVERRIDE THEO LOGIC THESIS + RULEBOOK)
// - Mục tiêu: nhập đúng => PASS/FAIL đúng (không lệ thuộc text tĩnh recommendation.js)
// - Có tách riêng: (1) Gate soft KO vs (2) Scoring 0/50/100
// - Nếu breakdown thiếu direction/t1/t2/method => đã enrich từ recommendation.js
// ========================

const KPI_UNITS = {
    // Operation
    'OP-01': '%',
    'OP-02': '%',
    'OP-03': '%',
    'OP-04': '%',
    // CS
    'CS-01': '%',
    'CS-02': 'h',
    // Penalty
    'PEN-01': 'điểm',
    // Commercial/Compliance
    'CO-01': '%',
    // Category
    'CAT-01': '%',
    'CAT-03': '%',
    'CAT-04': '',
    // Brand
    'BR-01': '',
    'BR-02': '',
    'BR-03': '',
    // Scale
    'SC-01': 'triệu',
    'SC-02': 'đơn',
    'SC-03': '%'
};

// =========================
// (A) HELPERS: PARSE / FORMAT
// =========================

// ✅ parse số "lỏng": đọc được "96%", "195 đơn", "1h", "2,5"
function parseNumberLoose(v) {
    if (v === null || v === undefined || v === '') return NaN;
    if (typeof v === 'number') return v;
    const s = String(v).replace(',', '.');
    const m = s.match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : NaN;
}

// ✅ dữ liệu rỗng? (0/false vẫn là dữ liệu hợp lệ)
function isNonEmpty(v) {
    if (v === 0 || v === false) return true;
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'boolean') return true;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
}

function safeStr(v) {
    return String(v ?? '').trim();
}

// ✅ bool parser: chỉ parse rõ nghĩa (tránh numeric KPI bị hiểu nhầm)
function coerceBoolStrict(v) {
    if (v === true) return true;
    if (v === false) return false;
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return null;
    if (['true', 'yes', 'y', 'co', 'có', 'ok', 'pass'].includes(s)) return true;
    if (['false', 'no', 'n', 'khong', 'không', 'fail'].includes(s)) return false;
    return null;
}

// ✅ bool parser cho 0/1 (CHỈ dùng khi KPI là BINARY/BOOL)
function coerceBool01(v) {
    if (v === true) return true;
    if (v === false) return false;
    if (typeof v === 'number') {
        if (v === 1) return true;
        if (v === 0) return false;
    }
    const s = String(v ?? '').trim();
    if (s === '1') return true;
    if (s === '0') return false;
    return null;
}

function extractValue(item) {
    if (!item || typeof item !== 'object') return null;
    if (item.value !== undefined) return item.value;
    if (item.raw_value !== undefined) return item.raw_value;
    if (item.input !== undefined) return item.input;
    if (item.user_input !== undefined) return item.user_input;
    if (item.actual !== undefined) return item.actual;
    if (item.current !== undefined) return item.current;
    return null;
}

function trimNumber(n) {
    if (!Number.isFinite(n)) return '—';
    const s = String(n);
    if (s.includes('.')) return String(parseFloat(Number(n).toFixed(6))).replace(/\.0+$/, '');
    return s;
}

function formatVal(v, unit) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number' && Number.isFinite(v)) return `${trimNumber(v)}${unit ? ' ' + unit : ''}`.trim();
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (typeof v === 'object') {
        try { return JSON.stringify(v); } catch { return String(v); }
    }
    return `${String(v)}${unit ? ' ' + unit : ''}`.trim();
}

function fmtGap(n, unit) {
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    const val = abs % 1 === 0 ? String(abs) : String(parseFloat(abs.toFixed(2)));
    return `${val}${unit ? ' ' + unit : ''}`.trim();
}

function looksLikeDomain(s) {
    const x = safeStr(s).toLowerCase();
    if (!x) return false;
    // có dấu chấm + không có khoảng trắng
    if (!x.includes('.')) return false;
    if (/\s/.test(x)) return false;
    return true;
}

function looksLikeUrl(s) {
    const x = safeStr(s).toLowerCase();
    return x.startsWith('http://') || x.startsWith('https://');
}

function parseJsonLoose(v) {
    if (!v) return null;
    if (typeof v === 'object') return v;
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;
    if (!(s.startsWith('{') || s.startsWith('['))) return null;
    try { return JSON.parse(s); } catch { return null; }
}

function normalizeBR02Value(raw) {
    const obj = parseJsonLoose(raw) || (raw && typeof raw === 'object' ? raw : null);
    if (!obj) return null;

    const followers = obj.followers ?? obj.follower ?? obj.follow ?? obj.follow_count ?? obj.followers_count ?? obj.count ?? obj.so_followers ?? '';
    const postUrl = obj.postUrl ?? obj.post_url ?? obj.post ?? obj.url ?? obj.link ?? obj.postLink ?? '';

    return { followers, postUrl };
}

function makeInsight(hien_tai, muc_tieu, chenhlech, danh_gia) {
    return {
        hien_tai: hien_tai ?? '—',
        muc_tieu: muc_tieu ?? '—',
        chenhlech: chenhlech ?? '—',
        danh_gia: danh_gia ?? '—'
    };
}

// =========================
// (B) EVALUATOR RANGE (0/50/100)
// =========================

function evaluateRange(direction, x, t1, t2) {
    if (!Number.isFinite(x)) return { tier: 'NA', msg: 'Chưa có dữ liệu đầu vào.', scoreTier: null };
    const T1 = Number(t1);
    const T2 = Number(t2);
    if (!Number.isFinite(T1)) return { tier: 'NA', msg: 'Thiếu ngưỡng T1 để so sánh.', scoreTier: null };
    const hasT2 = Number.isFinite(T2);

    if (direction === 'LE') {
        if (x <= T1) return { tier: 'PASS', msg: 'Đạt chuẩn (100đ theo rulebook).', scoreTier: 100 };
        if (hasT2 && x <= T2) return { tier: 'MID', msg: 'Đạt ngưỡng tối thiểu (50đ), cần tối ưu thêm.', scoreTier: 50 };
        return { tier: 'FAIL', msg: 'Chưa đạt ngưỡng yêu cầu.', scoreTier: 0 };
    }
    if (direction === 'GE') {
        if (x >= T1) return { tier: 'PASS', msg: 'Đạt chuẩn (100đ theo rulebook).', scoreTier: 100 };
        if (hasT2 && x >= T2) return { tier: 'MID', msg: 'Đạt ngưỡng tối thiểu (50đ), cần tối ưu thêm.', scoreTier: 50 };
        return { tier: 'FAIL', msg: 'Chưa đạt ngưỡng yêu cầu.', scoreTier: 0 };
    }
    return { tier: 'NA', msg: 'Direction không hợp lệ (chỉ hỗ trợ LE/GE).', scoreTier: null };
}

function buildTargetText(direction, t1, t2, unit) {
    const T1 = parseNumberLoose(t1);
    const T2 = parseNumberLoose(t2);

    const target100 = Number.isFinite(T1)
        ? `${direction === 'LE' ? '≤' : '≥'} ${trimNumber(T1)}${unit ? ' ' + unit : ''}`.trim()
        : '—';

    const target50 = Number.isFinite(T2)
        ? `${direction === 'LE' ? '≤' : '≥'} ${trimNumber(T2)}${unit ? ' ' + unit : ''}`.trim()
        : null;

    return target50 ? `100đ: ${target100} • 50đ: ${target50}` : `100đ: ${target100}`;
}

function buildGapText(direction, x, t1, unit) {
    const T1 = parseNumberLoose(t1);
    if (!Number.isFinite(x) || !Number.isFinite(T1)) return '—';

    if (direction === 'LE') {
        if (x <= T1) return 'Đạt';
        return `Vượt ${fmtGap(x - T1, unit)}`;
    }

    if (direction === 'GE') {
        if (x >= T1) return 'Đạt';
        return `Thiếu ${fmtGap(T1 - x, unit)}`;
    }

    return '—';
}

// =========================
// (C) OVERRIDE CỨNG THEO KPI (THEO YÊU CẦU BẠN)
// =========================

function override_CO_01(value) {
    const x = parseNumberLoose(value);
    if (!Number.isFinite(x)) {
        return makeInsight('Chưa có dữ liệu tỷ lệ (%)', '≤ 0% (đạt chuẩn)', '—', 'Chưa đánh giá được.');
    }
    const ok = x <= 0;
    return makeInsight(
        `Tỷ lệ CO-01 hiện tại: ${trimNumber(x)} %`,
        '≤ 0% (đạt chuẩn)',
        ok ? 'Đạt' : `Vượt ${fmtGap(x - 0, '%')}`,
        ok ? 'Đạt chuẩn ✅' : 'Chưa đạt ❌'
    );
}

function override_SC_02(value, meta) {
    const x = parseNumberLoose(value);

    // ✅ Gate soft theo yêu cầu: chỉ cần > 1 là PASS gate
    const gatePass = Number.isFinite(x) && x > 1;

    // ✅ Scoring thresholds: ưu tiên meta.t1/meta.t2, fallback 300/100
    const t1n = Number.isFinite(parseNumberLoose(meta?.t1)) ? parseNumberLoose(meta.t1) : 300;
    const t2n = Number.isFinite(parseNumberLoose(meta?.t2)) ? parseNumberLoose(meta.t2) : 100;

    let scoringLabel = 'Chưa có dữ liệu.';
    if (Number.isFinite(x)) {
        if (x >= t1n) scoringLabel = 'Scoring: 100đ (đạt chuẩn)';
        else if (x >= t2n) scoringLabel = 'Scoring: 50đ (đạt ngưỡng tối thiểu)';
        else scoringLabel = 'Scoring: 0đ (chưa đạt ngưỡng tối thiểu)';
    }

    const gapTo100 = Number.isFinite(x) ? Math.max(0, t1n - x) : NaN;

    return makeInsight(
        Number.isFinite(x) ? `Sản lượng đơn 30 ngày: ${trimNumber(x)} đơn` : 'Sản lượng đơn 30 ngày: —',
        `Gate: > 1 đơn (PASS Soft KO) • Scoring: 100đ ≥ ${trimNumber(t1n)} đơn (50đ ≥ ${trimNumber(t2n)} đơn)`,
        Number.isFinite(gapTo100) ? (gapTo100 == 0 ? 'Đã đạt 100đ' : `Thiếu ${trimNumber(gapTo100)} đơn để đạt 100đ`) : '—',
        `${gatePass ? 'Soft KO: PASS ✅' : 'Soft KO: CHƯA PASS ⏳'} • ${scoringLabel}`
    );
}

function override_PEN_01(value) {
    const x = parseNumberLoose(value);
    if (!Number.isFinite(x)) {
        return makeInsight('Penalty: —', 'Gate: ≤ 2 (>=3 bị chặn MRSM)', '—', 'Chưa đánh giá được.');
    }

    // ✅ >2 mới bị block; =2 cảnh cáo
    const blocked = x > 2;
    const warning = x === 2;

    return makeInsight(
        `Điểm penalty: ${trimNumber(x)}`,
        'Gate: ≤ 2 (>=3 sẽ bị chặn MRSM)',
        blocked ? `Vượt ${trimNumber(x - 2)} điểm so với ngưỡng gate` : 'Đạt gate',
        blocked ? 'Soft KO: FAIL ⛔ (bị chặn MRSM)' : (warning ? 'Soft KO: PASS ✅ nhưng CẢNH CÁO ⚠️ (đang ở ngưỡng 2)' : 'Soft KO: PASS ✅')
    );
}

function override_BR_01(value) {
    const s = safeStr(value);
    if (!s) {
        return makeInsight('Chưa nhập domain/website', 'Domain hoặc URL hợp lệ (dashboard sẽ check hostname)', '—', 'Chưa đạt ❌');
    }

    // Nếu nhập URL => lấy hostname để check
    if (looksLikeUrl(s)) {
        try {
            const u = new URL(s);
            const host = u.hostname || '';
            const pass = looksLikeDomain(host);
            return makeInsight(
                `Website: ${s}`,
                'URL hợp lệ (hostname hợp lệ) là đạt',
                pass ? 'Đạt' : 'Hostname chưa hợp lệ',
                pass ? 'Đạt chuẩn ✅' : 'Chưa đạt ❌'
            );
        } catch {
            return makeInsight(`Website: ${s}`, 'URL hợp lệ (hostname hợp lệ) là đạt', 'URL không parse được', 'Chưa đạt ❌');
        }
    }

    // Domain thuần
    const pass = looksLikeDomain(s);
    return makeInsight(
        `Domain: ${s}`,
        'Domain hợp lệ (vd: supercheap.vn)',
        pass ? 'Đạt' : 'Domain chưa hợp lệ',
        pass ? 'Đạt chuẩn ✅' : 'Chưa đạt ❌'
    );
}

function override_BR_02(value) {
    const obj = normalizeBR02Value(value);
    if (!obj) {
        return makeInsight('Chưa có dữ liệu followers/postUrl (value rỗng hoặc sai format)', 'Followers ≥ 5000 và có post link', '—', 'Chưa đánh giá được.');
    }

    const followers = parseNumberLoose(obj.followers);
    const postUrl = safeStr(obj.postUrl);

    const hasFollowers = Number.isFinite(followers);
    const hasPost = !!postUrl && (looksLikeUrl(postUrl) || postUrl.includes('.'));

    const pass = hasFollowers && followers >= 5000 && hasPost;
    const ht = `Followers: ${hasFollowers ? trimNumber(followers) : '—'} • Post link: ${hasPost ? 'Có' : 'Chưa có'}`;

    return makeInsight(
        ht,
        'Followers ≥ 5000 và có post link',
        pass ? 'Đạt' : 'Thiếu followers hoặc thiếu post link',
        pass ? 'Đạt chuẩn ✅' : 'Chưa đạt ❌'
    );
}

function override_BR_03(value) {
    const pass = isNonEmpty(value);
    return makeInsight(
        pass ? 'Có địa chỉ/điểm nhận diện (dữ liệu tồn tại)' : 'Chưa có địa chỉ (thiếu dữ liệu)',
        'Chỉ cần có dữ liệu địa chỉ là đạt',
        pass ? 'Đạt' : 'Thiếu dữ liệu',
        pass ? 'Đạt chuẩn ✅' : 'Chưa đạt ❌'
    );
}

function override_CAT_04(value) {
    // Nếu boolean: true = không vi phạm
    if (typeof value === 'boolean') {
        const pass = value === true;
        return makeInsight(
            pass ? '0 sản phẩm vi phạm nặng' : 'Tồn tại sản phẩm vi phạm nặng',
            '0 sản phẩm vi phạm',
            pass ? 'Đạt' : 'Rủi ro bị KO',
            pass ? 'Đạt chuẩn ✅' : 'Không đạt ❌'
        );
    }

    // Nếu numeric: PASS khi = 0
    const x = parseNumberLoose(value);
    if (!Number.isFinite(x)) {
        return makeInsight('Số sản phẩm vi phạm nặng: —', '0 sản phẩm vi phạm', '—', 'Chưa đánh giá được.');
    }

    const pass = x === 0;
    return makeInsight(
        `Số sản phẩm vi phạm nặng: ${trimNumber(x)}`,
        '0 sản phẩm vi phạm',
        pass ? 'Đạt' : `Còn ${trimNumber(x)} sản phẩm vi phạm`,
        pass ? 'Đạt chuẩn ✅' : 'Không đạt ❌'
    );
}

function override_CS_02(value, meta) {
    // LE: càng nhỏ càng tốt
    const x = parseNumberLoose(value);
    const t1n = Number.isFinite(parseNumberLoose(meta?.t1)) ? parseNumberLoose(meta.t1) : 1;
    const t2n = Number.isFinite(parseNumberLoose(meta?.t2)) ? parseNumberLoose(meta.t2) : 4;

    if (!Number.isFinite(x)) {
        return makeInsight('Thời gian phản hồi chat: —', `100đ: ≤ ${trimNumber(t1n)} h • 50đ: ≤ ${trimNumber(t2n)} h`, '—', 'Chưa đánh giá được.');
    }

    let msg = 'Chưa đạt';
    if (x <= t1n) msg = 'Đạt chuẩn (100đ)';
    else if (x <= t2n) msg = 'Đạt ngưỡng tối thiểu (50đ)';
    else msg = 'Chưa đạt ngưỡng';

    const gap = x <= t1n ? 'Đạt' : `Vượt ${fmtGap(x - t1n, 'h')}`;

    return makeInsight(
        `Thời gian phản hồi chat: ${trimNumber(x)} h`,
        `100đ: ≤ ${trimNumber(t1n)} h • 50đ: ≤ ${trimNumber(t2n)} h`,
        gap,
        msg
    );
}

function override_CS_01(value, meta) {
    // GE: càng lớn càng tốt
    const x = parseNumberLoose(value);
    const t1n = Number.isFinite(parseNumberLoose(meta?.t1)) ? parseNumberLoose(meta.t1) : 80;
    const t2n = Number.isFinite(parseNumberLoose(meta?.t2)) ? parseNumberLoose(meta.t2) : 60;

    if (!Number.isFinite(x)) {
        return makeInsight('Tỷ lệ phản hồi chat: —', `100đ: ≥ ${trimNumber(t1n)} % • 50đ: ≥ ${trimNumber(t2n)} %`, '—', 'Chưa đánh giá được.');
    }

    let msg = 'Chưa đạt';
    if (x >= t1n) msg = 'Đạt chuẩn (100đ)';
    else if (x >= t2n) msg = 'Đạt ngưỡng tối thiểu (50đ)';
    else msg = 'Chưa đạt ngưỡng';

    const gap = x >= t1n ? 'Đạt' : `Thiếu ${fmtGap(t1n - x, '%')}`;

    return makeInsight(
        `Tỷ lệ phản hồi chat: ${trimNumber(x)} %`,
        `100đ: ≥ ${trimNumber(t1n)} % • 50đ: ≥ ${trimNumber(t2n)} %`,
        gap,
        msg
    );
}

function override_OP_04(value, meta) {
    // Soft KO: theo bạn, qua gate khi đạt tối thiểu (>=t2)
    const x = parseNumberLoose(value);
    const t1n = Number.isFinite(parseNumberLoose(meta?.t1)) ? parseNumberLoose(meta.t1) : 95;
    const t2n = Number.isFinite(parseNumberLoose(meta?.t2)) ? parseNumberLoose(meta.t2) : 80;

    if (!Number.isFinite(x)) {
        return makeInsight('OP-04: —', `Gate: ≥ ${trimNumber(t2n)} % (soft) • Scoring: 100đ ≥ ${trimNumber(t1n)} %`, '—', 'Chưa đánh giá được.');
    }

    let scoreMsg = 'Scoring: 0đ (chưa đạt tối thiểu)';
    if (x >= t1n) scoreMsg = 'Scoring: 100đ (đạt chuẩn)';
    else if (x >= t2n) scoreMsg = 'Scoring: 50đ (đạt tối thiểu)';

    const gatePass = x >= t2n;

    return makeInsight(
        `OP-04 hiện tại: ${trimNumber(x)} %`,
        `Gate: ≥ ${trimNumber(t2n)} % (PASS Soft KO) • Scoring: 100đ ≥ ${trimNumber(t1n)} %`,
        x >= t1n ? 'Đạt' : `Thiếu ${fmtGap(t1n - x, '%')}`,
        `${gatePass ? 'Soft KO: PASS ✅' : 'Soft KO: CHƯA PASS ⏳'} • ${scoreMsg}`
    );
}

function override_CAT_03(value, meta) {
    const x = parseNumberLoose(value);
    const t1n = Number.isFinite(parseNumberLoose(meta?.t1)) ? parseNumberLoose(meta.t1) : 95;
    const t2n = Number.isFinite(parseNumberLoose(meta?.t2)) ? parseNumberLoose(meta.t2) : 80;

    if (!Number.isFinite(x)) {
        return makeInsight('Thuộc tính đầy đủ (CAT-03): —', `100đ: ≥ ${trimNumber(t1n)} % • 50đ: ≥ ${trimNumber(t2n)} %`, '—', 'Chưa đánh giá được.');
    }

    let msg = 'Chưa đạt';
    if (x >= t1n) msg = 'Đạt chuẩn (100đ)';
    else if (x >= t2n) msg = 'Đạt tối thiểu (50đ)';
    else msg = 'Chưa đạt';

    return makeInsight(
        `Thuộc tính đầy đủ (CAT-03): ${trimNumber(x)} %`,
        `100đ: ≥ ${trimNumber(t1n)} % • 50đ: ≥ ${trimNumber(t2n)} %`,
        x >= t1n ? 'Đạt' : `Thiếu ${fmtGap(t1n - x, '%')}`,
        msg
    );
}

function override_CAT_01(value, meta) {
    const x = parseNumberLoose(value);
    const t1n = Number.isFinite(parseNumberLoose(meta?.t1)) ? parseNumberLoose(meta.t1) : 95;
    const t2n = Number.isFinite(parseNumberLoose(meta?.t2)) ? parseNumberLoose(meta.t2) : 90;

    if (!Number.isFinite(x)) {
        return makeInsight('% Listing đạt chuẩn (CAT-01): —', `100đ: ≥ ${trimNumber(t1n)} % • 50đ: ≥ ${trimNumber(t2n)} %`, '—', 'Chưa đánh giá được.');
    }

    let msg = 'Chưa đạt';
    if (x >= t1n) msg = 'Đạt chuẩn (100đ)';
    else if (x >= t2n) msg = 'Đạt tối thiểu (50đ)';
    else msg = 'Chưa đạt';

    return makeInsight(
        `% Listing đạt chuẩn (CAT-01): ${trimNumber(x)} %`,
        `100đ: ≥ ${trimNumber(t1n)} % • 50đ: ≥ ${trimNumber(t2n)} %`,
        x >= t1n ? 'Đạt' : `Thiếu ${fmtGap(t1n - x, '%')}`,
        msg
    );
}

function tryOverrideInsight(kpiId, value, meta) {
    switch (kpiId) {
        case 'CO-01': return override_CO_01(value);
        case 'SC-02': return override_SC_02(value, meta);
        case 'PEN-01': return override_PEN_01(value);
        case 'BR-01': return override_BR_01(value);
        case 'BR-02': return override_BR_02(value);
        case 'BR-03': return override_BR_03(value);
        case 'CAT-04': return override_CAT_04(value);
        case 'CS-01': return override_CS_01(value, meta);
        case 'CS-02': return override_CS_02(value, meta);
        case 'OP-04': return override_OP_04(value, meta);
        case 'CAT-03': return override_CAT_03(value, meta);
        case 'CAT-01': return override_CAT_01(value, meta);
        default: return null;
    }
}

function pickRuleMeta(item, rec) {
    const r = rec || {};
    const i = item || {};

    const direction = (
        i.direction ??
        r.direction ??
        r.meta?.direction ??
        r.rule?.direction ??
        r.threshold?.direction ??
        r.thresholds?.direction ??
        ''
    ).toString().toUpperCase();

    const method = (
        i.method ??
        r.method ??
        r.meta?.method ??
        r.rule?.method ??
        r.threshold?.method ??
        r.thresholds?.method ??
        ''
    ).toString().toUpperCase();

    const t1 = i.t1 ?? r.t1 ?? r.meta?.t1 ?? r.rule?.t1 ?? r.threshold?.t1 ?? r.thresholds?.t1 ?? r.threshold?.target ?? null;
    const t2 = i.t2 ?? r.t2 ?? r.meta?.t2 ?? r.rule?.t2 ?? r.threshold?.t2 ?? r.thresholds?.t2 ?? r.threshold?.min ?? null;

    return { direction, method, t1, t2 };
}

// =========================
// (D) BUILD INSIGHT (MAIN)
// =========================

function buildInsightFromActual(kpiId, kpiItem, rec) {
    const base = rec?.insight ? { ...rec.insight } : {};
    const item = kpiItem || {};

    const value = extractValue(item);
    const meta = pickRuleMeta(item, rec);
    const direction = (meta.direction || '').toUpperCase();
    const method = (meta.method || '').toUpperCase();
    const unit = KPI_UNITS[kpiId] || '';

    // (1) Override cứng theo KPI đặc biệt
    const overridden = tryOverrideInsight(kpiId, value, meta);
    if (overridden) return overridden;

    // (2) BOOL/BINARY
    const isBool = method === 'BINARY' || direction === 'BOOL' || typeof value === 'boolean';
    if (isBool) {
        // Cho phép 0/1 khi KPI đã xác định là bool
        const b = (typeof value === 'boolean') ? value : (coerceBool01(value) ?? coerceBoolStrict(value));
        const ok = b === true;

        return makeInsight(
            `Giá trị nhập: ${formatVal(value, '')}`,
            base.muc_tieu || 'True',
            ok ? '—' : (base.chenhlech || 'Chưa đạt'),
            ok ? 'Đạt chuẩn ✅' : 'Không đạt ❌'
        );
    }

    // (3) RANGE numeric
    const dir = (direction === 'LE' || direction === 'GE') ? direction : null;
    const x = parseNumberLoose(value);
    const t1n = parseNumberLoose(meta.t1);
    const t2n = parseNumberLoose(meta.t2);

    if (!dir || !Number.isFinite(x) || !Number.isFinite(t1n)) {
        // fallback: vẫn show value thật (kể cả =0)
        const ht = isNonEmpty(value) ? `Giá trị nhập: ${formatVal(value, unit)}` : (base.hien_tai || '—');
        return makeInsight(ht, base.muc_tieu || '—', base.chenhlech || '—', base.danh_gia || '—');
    }

    const evalRes = evaluateRange(dir, x, t1n, Number.isFinite(t2n) ? t2n : NaN);
    const targetText = buildTargetText(dir, t1n, Number.isFinite(t2n) ? t2n : NaN, unit);
    const gapText = buildGapText(dir, x, t1n, unit);

    // (4) Soft KO generic: PASS khi đạt tối thiểu (MID) trở lên
    if (SOFT_KO_IDS.has(kpiId)) {
        const gatePass = evalRes.tier === 'PASS' || evalRes.tier === 'MID';
        const gateText = gatePass ? 'Soft KO: PASS ✅' : 'Soft KO: CHƯA PASS ⏳';
        return makeInsight(
            `Giá trị nhập: ${formatVal(x, unit)}`,
            `Gate: (tối thiểu) • ${targetText}`,
            gapText,
            `${gateText} • ${evalRes.msg}`
        );
    }

    // Normal KPI
    return makeInsight(
        `Giá trị nhập: ${formatVal(x, unit)}`,
        targetText,
        gapText,
        evalRes.msg
    );
}
// ========================
// TẠO KHUYẾN NGHỊ CÓ SỐ LIỆU
// ========================
function taoKhuyenNghi(item, gate) {
    const id = item.rule_id;
    const score = Number(item.score ?? 0);
    const method = item.method;
    const value = item.value;
    const t1 = item.t1;
    const t2 = item.t2;
    const direction = item.direction;

    // Soft KO check
    const isSoftKO = ['OP-04', 'PEN-01', 'CO-01', 'SC-02'].includes(id);
    const gateStatus = gate?.status || 'PASS';
    let softKONote = '';

    if (isSoftKO && score < 100 && (gateStatus === 'G1' || gateStatus === 'G2')) {
        const deadline = gate?.soft?.deadline_at;
        softKONote = deadline
            ? `<p><strong>⏰ Đây là điều kiện chặn mềm:</strong> cần hoàn tất trong 7 ngày (hạn: ${formatDateTime(deadline)}) để được tính điểm tổng.</p>`
            : `<p><strong>⏰ Đây là điều kiện chặn mềm:</strong> cần hoàn tất trong 7 ngày để được tính điểm tổng.</p>`;
    }

    // Ưu tiên sinh câu có số liệu cho RANGE
    if (method === 'RANGE' && value !== null && value !== undefined && t1 !== null && t2 !== null) {
        const val = Number(value);
        if (!isNaN(val)) {
            let line1 = '', line2 = '';

            if (direction === 'LE') {
                // Càng nhỏ càng tốt
                const gap1 = val - t1;
                const gap2 = val - t2;

                if (score === 100) {
                    line1 = `Hiện tại <strong>${val.toFixed(2)}</strong>, đã đạt mục tiêu (≤ ${t1}).`;
                    line2 = `Duy trì ổn định để không vượt ngưỡng.`;
                } else if (score === 50) {
                    line1 = `Hiện tại <strong>${val.toFixed(2)}</strong>, chênh <strong>+${gap1.toFixed(2)}</strong> so với mục tiêu (${t1}).`;

                    // RÀNG BUỘC OP-01
                    if (id === 'OP-01') {
                        line2 = `Xử lý theo "đơn sắp quá hạn" và tối ưu giờ chốt đơn để giảm tỷ lệ giao hàng trễ.`;
                    } else {
                        line2 = `Cần giảm xuống dưới ${t1} để đạt điểm tối đa.`;
                    }
                } else {
                    line1 = `Hiện tại <strong>${val.toFixed(2)}</strong>, chênh <strong>+${gap2.toFixed(2)}</strong> so với ngưỡng đạt (${t2}).`;

                    // RÀNG BUỘC OP-01
                    if (id === 'OP-01') {
                        line2 = `Tăng tốc khâu chuẩn bị hàng, đóng gói và bàn giao trong 7–14 ngày để cải thiện nhanh.`;
                    } else {
                        line2 = `Cần giảm xuống dưới ${t2} để đạt ít nhất 50 điểm.`;
                    }
                }
            } else if (direction === 'GE') {
                // Càng lớn càng tốt
                const gap1 = t1 - val;
                const gap2 = t2 - val;

                if (score === 100) {
                    line1 = `Hiện tại <strong>${val.toFixed(2)}</strong>, đã đạt mục tiêu (≥ ${t1}).`;
                    line2 = `Duy trì hoặc tăng thêm để củng cố vị thế.`;
                } else if (score === 50) {
                    line1 = `Hiện tại <strong>${val.toFixed(2)}</strong>, thiếu <strong>${gap1.toFixed(2)}</strong> để đạt mục tiêu (${t1}).`;
                    line2 = `Tăng lên trên ${t1} để đạt điểm tối đa.`;
                } else {
                    line1 = `Hiện tại <strong>${val.toFixed(2)}</strong>, thiếu <strong>${gap2.toFixed(2)}</strong> để đạt ngưỡng tối thiểu (${t2}).`;
                    line2 = `Tăng lên trên ${t2} để đạt ít nhất 50 điểm.`;
                }
            }

            return `
        <div class="recommendation-box">
          <h5>📊 Phân tích số liệu</h5>
          <ul>
            <li>${line1}</li>
            <li>${line2}</li>
          </ul>
        </div>
        ${softKONote}
        ${fallbackRecommendation(id)}
      `;
        }
    }

    // Fallback: dùng RECOMMENDATIONS cố định
    return `${fallbackRecommendation(id)}${softKONote}`;
}

function fallbackRecommendation(id) {
    const rec = window.RECOMMENDATIONS?.[id];
    if (!rec) {
        return '<p style="color: var(--chu-phu);">Chưa có khuyến nghị chi tiết cho KPI này.</p>';
    }

    // recommendation.js stores actions as objects (e.g., { viec, chi_tiet_thuc_te, ... }).
    // Older versions stored plain strings. Normalize both to readable text.
    const toText = (x) => {
        if (x == null) return '';
        if (typeof x === 'string') return x;
        if (typeof x === 'number') return String(x);
        if (typeof x === 'object') {
            return x.viec || x.text || x.noi_dung || x.title || JSON.stringify(x);
        }
        return String(x);
    };

    let html = '';

    if (rec.hanh_dong_uu_tien && rec.hanh_dong_uu_tien.length > 0) {
        html += `
      <div class="recommendation-box">
        <h5>✅ Hành động ưu tiên</h5>
        <ul>
          ${rec.hanh_dong_uu_tien.map(h => `<li>${toText(h)}</li>`).join('')}
        </ul>
      </div>
    `;
    }

    if (rec.hanh_dong_khac_phuc && rec.hanh_dong_khac_phuc.length > 0) {
        html += `
      <div class="recommendation-box" style="background: var(--canh-bao-nen); border-color: var(--canh-bao);">
        <h5 style="color: var(--canh-bao);">🛠️ Hành động khắc phục</h5>
        <ul>
          ${rec.hanh_dong_khac_phuc.map(h => `<li>${toText(h)}</li>`).join('')}
        </ul>
      </div>
    `;
    }

    if (rec.luu_y && rec.luu_y.length > 0) {
        html += `
      <div class="recommendation-box" style="background: var(--xanh-nen); border-color: var(--xanh);">
        <h5 style="color: var(--xanh);">💡 Lưu ý</h5>
        <ul>
          ${rec.luu_y.map(l => `<li>${toText(l)}</li>`).join('')}
        </ul>
      </div>
    `;
    }

    if (rec.thoi_han) {
        html += `<p style="margin-top: 12px; font-size: 13px; color: var(--nguy-hiem); font-weight: 700;">⏰ Thời hạn khuyến nghị: ${rec.thoi_han}</p>`;
    }

    return html || '<p style="color: var(--chu-phu);">Không có khuyến nghị.</p>';
}

// ========================
// EXPORT JSON
// ========================
function exportJSON() {
    if (!assessmentData) return;

    try {
        const blob = new Blob([JSON.stringify(assessmentData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `assessment_${assessmentData.assessment_id || 'export'}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Lỗi khi xuất file JSON.');
    }
}

// ========================
// EMPTY STATE
// ========================
function showEmptyState() {
    document.body.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--nen);">
      <div style="text-align: center; padding: 40px;">
        <div style="font-size: 64px; margin-bottom: 20px;">📊</div>
        <h2 style="font-size: 24px; font-weight: 700; color: var(--chu); margin-bottom: 12px;">Không tìm thấy dữ liệu đánh giá</h2>
        <p style="font-size: 16px; color: var(--chu-phu); margin-bottom: 24px;">Vui lòng thực hiện đánh giá trước khi xem Dashboard.</p>
        <button onclick="window.location.href='KPI_SCORING.html'" style="padding: 14px 28px; background: var(--cam); color: var(--trang); border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;">
          Về trang Chấm điểm KPI
        </button>
      </div>
    </div>
  `;
}

// ========================
// INIT
// ========================
document.addEventListener('DOMContentLoaded', loadData);