/******************************************************************************
 * KO GATE VALIDATION SCRIPT – SMROS / MRSM (HARD KO)
 *
 * HARD KO (Page 1):
 *  - KO-01/02/03/04: PDF + filename contains keyword
 *  - KO-05: months validity > 6
 *  - KO-06: no severe violation => must be "Có"
 *  - KO-07: domain format valid + DNS A record via Google DoH
 *
 * TOTAL FIELDS TRACKED:
 *  6 shop fields + 7 KO fields = 13
 ******************************************************************************/

/* =========================================
   1) CONFIG & GLOBAL STATE
   ========================================= */

const FILE_KEYWORDS = {
  ko01: ["giấy phép kinh doanh", "gpkd"],
  ko02: ["nhãn hiệu", "đăng ký nhãn", "quy tắc sử dụng"],
  ko03: ["ủy quyền", "nguồn gốc", "phân phối"],
  ko04: ["giấy công bố", "hồ sơ công bố", "công bố sản phẩm"]
};

const validationState = {
  // Shop info (6)
  companyName: false,
  businessLicenseNo: false,
  brandName: false,
  shopId: false,
  userId: false,
  username: false,

  // KO (7)
  ko01: false,
  ko02: false,
  ko03: false,
  ko04: false,
  ko05: false, // months validity
  ko06: false, // severe violation (select)
  ko07: false  // domain
};

let redirectTimer = null;


/* =========================================
   2) HELPERS (UTILITY FUNCTIONS)
   ========================================= */

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function normText(s) {
  return (s || "").toLowerCase().trim();
}

function normalizeDomain(input) {
  let domain = (input || "").trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");
  domain = domain.split("/")[0].split("?")[0].split("#")[0];
  return domain;
}

function isValidDomainFormat(domain) {
  const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/;
  return domainRegex.test(domain);
}

async function checkDomainDNS(domain) {
  try {
    const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`;
    const response = await fetch(url);
    const data = await response.json();
    return data?.Status === 0 && Array.isArray(data?.Answer) && data.Answer.length > 0;
  } catch (error) {
    console.error("DNS check error:", error);
    return false;
  }
}

function setStatusUI(elementId, isPass, message = "") {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.style.display = "inline-block";

  if (isPass) {
    el.innerHTML = `✅ PASS ${message}`.trim();
    el.className = "status-badge pass";
  } else {
    el.innerHTML = `❌ FAIL ${message}`.trim();
    el.className = "status-badge fail";
  }

  updateProgressChecklist();
  evaluateFinalGate();
}

/* =========================================
   3) VALIDATION (CORE RULES)
   ========================================= */

function validateShopInfo(fieldId) {
  const input = document.getElementById(fieldId);
  const isValid = !!input && input.value.trim() !== "";
  validationState[fieldId] = isValid;

  updateProgressChecklist();
  evaluateFinalGate();
}

function validateFileField(fileId) {
  const fileInput = document.getElementById(fileId);
  const file = fileInput?.files?.[0];
  const statusId = `status-${fileId}`;
  const fileNameEl = document.getElementById(`${fileId}-name`);
  const keywords = FILE_KEYWORDS[fileId] || [];

  // 1) Required
  if (!file) {
    setStatusUI(statusId, false, "(Chưa chọn file)");
    validationState[fileId] = false;
    if (fileNameEl) fileNameEl.textContent = "Chưa chọn file";
    return;
  }

  // Show filename
  if (fileNameEl) fileNameEl.textContent = file.name;

  // 2) PDF only
  const lowerName = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
  if (!isPdf) {
    setStatusUI(statusId, false, "(Chỉ chấp nhận file PDF)");
    validationState[fileId] = false;
    fileInput.value = "";
    if (fileNameEl) fileNameEl.textContent = "Chưa chọn file";
    return;
  }

  // 3) Keyword check
  const fn = normText(file.name);
  const hasKey = keywords.some(k => fn.includes(normText(k)));

  if (!hasKey) {
    setStatusUI(statusId, false, `(Thiếu từ khóa: ${keywords[0] || "keyword"})`);
    validationState[fileId] = false;
    return;
  }

  // Pass
  validationState[fileId] = true;
  setStatusUI(statusId, true);
}

function validateKO05() {
  const input = document.getElementById("ko05");
  const raw = input ? input.value : "";
  const months = Number(raw);

  const isValid = raw !== "" && !Number.isNaN(months) && months > 6;
  validationState.ko05 = isValid;
  setStatusUI("status-ko05", isValid, isValid ? "" : "(Phải > 6 tháng)");
}

function validateKO06() {
  const select = document.getElementById("ko06");
  const isValid = !!select && select.value === "Có";

  validationState.ko06 = isValid;
  setStatusUI("status-ko06", isValid, isValid ? "" : "(Chỉ 'Có' mới đạt)");
}

async function validateKO07() {
  const input = document.getElementById("ko07");
  const badge = document.getElementById("status-ko07");
  if (!input || !badge) return;

  const rawInput = input.value.trim();

  // Empty => hide badge & mark fail
  if (rawInput === "") {
    badge.style.display = "none";
    validationState.ko07 = false;
    updateProgressChecklist();
    evaluateFinalGate();
    return;
  }

  const domain = normalizeDomain(rawInput);

  // Format check
  if (!isValidDomainFormat(domain)) {
    badge.textContent = "❌ Không hợp lệ: sai định dạng domain";
    badge.className = "status-badge invalid";
    badge.style.display = "inline-block";
    validationState.ko07 = false;
    updateProgressChecklist();
    evaluateFinalGate();
    return;
  }

  // Checking state
  badge.textContent = "⏳ Đang kiểm tra DNS...";
  badge.className = "status-badge checking";
  badge.style.display = "inline-block";
  validationState.ko07 = false;
  updateProgressChecklist();
  evaluateFinalGate();

  // DNS check
  const dnsOk = await checkDomainDNS(domain);

  if (dnsOk) {
    badge.textContent = `✅ Hợp lệ: ${domain}`;
    badge.className = "status-badge valid";
    validationState.ko07 = true;
  } else {
    badge.textContent = "❌ Không hợp lệ: domain không tồn tại DNS A record";
    badge.className = "status-badge invalid";
    validationState.ko07 = false;
  }

  badge.style.display = "inline-block";
  updateProgressChecklist();
  evaluateFinalGate();
}

/* =========================================
   4) UX: PROGRESS + GATE + RESET + NAV
   ========================================= */

function updateProgressChecklist() {
  const total = Object.keys(validationState).length; // 13
  const completed = Object.values(validationState).filter(v => v === true).length;

  // Total progress
  const progressEl = document.getElementById("progress-text");
  if (progressEl) progressEl.innerText = `Hoàn thành hồ sơ: ${completed}/${total}`;

  // Group 1: Shop info (6 fields)
  const checkShop = document.getElementById("check-shop");
  const shopCompleted = [
    validationState.companyName,
    validationState.businessLicenseNo,
    validationState.brandName,
    validationState.shopId,
    validationState.userId,
    validationState.username
  ].every(v => v === true);

  if (checkShop) {
    if (shopCompleted) {
      checkShop.classList.add("completed");
      checkShop.querySelector(".check-icon").textContent = "✓";
    } else {
      checkShop.classList.remove("completed");
      checkShop.querySelector(".check-icon").textContent = "○";
    }
  }

  // Group 2: Files (4)
  const checkFiles = document.getElementById("check-files");
  const filesCompleted = [validationState.ko01, validationState.ko02, validationState.ko03, validationState.ko04]
    .filter(v => v).length;

  if (checkFiles) {
    const fileText = checkFiles.querySelector("span:last-child");
    if (fileText) fileText.textContent = `Tài liệu KO (${filesCompleted}/4)`;

    if (filesCompleted === 4) {
      checkFiles.classList.add("completed");
      checkFiles.querySelector(".check-icon").textContent = "✓";
    } else {
      checkFiles.classList.remove("completed");
      checkFiles.querySelector(".check-icon").textContent = "○";
    }
  }

  // Group 3: Extra info (3): ko05, ko06, ko07
  const checkMetrics = document.getElementById("check-metrics");
  const metricsCompleted = [validationState.ko05, validationState.ko06, validationState.ko07].filter(v => v).length;

  if (checkMetrics) {
    const metricText = checkMetrics.querySelector("span:last-child");
    if (metricText) metricText.textContent = `Thông tin bổ sung (${metricsCompleted}/3)`;

    if (metricsCompleted === 3) {
      checkMetrics.classList.add("completed");
      checkMetrics.querySelector(".check-icon").textContent = "✓";
    } else {
      checkMetrics.classList.remove("completed");
      checkMetrics.querySelector(".check-icon").textContent = "○";
    }
  }
}

function evaluateFinalGate() {
  const isAllValid = Object.values(validationState).every(v => v === true);
  const nextBtn = document.getElementById("nextBtn");
  const finalMsg = document.getElementById("final-ko-status");
  const finalContainer = document.getElementById("final-status-container");

  if (nextBtn) {
    nextBtn.disabled = !isAllValid;
    isAllValid ? nextBtn.classList.remove("disabled") : nextBtn.classList.add("disabled");
  }

  // Only update final message if container is visible (after click)
  if (finalMsg && finalContainer && finalContainer.style.display !== "none") {
    if (isAllValid) {
      finalMsg.innerHTML = "✅ HỒ SƠ HỢP LỆ - CỔNG ĐÃ MỞ";
      finalMsg.className = "final-msg pass";
    } else {
      finalMsg.innerHTML = "❌ HỒ SƠ CHƯA ĐẠT - VUI LÒNG HOÀN THIỆN CÁC MỤC ĐỎ";
      finalMsg.className = "final-msg fail";
    }
  }
}

function resetForm() {
  // 🧹 DỪNG countdown nếu đang chạy
  if (redirectTimer) {
    clearInterval(redirectTimer);
    redirectTimer = null;
  }

  // Ẩn popup thành công nếu đang mở
  const modal = document.getElementById("successModal");
  if (modal) modal.style.display = "none";

  // Disable nút Kiểm tra (sẽ được bật lại khi đủ điều kiện)
  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) nextBtn.disabled = true;

  /* ===== CLEAR INPUTS ===== */

  // Shop + extra fields
  [
    "companyName",
    "businessLicenseNo",
    "brandName",
    "shopId",
    "userId",
    "username",
    "ko05",
    "ko06",
    "ko07"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // File inputs
  ["ko01", "ko02", "ko03", "ko04"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // Reset file name labels
  ["ko01-name", "ko02-name", "ko03-name", "ko04-name"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = "Chưa chọn file";
  });

  /* ===== RESET STATE ===== */

  Object.keys(validationState).forEach(k => {
    validationState[k] = false;
  });

  // Reset status badges
  [
    "status-ko01",
    "status-ko02",
    "status-ko03",
    "status-ko04",
    "status-ko05",
    "status-ko06",
    "status-ko07"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = "none";
    el.textContent = "CHƯA KIỂM TRA";
    el.className = "status-badge";
  });

  // Ẩn box kết quả cuối
  const finalContainer = document.getElementById("final-status-container");
  if (finalContainer) finalContainer.style.display = "none";

  // Cập nhật lại UI
  updateProgressChecklist();
  evaluateFinalGate();
}


function handleNavigation() {
  const finalContainer = document.getElementById("final-status-container");
  if (finalContainer) finalContainer.style.display = "block";

  evaluateFinalGate();

  const isAllValid = Object.values(validationState).every(v => v === true);

  // ❌ Chưa đạt → giữ hành vi cũ
  if (!isAllValid) {
    finalContainer?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (finalContainer) finalContainer.style.display = "none";

  /* ===== PASS HARD KO ===== */

  // 1. Lưu sessionStorage (giữ nguyên logic)
  const exportData = {
    shopInfo: {
      companyName: document.getElementById("companyName")?.value || "",
      businessLicenseNo: document.getElementById("businessLicenseNo")?.value || "",
      brandName: document.getElementById("brandName")?.value || "",
      shopId: document.getElementById("shopId")?.value || "",
      userId: document.getElementById("userId")?.value || "",
      username: document.getElementById("username")?.value || ""
    },
    metrics: {
      ko05_months: document.getElementById("ko05")?.value || "",
      ko06_noSevereViolation: document.getElementById("ko06")?.value || "",
      ko07_domain: document.getElementById("ko07")?.value || ""
    },
    files: {
      ko01: document.getElementById("ko01")?.files?.[0]?.name || "",
      ko02: document.getElementById("ko02")?.files?.[0]?.name || "",
      ko03: document.getElementById("ko03")?.files?.[0]?.name || "",
      ko04: document.getElementById("ko04")?.files?.[0]?.name || ""
    },
    verifiedAt: new Date().toISOString()
  };

  sessionStorage.setItem("validatedHardKO", JSON.stringify(exportData));
  // ===== INIT SOFT KO GATE (7-day window) =====
  const verifiedAt = new Date(exportData.verifiedAt);
  const deadlineAt = new Date(verifiedAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  const softGateInit = {
    verified_at: exportData.verifiedAt,
    gate_status: "G1",
    soft: {
      deadline_at: deadlineAt.toISOString(),
      items: {
        "OP-04": { passed: false, note: "", fixed_at: null },
        "PEN-01": { passed: false, note: "", fixed_at: null },
        "CO-01": { passed: false, note: "", fixed_at: null },
        "SC-02": { passed: false, note: "", fixed_at: null }
      }
    }
  };

  localStorage.setItem("soft_ko_gate", JSON.stringify(softGateInit));

  // Lưu để SOFT_KO.html + RESULTS đọc được
  localStorage.setItem("soft_ko_gate", JSON.stringify(softGateInit));

  // 2. Hiện popup HỒ SƠ HỢP LỆ
  const modal = document.getElementById("successModal");
  const countdownEl = document.getElementById("redirectCountdown");

  if (modal) modal.style.display = "flex";

  //  KHÓA NÚT, KHÔNG CHO BẤM NHIỀU LẦN
  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) nextBtn.disabled = true;

  // Nếu có timer cũ thì xóa
  if (redirectTimer) clearInterval(redirectTimer);

  // 3. Đếm ngược 10s → tự chuyển trang
  let seconds = 10;
  if (countdownEl) countdownEl.textContent = seconds;

  redirectTimer = setInterval(() => {
    seconds--;
    if (countdownEl) countdownEl.textContent = Math.max(seconds, 0);

    if (seconds <= 0) {
      clearInterval(redirectTimer);
      window.location.href = "SOFT_KO.html";
    }
  }, 1000);

}
function restoreHardKOFromSession() {
  const raw = sessionStorage.getItem("validatedHardKO");
  if (!raw) return;

  let data;
  try { data = JSON.parse(raw); } catch { return; }

  const shop = data.shopInfo || {};
  const metrics = data.metrics || {};

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? "";
  };

  // Shop fields
  setVal("companyName", shop.companyName);
  setVal("businessLicenseNo", shop.businessLicenseNo);
  setVal("brandName", shop.brandName);
  setVal("shopId", shop.shopId);
  setVal("userId", shop.userId);
  setVal("username", shop.username);

  // KO extra fields
  setVal("ko05", metrics.ko05_months);
  setVal("ko06", metrics.ko06_noSevereViolation);
  setVal("ko07", metrics.ko07_domain);

  // Re-validate để update UI/State
  ["companyName", "businessLicenseNo", "brandName", "shopId", "userId", "username"].forEach(validateShopInfo);
  validateKO05();
  validateKO06();
  validateKO07(); // async DNS check
}


/* =========================================
   5) INIT EVENT LISTENERS
   ========================================= */

document.addEventListener("DOMContentLoaded", () => {
  // Shop info (6 fields)
  ["companyName", "businessLicenseNo", "brandName", "shopId", "userId", "username"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", () => validateShopInfo(id));
  });

  // File uploads (4 files)
  document.getElementById("ko01")?.addEventListener("change", () => validateFileField("ko01"));
  document.getElementById("ko02")?.addEventListener("change", () => validateFileField("ko02"));
  document.getElementById("ko03")?.addEventListener("change", () => validateFileField("ko03"));
  document.getElementById("ko04")?.addEventListener("change", () => validateFileField("ko04"));

  // KO-05 months (debounce)
  const debouncedKO05 = debounce(validateKO05, 500);
  document.getElementById("ko05")?.addEventListener("input", debouncedKO05);

  // KO-06 select
  document.getElementById("ko06")?.addEventListener("change", validateKO06);

  // KO-07 domain (debounce + async DNS)
  const debouncedKO07 = debounce(() => validateKO07(), 800);
  document.getElementById("ko07")?.addEventListener("input", debouncedKO07);

  // Buttons
  document.getElementById("nextBtn")?.addEventListener("click", handleNavigation);
  document.getElementById("resetBtn")?.addEventListener("click", resetForm);

  // Initial paint
  updateProgressChecklist();
  evaluateFinalGate();
  restoreHardKOFromSession();

});
