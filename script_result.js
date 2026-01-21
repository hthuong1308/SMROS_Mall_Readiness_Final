
const $ = (id) => document.getElementById(id);

let toastTimer = null;

/* ============================================================
   ✅ Toast helper
   - Hiển thị thông báo nhỏ (export thành công/lỗi...)
============================================================ */
function showToast(type, title, message, ms = 2600) {
  const toast = $("toast");
  if (!toast) return;

  toast.classList.remove("success");
  if (type === "success") toast.classList.add("success");

  const iconEl = $("toastIcon");
  const titleEl = $("toastTitle");
  const msgEl = $("toastMsg");

  if (iconEl) iconEl.textContent = type === "success" ? "✓" : "!";
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;

  toast.style.display = "block";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.style.display = "none"), ms);
}

/* ============================================================
   ✅ Query param helper
   - Lấy giá trị query string từ URL hiện tại
============================================================ */
function getQueryParam(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

/* ============================================================
   ✅ Build Dashboard URL (một phiên bản duy nhất)
   - Nếu có assessment_id -> DASHBOARD.html?assessment_id=...
   - Nếu không có assessment_id (offline/file://) -> DASHBOARD.html?mode=local
============================================================ */
function withAssessmentId(path, assessmentId) {
  const base = path.startsWith("./") ? path : "./" + path;
  if (assessmentId) return `${base}?assessment_id=${encodeURIComponent(assessmentId)}`;
  return `${base}?mode=local`;
}

/* ============================================================
   ✅ Sync tất cả link/nút sang Dashboard
   - Đảm bảo click nút/anchor luôn điều hướng đúng
   - Có preventDefault để tránh browser xử lý anchor khác mong muốn
============================================================ */
function syncDashboardLinks(assessmentId) {
  const isLocal = String(assessmentId || "").startsWith("LOCAL_");
  const dashHref = isLocal ? "DASHBOARD.html?mode=local" : withAssessmentId("DASHBOARD.html", assessmentId);

  const btnGoDashboard = document.getElementById("btnGoDashboard");
  if (btnGoDashboard) {
    btnGoDashboard.setAttribute("href", dashHref);
    btnGoDashboard.onclick = (e) => {
      e.preventDefault();
      window.location.href = dashHref;
    };
  }

  const footerDash = document.getElementById("footerDashboardLink");
  if (footerDash) {
    footerDash.setAttribute("href", dashHref);
    footerDash.onclick = (e) => {
      e.preventDefault();
      window.location.href = dashHref;
    };
  }

  document
    .querySelectorAll('.footer-actions a[href="DASHBOARD.html"], .footer-actions a[href="./DASHBOARD.html"]')
    .forEach((a) => a.setAttribute("href", dashHref));
}


/* ============================================================
   ✅ Format helpers
============================================================ */
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", { hour12: false });
}

function daysCeil(ms) {
  return Math.ceil(ms / 86400000);
}

/* ============================================================
   ✅ Tier logic (theo thesis)
============================================================ */
function tierFromScore(score) {
  if (score < 50) return "NOT_READY";
  if (score <= 69) return "PARTIALLY_READY";
  if (score <= 84) return "NEAR_MALL_READY";
  return "MALL_READY";
}

function tierMeta(tier) {
  switch (tier) {
    case "MALL_READY":
      return {
        label: "Mall-Ready",
        cls: "ok",
        icon: "✅",
        desc: "Đủ điều kiện (Eligible/Maintain) nếu không vi phạm gate.",
      };
    case "NEAR_MALL_READY":
      return {
        label: "Near Mall-Ready",
        cls: "info",
        icon: "✨",
        desc: "Rất gần chuẩn Mall – ưu tiên Fixlist Top ImpactGap.",
      };
    case "PARTIALLY_READY":
      return {
        label: "Partially Ready",
        cls: "warn",
        icon: "🛠️",
        desc: "Có nền tảng nhưng chưa đủ chuẩn – cần cải thiện nhóm trọng yếu.",
      };
    case "NOT_READY":
      return {
        label: "Not Ready",
        cls: "danger",
        icon: "⚠️",
        desc: "Chưa sẵn sàng – cần nâng cấp toàn diện.",
      };
    case "GATE_BLOCKED":
      return {
        label: "Gate Blocked",
        cls: "danger",
        icon: "⛔",
        desc: "Bị chặn bởi gate – MRSM_Final = 0 cho đến khi PASS gate.",
      };
    default:
      return { label: tier || "—", cls: "info", icon: "ℹ️", desc: "" };
  }
}

function scoreTone(score) {
  const s = Number(score || 0);
  if (s < 60) return { color: "#DC2626", bg: "rgba(220,38,38,.10)", label: "Cần cải thiện" };
  return { color: "#16A34A", bg: "rgba(22,163,74,.12)", label: "Ổn" };
}

/* ============================================================
   ✅ Gate badge mapping
   - PASS / G0 / G1 / G2 theo logic thesis
============================================================ */
function gateBadge(status) {
  if (status === "PASS") return { text: "PASS", cls: "ok", icon: "✅" };
  if (status === "G0") return { text: "G0 – Hard KO Failed", cls: "danger", icon: "⛔" };
  if (status === "G1") return { text: "G1 – Soft KO Pending", cls: "warn", icon: "⏳" };
  if (status === "G2") return { text: "G2 – Soft KO Overdue", cls: "danger", icon: "⌛" };
  return { text: status || "—", cls: "info", icon: "ℹ️" };
}

/**
 * IMPORTANT UPDATE:
 * - Compliance/Legal KHÔNG còn là KPI domain nữa.
 * - Domain tie-break dùng 4 nhóm: Operation/Brand/Category/Scale.
 */
function domainPriority(domain) {
  switch (String(domain || "")) {
    case "Operation":
      return 3;
    case "Brand":
      return 2;
    case "Category":
      return 1;
    case "Scale":
      return 0;
    default:
      return 0;
  }
}

function safeText(s) {
  return s === null || s === undefined ? "" : String(s);
}

/* ============================================================
   ✅ Empty state renderer
   - Khi không tìm thấy assessment_id và localStorage không có dữ liệu
============================================================ */
function renderEmpty(reason) {
  const main = $("mainRoot");
  if (!main) return;

  main.innerHTML = `
    <section class="section">
      <div class="section-head">
        <div class="left">🧾 RESULT</div>
        <div class="right"><span class="pill">Empty state</span></div>
      </div>
      <div class="section-body">
        <div class="empty">
          <div class="icon">🫥</div>
          <h3>Không tìm thấy assessment</h3>
          <p>${safeText(reason) || "Thiếu assessment_id hoặc dữ liệu không tồn tại."}</p>

          <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
            <a class="btn primary" href="KPI_SCORING.html">🧮 Quay về trang KPI</a>
            <a class="btn light" href="Homepage.html">🏠 Về Home</a>
          </div>
        </div>
      </div>
    </section>
  `;
  $("loadingSection")?.remove();
}

function kpiScoreTag(score) {
  if (score === 100) return `<span class="tag ok small">100</span>`;
  if (score === 50) return `<span class="tag warn small">50</span>`;
  return `<span class="tag danger small">0</span>`;
}

/* ============================================================
   ✅ LOCAL-FIRST ADAPTER
   - Convert localStorage assessment_result schema -> schema mà RESULTS UI dùng
============================================================ */

function groupOf(ruleId) {
  if (
    ruleId.startsWith("OP-") ||
    ruleId.startsWith("CS-") ||
    ruleId.startsWith("PEN-") ||
    ruleId.startsWith("CO-")
  )
    return "Operation";

  if (ruleId.startsWith("BR-")) return "Brand";
  if (ruleId.startsWith("CAT-")) return "Category";
  if (ruleId.startsWith("SC-")) return "Scale";
  return "Operation";
}

/** UPDATED: domain = group */
function domainOf(ruleId) {
  return groupOf(ruleId);
}

function calcGroupsAndKpisFromLocal(local) {
  const breakdown = Array.isArray(local?.breakdown) ? local.breakdown : [];

  const kpis = breakdown.map((k) => ({
    rule_id: k.id,
    name: k.name,
    group: groupOf(k.id),
    domain: domainOf(k.id),
    score: Number(k.score ?? 0),
    weight_final: Number(k.weight ?? 0),

    // NEW
    value: k.value ?? null,
    meta: k.meta ?? null,
  }));

  const groups = {};
  ["Operation", "Brand", "Category", "Scale"].forEach((g) => {
    const items = kpis.filter((x) => x.group === g);
    const wsum = items.reduce((s, it) => s + (it.weight_final || 0), 0);
    const contrib = items.reduce((s, it) => s + it.score * (it.weight_final || 0), 0);
    groups[g] = { score: wsum > 0 ? contrib / wsum : 0, contribution: contrib };
  });

  return { kpis, groups };
}

function safeParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeTier(rawTier, score) {
  // scoring_logic.js produces human labels; RESULT UI expects enums
  const t = String(rawTier || "").trim().toLowerCase();
  if (!t) return tierFromScore(Number(score || 0));

  if (t === "not ready" || t === "not_ready") return "NOT_READY";
  if (t === "partially ready" || t === "partially_ready") return "PARTIALLY_READY";
  if (t === "near mall-ready" || t === "near mall ready" || t === "near_mall_ready") return "NEAR_MALL_READY";
  if (t === "mall-ready" || t === "mall ready" || t === "mall_ready") return "MALL_READY";
  // already enum?
  if (["NOT_READY", "PARTIALLY_READY", "NEAR_MALL_READY", "MALL_READY"].includes(String(rawTier)))
    return String(rawTier);

  return tierFromScore(Number(score || 0));
}

function bestEffortShopInfo(local) {
  const shopRaw = localStorage.getItem("shop_info");
  const shopInfo = shopRaw ? safeParseJson(shopRaw) : null;

  let shopName =
    shopInfo?.shop_name ||
    shopInfo?.shopName ||
    local?.shop_name ||
    local?.shopName ||
    local?.shop?.shop_name ||
    local?.shop?.shopName;

  let shopId =
    shopInfo?.shop_id ||
    shopInfo?.shopId ||
    local?.shop_id ||
    local?.shopId ||
    local?.shop?.shop_id ||
    local?.shop?.shopId;

  // fallback scan: đôi khi shop info nằm trong key khác
  if (!shopName || !shopId) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const raw = localStorage.getItem(key);
      if (!raw || !(raw.startsWith("{") || raw.startsWith("["))) continue;
      const obj = safeParseJson(raw);
      if (!obj || typeof obj !== "object") continue;

      const candName = obj.shop_name || obj.shopName || obj?.shop?.shop_name || obj?.shop?.shopName;
      const candId = obj.shop_id || obj.shopId || obj?.shop?.shop_id || obj?.shop?.shopId;

      if (!shopName && candName) shopName = String(candName).trim();
      if (!shopId && candId) shopId = String(candId).trim();
      if (shopName && shopId) break;
    }
  }

  return {
    shop_name: (shopName && String(shopName).trim()) || "—",
    shop_id: (shopId && String(shopId).trim()) || "—",
  };
}

function adaptLocalAssessment(local) {
  const computedAt = local.computedAt || new Date().toISOString();
  const { kpis, groups } = calcGroupsAndKpisFromLocal(local);
  const shop = bestEffortShopInfo(local);

  // Gate status có thể được tạo bởi KO pages; nếu thiếu thì default PASS
  const localGateStatus = local?.gate?.status || local?.gateStatus || local?.gate_status || local?.gate_state || "PASS";

  const localHardFailed = local?.gate?.hard?.failed_rules || local?.hard_failed_rules || local?.hardFailedRules || [];

  const localSoftItems = local?.gate?.soft?.items || local?.soft_items || local?.softItems || {};

  const localSoftDeadline =
    local?.gate?.soft?.deadline_at || local?.soft_deadline_at || local?.softDeadlineAt || null;

  const totalScore = Number(local.totalScore ?? 0);

  return {
    assessment_id: "LOCAL_" + computedAt.replace(/[:.]/g, ""),
    evaluated_at: computedAt,
    shop,

    gate: {
      status: localGateStatus,
      hard: { failed_rules: Array.isArray(localHardFailed) ? localHardFailed : [] },
      soft: {
        items: localSoftItems && typeof localSoftItems === "object" ? localSoftItems : {},
        deadline_at: localSoftDeadline,
      },
    },

    mrsm: {
      final_score: totalScore,
      tier: normalizeTier(local.tier, totalScore),
    },

    groups,
    kpis,
  };
}

/* ============================================================
   ✅ RENDER (RESULTS)
============================================================ */
function render(assess) {
  $("loadingSection")?.remove();

  const assessmentId = assess.assessment_id || "—";
  const shopName = assess.shop?.shop_name || "—";
  const shopId = assess.shop?.shop_id || "—";
  const evaluatedAt = assess.evaluated_at ? fmtDateTime(assess.evaluated_at) : "—";

  if (assess.assessment_id) syncDashboardLinks(assess.assessment_id);

  if ($("sideAssessment")) $("sideAssessment").textContent = assessmentId;
  if ($("sideShop")) $("sideShop").textContent = `${shopName} (${shopId})`;

  const gateStatus = assess.gate?.status || "—";
  const gateB = gateBadge(gateStatus);

  const now = new Date();
  const hardFailed = Array.isArray(assess.gate?.hard?.failed_rules) ? assess.gate.hard.failed_rules : [];
  const softItems = assess.gate?.soft?.items || {};
  const softFailedIds = Object.keys(softItems).filter((id) => softItems?.[id] && softItems[id].passed === false);

  const isPass = gateStatus === "PASS";

  const finalScore = isPass ? Number(assess.mrsm?.final_score ?? 0) : 0;
  const computedTier = isPass ? tierFromScore(finalScore) : "GATE_BLOCKED";
  const tier = isPass ? assess.mrsm?.tier || computedTier : "GATE_BLOCKED";
  const tierM = tierMeta(tier);

  const tone = scoreTone(finalScore);

  let calloutCls = "info";
  let calloutTitle = `${gateB.icon} Gate status: ${gateB.text}`;
  let calloutDesc = "";
  let calloutListHtml = "";

  if (gateStatus === "G0") {
    calloutCls = "danger";
    calloutDesc = "Hard KO bị fail. MRSM_Final sẽ bị đặt về 0 cho đến khi pass tất cả Hard KO.";
    calloutListHtml = `
      <div class="list">
        ${(hardFailed.length ? hardFailed : ["(Không có dữ liệu failed_rules)"])
        .map(
          (r) => `
          <div class="li">
            <div class="left">
              <div class="title mono">${safeText(r)}</div>
              <div class="desc">Hard KO failed</div>
            </div>
            <div class="prio">P0</div>
          </div>
        `
        )
        .join("")}
      </div>
    `;
  }

  if (gateStatus === "G1" || gateStatus === "G2") {
    const deadlineIso = assess.gate?.soft?.deadline_at;
    const deadline = deadlineIso ? new Date(deadlineIso) : null;

    if (gateStatus === "G1") {
      calloutCls = "warn";
      calloutDesc =
        "Soft KO đang trong remediation window 7 ngày. Chỉ khi pass hết soft KO mới tính MRSM theo weighted sum.";
    } else {
      calloutCls = "danger";
      calloutDesc = "Soft KO đã quá hạn remediation window. Cần xử lý ngay các Soft KO fail để mở gate.";
    }

    let timeLine = "";
    if (deadline && !Number.isNaN(deadline.getTime())) {
      const diff = deadline.getTime() - now.getTime();
      if (diff >= 0) {
        const left = daysCeil(diff);
        timeLine = `Deadline: <span class="mono">${fmtDateTime(deadlineIso)}</span> • Còn <b>${left}</b> ngày`;
      } else {
        const overdue = daysCeil(-diff);
        timeLine = `Deadline: <span class="mono">${fmtDateTime(deadlineIso)}</span> • Quá hạn <b>${overdue}</b> ngày`;
      }
    } else {
      timeLine = `Deadline: <span class="mono">—</span>`;
    }

    calloutListHtml = `
      <div style="margin-top:10px" class="muted">${timeLine}</div>
      <div class="list">
        ${(softFailedIds.length ? softFailedIds : ["(Không có Soft KO fail)"])
        .map((id) => {
          const note = softItems?.[id]?.note ? ` • Note: ${safeText(softItems[id].note)}` : "";
          return `
            <div class="li">
              <div class="left">
                <div class="title mono">${safeText(id)}</div>
                <div class="desc">Soft KO failed${note}</div>
              </div>
              <div class="prio">P0</div>
            </div>
          `;
        })
        .join("")}
      </div>
    `;
  }

  if (gateStatus === "PASS") {
    calloutCls = "ok";
    calloutDesc = "Gate đã PASS. MRSM_Final được tính theo Weighted Sum Model và tier theo ngưỡng điểm.";
    calloutListHtml = `
      <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
        <span class="tag ok">0–49: NOT_READY</span>
        <span class="tag warn">50–69: PARTIALLY_READY</span>
        <span class="tag info">70–84: NEAR_MALL_READY</span>
        <span class="tag ok">≥85: MALL_READY</span>
      </div>
    `;
  }

  const groups = assess.groups || {};
  const groupOrder = ["Operation", "Brand", "Category", "Scale"];
  const groupCards = groupOrder
    .map((g) => {
      const s = Number(groups?.[g]?.score ?? 0);
      const c = Number(groups?.[g]?.contribution ?? 0);
      const blockedCls = isPass ? "" : "blocked";
      return `
      <div class="gcard ${blockedCls}">
        <div class="t"><span class="chip"></span>${g}</div>
        <div class="s">
          <div class="val">${Math.round(s)}</div>
          <div class="contrib">Contribution: <span class="mono">${c.toFixed(2)}</span></div>
        </div>
      </div>
    `;
    })
    .join("");

  let fixItems = [];
  if (!isPass) {
    const hard = hardFailed.map((r) => ({
      id: r,
      name: "Hard KO failed",
      domain: "Operation",
      score: 0,
      weight_final: 0,
      impact: null,
      note: "Fix Hard KO để mở gate.",
    }));
    const soft = softFailedIds.map((id) => ({
      id,
      name: "Soft KO failed",
      domain: "Operation",
      score: 0,
      weight_final: 0,
      impact: null,
      note: softItems?.[id]?.note || "Fix Soft KO trong remediation window.",
    }));
    fixItems = [...hard, ...soft].map((x) => ({ ...x, priority: "P0" }));
  } else {
    const kpis = Array.isArray(assess.kpis) ? assess.kpis : [];
    fixItems = kpis
      .map((k) => {
        const score = Number(k.score ?? 0);
        const w = Number(k.weight_final ?? 0);
        const impact = (100 - score) * w;
        return {
          id: k.rule_id,
          name: k.name,
          domain: k.domain || k.group || "",
          score,
          weight_final: w,
          impact,
          priority: null,
          group: k.group || "",
        };
      })
      .sort((a, b) => {
        if ((b.impact ?? 0) !== (a.impact ?? 0)) return (b.impact ?? 0) - (a.impact ?? 0);
        const dp = domainPriority(b.domain) - domainPriority(a.domain);
        if (dp !== 0) return dp;
        return String(a.id).localeCompare(String(b.id));
      })
      .slice(0, 5)
      .map((x) => ({ ...x, priority: "P1" }));
  }

  const fixlistHtml = fixItems.length
    ? fixItems
      .map((item) => {
        const impactText = isPass
          ? `ImpactGap: <span class="mono">${(item.impact ?? 0).toFixed(4)}</span> • w=${(item.weight_final ?? 0).toFixed(
            4
          )} • score=${item.score}`
          : "";
        const sub = isPass
          ? `${safeText(item.name)} • ${safeText(item.group || "")} • ${safeText(item.domain || "")}`
          : `${safeText(item.note || item.name)}`;
        return `
      <div class="li">
        <div class="left">
          <div class="title"><span class="mono">${safeText(item.id)}</span> ${isPass ? kpiScoreTag(item.score) : ""}</div>
          <div class="desc">${sub}${impactText ? ` • ${impactText}` : ""}</div>
        </div>
        <div class="prio">${safeText(item.priority)}</div>
      </div>
    `;
      })
      .join("")
    : `<div class="muted">Không có item.</div>`;

  const allKpis = Array.isArray(assess.kpis) ? assess.kpis : [];

  const rows = allKpis
    .map((k) => {
      const score = Number(k.score ?? 0);
      const w = Number(k.weight_final ?? 0);
      const impact = (100 - score) * w;
      const scoreTag = kpiScoreTag(score);
      const groupTag = `<span class="tag">${safeText(k.group || "—")}</span>`;
      const domainTag = `<span class="tag">${safeText(k.domain || "—")}</span>`;
      const impactTag = isPass
        ? `<span class="tag info"><span class="mono">${impact.toFixed(4)}</span></span>`
        : `<span class="tag danger">Blocked</span>`;

      // ✅ HYBRID AUDIT (CAT-02)
      let auditHtml = "";
      if (k.rule_id === "CAT-02" && k.meta && typeof k.meta.auto_score === "number") {
        const autoS = Number(k.meta.auto_score);
        const finalS = Number(k.meta.final_score ?? score);
        const ov = !!k.meta.override_applied;
        const reason = safeText(k.meta.override_reason || "");
        const files =
          k.value && (k.value.whiteFile || k.value.lifeFile)
            ? ` • <span class="muted">Files:</span> ${safeText(k.value.whiteFile || "—")} | ${safeText(k.value.lifeFile || "—")}`
            : "";

        auditHtml = `
        <div class="kpi-sub" style="margin-top:4px">
          <span class="mono">AUTO=${autoS}</span> •
          <span class="mono">FINAL=${finalS}</span>
          ${ov ? `• <span class="tag warn small">OVERRIDE</span>` : `• <span class="tag ok small">AUTO</span>`}
          ${ov && reason ? `• <span class="muted">Reason:</span> ${safeText(reason)}` : ``}
          ${files}
        </div>
      `;
      }

      return `
      <tr data-q="${(safeText(k.rule_id) + " " + safeText(k.name) + " " + safeText(k.group) + " " + safeText(k.domain)).toLowerCase()}">
        <td>
          <div class="kpi-id mono">${safeText(k.rule_id)}</div>
          <span class="kpi-sub mono">w=${w.toFixed(4)}</span>
        </td>
        <td>
          <div class="kpi-name">${safeText(k.name)}</div>
          <span class="kpi-sub">${safeText(k.group || "—")} • ${safeText(k.domain || "—")}</span>
          ${auditHtml}
        </td>
        <td>${scoreTag}</td>
        <td>${impactTag}</td>
        <td>${groupTag} ${domainTag}</td>
      </tr>
    `;
    })
    .join("");

  // ✅ Link Dashboard: nếu offline/file:// -> tự sang mode=local
  const dashHref = withAssessmentId("DASHBOARD.html", assess.assessment_id);

  const main = $("mainRoot");
  if (!main) return;

  // ✅ Render toàn bộ layout trang RESULTS
  main.innerHTML = `
    <section class="section">
      <div class="section-head">
        <div class="left">📌 Tổng quan kết quả</div>
        <div class="right">
          <span class="badge big ${gateB.cls}">${gateB.icon} ${gateB.text}</span>
          <span class="badge big ${tierM.cls}">${tierM.icon} Tier: ${tierM.label}</span>
        </div>
      </div>

      <div class="section-body">
        <div class="hero">
          <div class="hero-card">
            <div class="hero-top">
              <div class="hero-title">
                <div class="h"><span class="dot"></span> MRSM_Final</div>
                <div class="sub">
                  <span><span class="muted">Assessment:</span> <span class="mono">${safeText(assessmentId)}</span></span>
                  <span><span class="muted">Evaluated at:</span> <span class="mono">${safeText(evaluatedAt)}</span></span>
                </div>
              </div>
              <span class="pill big">${isPass ? "Gate PASS → Score valid" : "Gate not PASS → Score forced 0"}</span>
            </div>

            <div style="margin-top:14px; padding:14px; border-radius:16px; border:1px solid #eee;">
              <div style="display:flex; align-items:baseline; gap:10px;">
                <div style="font-size:56px; font-weight:1000; color:${tone.color}; line-height:1;">
                  ${Number.isFinite(finalScore) ? Math.round(finalScore) : 0}
                </div>
                <div style="font-weight:900; color:#6B7280">/100</div>
                <span style="margin-left:auto; padding:6px 10px; border-radius:999px; font-weight:1000; background:${tone.bg}; color:${tone.color};">
                  ${tone.label}
                </span>
              </div>

              <div style="margin-top:12px; height:12px; background:#E5E7EB; border-radius:999px; overflow:hidden;">
                <div style="height:100%; width:${Math.max(0, Math.min(100, finalScore))}%; background:${tone.color}; border-radius:999px;"></div>
              </div>

              <div style="margin-top:8px; color:#6B7280; font-size:12px; font-weight:700;">
                Ngưỡng màu: <b>&lt;60</b> đỏ • <b>≥60</b> xanh
              </div>
            </div>

            <div style="margin-top:10px" class="muted">${safeText(tierM.desc)}</div>

            <div class="kv">
              <div class="item"><div class="k">Shop</div><div class="v">${safeText(shopName)}</div></div>
              <div class="item"><div class="k">Shop ID</div><div class="v mono">${safeText(shopId)}</div></div>
              <div class="item"><div class="k">Assessment ID</div><div class="v mono">${safeText(assessmentId)}</div></div>
              <div class="item"><div class="k">Gate status</div><div class="v">${gateB.icon} ${gateB.text}</div></div>
            </div>
          </div>

          <div class="hero-card">
            <div class="callout ${calloutCls}">
              <h4>${calloutTitle}</h4>
              <p>${safeText(calloutDesc)}</p>
              ${calloutListHtml}
            </div>

            <div style="height:12px"></div>

            <div class="callout info">
              <h4>ℹ️ Quy tắc hiển thị (thesis-aligned)</h4>
              <p>
                <b>Không</b> dùng group score làm “kết quả cuối” khi gate chưa PASS.
                Group có thể hiển thị nhưng sẽ bị gắn nhãn <b>Blocked by gate</b>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="left">🧩 Group breakdown</div>
        <div class="right">
          <span class="pill">Operation • Brand • Category • Scale</span>
          ${isPass ? `<span class="badge ok">✅ Pass gate</span>` : `<span class="badge danger">⛔ Blocked</span>`}
        </div>
      </div>
      <div class="section-body">
        <div class="group-grid">${groupCards}</div>
        ${isPass ? "" : `<div style="margin-top:10px" class="muted">* Gate chưa PASS: group score chỉ để tham khảo (không được xem là kết quả cuối).</div>`}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="left">🛠️ Fixlist ưu tiên</div>
        <div class="right">
          <span class="pill">${isPass ? "Top 5 ImpactGap" : "P0 Gate fixes only"}</span>
        </div>
      </div>
      <div class="section-body">
        <div class="list">${fixlistHtml}</div>
        <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
          ${isPass
      ? `<span class="tag info">ImpactGap = (100 - score) × weight_final</span>
                 <span class="tag">Tie-break: Operation &gt; Brand &gt; Category &gt; Scale</span>`
      : `<span class="tag danger">Gate != PASS → Fixlist chỉ gồm hard/soft gate fail</span>
                 <span class="tag">Priority = P0</span>`
    }
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="left">📊 KPI details</div>
        <div class="right">
          <span class="pill">${allKpis.length} KPIs</span>
          ${isPass ? `<span class="badge ok">✅ Score valid</span>` : `<span class="badge danger">⛔ Blocked by gate</span>`}
        </div>
      </div>
      <div class="section-body">
        <div class="toolbar">
          <div class="search">
            <div class="ico">🔎</div>
            <input id="searchInput" placeholder="Tìm KPI theo Rule ID / tên / group..." />
          </div>
          <button class="btn light" id="btnExport" type="button">⬇️ Export JSON</button>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>KPI</th>
                <th>Score</th>
                <th>${isPass ? "ImpactGap" : "Status"}</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody id="kpiTbody">
              ${rows || `<tr><td colspan="5" class="muted">Không có KPI.</td></tr>`}
            </tbody>
          </table>
        </div>

        ${!isPass ? `<div style="margin-top:10px" class="muted">* Gate chưa PASS: cột ImpactGap hiển thị Blocked.</div>` : ""}
      </div>
    </section>

    <div class="footer-actions">
      <div class="footer-right" style="margin-left:auto; display:flex; gap:10px; flex-wrap:wrap;">
        <a class="btn light" href="KPI_SCORING.html">🧮 Xem trang KPI</a>
        <a class="btn primary" id="footerDashboardLink" href="${dashHref}">📈 Xem Dashboard (mô tả dữ liệu)</a>
      </div>
    </div>
  `;

  // ✅ Search KPI tại bảng
  const input = $("searchInput");
  const tbody = $("kpiTbody");
  if (input && tbody) {
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      tbody.querySelectorAll("tr").forEach((tr) => {
        const hay = tr.getAttribute("data-q") || "";
        tr.style.display = !q || hay.includes(q) ? "" : "none";
      });
    });
  }

  // ✅ Export JSON (tải file assessment_*.json)
  $("btnExport")?.addEventListener("click", () => {
    try {
      const blob = new Blob([JSON.stringify(assess, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `assessment_${assessmentId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("success", "Export thành công", `Đã tải assessment_${assessmentId}.json`);
    } catch (e) {
      showToast("error", "Export lỗi", e?.message || "Không thể export JSON.");
    }
  });

  // ✅ Sau khi render xong, sync lại link Dashboard để click luôn hoạt động
  if (assess.assessment_id) syncDashboardLinks(assess.assessment_id);
}
/* ============================================================
   ✅ LOAD DATA
   - Nếu có assessment_id -> gọi API
   - Nếu không có assessment_id -> đọc localStorage (assessment_result)
   - Đồng thời lưu assessment_record_local để DASHBOARD đọc được khi mode=local
============================================================ */
async function load() {
  const assessmentId = getQueryParam("assessment_id");

  // ✅ Offline/local mode: không có assessment_id
  if (!assessmentId) {
    const raw = localStorage.getItem("assessment_result");
    const local = raw ? safeParseJson(raw) : null;

    if (!local) {
      renderEmpty("Thiếu assessment_id và không có assessment_result trong localStorage.");
      return;
    }

    const assess = adaptLocalAssessment(local);

    // ✅ LƯU record để DASHBOARD đọc được khi offline/file://
    localStorage.setItem("assessment_record_local", JSON.stringify(assess));

    render(assess);
    return;
  }

  // ✅ Online mode: có assessment_id -> gọi API
  try {
    const url = `/api/assessments/${encodeURIComponent(assessmentId)}`;
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${res.status}: ${text || "Request failed"}`);
    }

    const data = await res.json();
    if (!data || !data.assessment_id) {
      renderEmpty("API trả về dữ liệu không hợp lệ.");
      return;
    }

    render(data);
    localStorage.setItem("assessment_record_local", JSON.stringify({
      ...data,
      evaluated_at: data.evaluated_at || data.evaluatedAt || new Date().toISOString()
    }));
  } catch (err) {
    console.error(err);
    renderEmpty(err?.message || "Không thể gọi API.");
  }
}

/* ============================================================
   ✅ INIT (chỉ 1 lần)
============================================================ */
document.addEventListener("DOMContentLoaded", load);
