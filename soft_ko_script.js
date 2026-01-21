// Configuration for all input fields with updated thresholds
const inputs = {
    op04: {
        id: 'op04',
        threshold: 85,
        type: 'percentage',
        direction: 'min',
        name: 'Tỷ lệ giao hàng nhanh',
        passText: 'Đạt chuẩn vận hành',
        failText: 'Cần cải thiện (≥ 85%)'
    },
    pen01: {
        id: 'pen01',
        threshold: 2,
        type: 'number',
        direction: 'max',
        name: 'Sao Quả Tạ',
        passText: 'Hợp lệ',
        failText: 'Vi phạm (Tối đa 2)'
    },
    co01: {
        id: 'co01',
        threshold: 10,
        type: 'percentage',
        direction: 'max',
        name: 'Tỷ lệ đặt hàng trước (Pre-order)',
        passText: 'Tỷ lệ chuẩn',
        failText: 'Vượt ngưỡng cho phép'
    },
    sc02: {
        id: 'sc02',
        threshold: 1,
        type: 'number',
        direction: 'min',
        name: 'Số đơn hàng 4 tuần',
        passText: 'Shop bạn có hoạt động buôn bán trong thời gian xét duyệt',
        failText: 'Chưa có phát sinh đơn hàng'
    }
};

// ===== SOFT KO GATE STORAGE (THESIS) =====
const SOFT_GATE_KEY = "soft_ko_gate";
const SOFT_GATE_LOCK_KEY = "soft_ko_gate_locked"; // chỉ lock sau khi bấm Xem kết quả
const HARD_KO_KEY = "validatedHardKO"; // bạn đang lưu ở sessionStorage từ KO_GATE

function safeParse(raw) { try { return JSON.parse(raw); } catch { return null; } }

function initSoftGateIfMissing() {
    // nếu đã có gate thì thôi
    const existing = localStorage.getItem(SOFT_GATE_KEY);
    if (existing) return safeParse(existing);

    // lấy verifiedAt từ hard KO (ưu tiên)
    const hardRaw = sessionStorage.getItem(HARD_KO_KEY);
    const hard = hardRaw ? safeParse(hardRaw) : null;

    const verifiedAtIso = hard?.verifiedAt || new Date().toISOString();
    const verifiedAt = new Date(verifiedAtIso);
    const deadlineAt = new Date(verifiedAt.getTime() + 7 * 24 * 60 * 60 * 1000);

    const gate = {
        verified_at: verifiedAt.toISOString(),
        gate_status: "G1",
        soft: {
            deadline_at: deadlineAt.toISOString(),
            items: {
                "OP-04": { passed: false, note: "", fixed_at: null, regressed_at: null },
                "PEN-01": { passed: false, note: "", fixed_at: null, regressed_at: null },
                "CO-01": { passed: false, note: "", fixed_at: null, regressed_at: null },
                "SC-02": { passed: false, note: "", fixed_at: null, regressed_at: null }
            }
        }
    };

    localStorage.setItem(SOFT_GATE_KEY, JSON.stringify(gate));
    return gate;
}

function evaluateSoftGateStatus(gate) {
    const items = gate?.soft?.items || {};
    const allPassed = Object.values(items).every(x => x?.passed === true);
    if (allPassed) return "PASS";

    const deadlineIso = gate?.soft?.deadline_at;
    if (!deadlineIso) return "G1";

    const now = new Date();
    const deadline = new Date(deadlineIso);
    if (Number.isNaN(deadline.getTime())) return "G1";

    return now <= deadline ? "G1" : "G2";
}

function getRuleIdByKey(key) {
    const RULE_MAP = { op04: "OP-04", pen01: "PEN-01", co01: "CO-01", sc02: "SC-02" };
    return RULE_MAP[key];
}

function sanitizeByType(config, rawString) {
    // Trả về: { hasValue, value }
    // - percentage: auto clamp 0–100
    // - number: không cho số âm (clamp >= 0)
    if (rawString === '' || rawString === null || rawString === undefined) {
        return { hasValue: false, value: NaN };
    }

    let v = parseFloat(rawString);
    if (Number.isNaN(v)) return { hasValue: false, value: NaN };

    if (config.type === 'percentage') {
        if (v < 0) v = 0;
        if (v > 100) v = 100;
    } else if (config.type === 'number') {
        if (v < 0) v = 0;
    }

    return { hasValue: true, value: v };
}


function disableAllInputs() {
    Object.keys(inputs).forEach(key => {
        const el = document.getElementById(inputs[key].id);
        if (el) el.disabled = true;
    });
}

function enableAllInputs() {
    const locked = (localStorage.getItem(SOFT_GATE_LOCK_KEY) === "1");
    if (locked) return;

    Object.keys(inputs).forEach(key => {
        const el = document.getElementById(inputs[key].id);
        if (el) el.disabled = false;
    });
}


/**
 * Validate a single input field
 * @param {string} key - The key from inputs config
 * @returns {boolean} - Whether the input passes validation
 */

function validateInput(key) {
    const config = inputs[key];
    const input = document.getElementById(config.id);
    if (!input) return false;

    const ruleId = getRuleIdByKey(key);

    const checkItem = document.getElementById(`check-${key}`);
    const badge = document.getElementById(`badge-${key}`);
    const hint = document.getElementById(`hint-${key}`);

    // đảm bảo gate tồn tại
    const gate = initSoftGateIfMissing();

    // Freeze CHỈ khi user đã bấm "Xem kết quả"
    const locked = (localStorage.getItem(SOFT_GATE_LOCK_KEY) === "1");
    if (locked) {
        input.disabled = true;

        const item = gate?.soft?.items?.[ruleId];
        const passed = item?.passed === true;

        if (checkItem) {
            checkItem.classList.toggle('completed', passed);
            const icon = checkItem.querySelector('.check-icon');
            if (icon) icon.textContent = passed ? '✓' : '○';
        }
        if (badge) {
            badge.classList.remove('pass', 'fail', 'success', 'warning', 'info');
            badge.classList.add(passed ? 'pass' : 'fail');
        }
        if (hint) hint.textContent = passed ? (config.passText || '') : (config.failText || '');

        return passed;
    }

    // gate chưa PASS thì cho chỉnh input
    input.disabled = false;

    // (2) sanitize theo type
    const raw = input.value;
    const sanitized = sanitizeByType(config, raw);

    // Empty/invalid: chỉ update UI, KHÔNG ghi gate nếu user chưa nhập (3)
    if (!sanitized.hasValue) {
        if (checkItem) {
            checkItem.classList.remove('completed');
            const icon = checkItem.querySelector('.check-icon');
            if (icon) icon.textContent = '○';
        }
        if (hint) hint.textContent = 'Chưa nhập dữ liệu';
        if (badge) badge.classList.remove('pass', 'fail');

        return false;
    }

    // sync lại value đã clamp (percentage/number)
    if (String(raw) !== String(sanitized.value)) {
        input.value = String(sanitized.value);
    }

    const value = sanitized.value;

    // Validate against requirements
    let isValid = false;
    if (config.direction === 'min') {
        isValid = value >= config.threshold;
    } else {
        isValid = value <= config.threshold;
    }

    // Update UI based on validation result
    if (isValid) {
        if (checkItem) {
            checkItem.classList.add('completed');
            const icon = checkItem.querySelector('.check-icon');
            if (icon) icon.textContent = '✓';
        }
        if (badge) {
            badge.classList.remove('success', 'warning', 'info', 'fail');
            badge.classList.add('pass');
        }
        if (hint) hint.textContent = config.passText;
    } else {
        if (checkItem) {
            checkItem.classList.remove('completed');
            const icon = checkItem.querySelector('.check-icon');
            if (icon) icon.textContent = '○';
        }
        if (badge) {
            badge.classList.remove('pass', 'success', 'warning', 'info');
            badge.classList.add('fail');
        }
        if (hint) hint.textContent = config.failText;
    }

    // ===== UPDATE SOFT KO GATE (passed / fixed_at / regressed_at) =====
    // (3) Chỉ ghi gate khi input.value !== "" (đã có tương tác)
    if (gate && ruleId && input.value !== '') {
        const item = gate.soft.items[ruleId] || { passed: false, note: '', fixed_at: null, regressed_at: null };
        const prevPassed = item.passed === true;

        item.passed = isValid;
        item.note = isValid ? '' : (config.failText || 'Chưa đạt');

        // (4) fixed_at: chỉ set khi PASS, và chỉ set lần đầu (giữ audit)
        if (isValid) {
            item.fixed_at = item.fixed_at || new Date().toISOString();
        } else {
            // không reset fixed_at; nếu FAIL lại sau khi từng PASS thì ghi regressed_at
            if (prevPassed && item.fixed_at) {
                item.regressed_at = new Date().toISOString();
            }
        }

        gate.soft.items[ruleId] = item;
        gate.gate_status = evaluateSoftGateStatus(gate);

        localStorage.setItem(SOFT_GATE_KEY, JSON.stringify(gate));
    }

    return isValid;
}

/**
 * Update the progress counter and enable/disable next button
 */

function updateProgress() {
    // đảm bảo gate tồn tại
    const gate = initSoftGateIfMissing();

    // đếm số tiêu chí PASS
    const items = gate?.soft?.items || {};
    const passCount =
        (items["OP-04"]?.passed ? 1 : 0) +
        (items["PEN-01"]?.passed ? 1 : 0) +
        (items["CO-01"]?.passed ? 1 : 0) +
        (items["SC-02"]?.passed ? 1 : 0);

    const progressText = document.getElementById('progress-text');
    if (progressText) progressText.textContent = `Đạt: ${passCount}/4 chỉ số`;

    const nextBtn = document.getElementById('nextBtn');
    const status = gate?.gate_status || "G1";

    const canNext = (status === "PASS");
    const locked = (localStorage.getItem(SOFT_GATE_LOCK_KEY) === "1");

    if (canNext) {
        if (nextBtn) {
            nextBtn.classList.remove('disabled');
            nextBtn.disabled = false;
            nextBtn.textContent = "Xem kết quả";
        }
        // KHÔNG freeze ở đây nữa
        if (locked) disableAllInputs();
        else enableAllInputs();
    } else {
        if (nextBtn) {
            nextBtn.classList.add('disabled');
            nextBtn.disabled = true;
            nextBtn.textContent = `Chưa đạt (Gate: ${status})`;
        }
        enableAllInputs();
    }
}

function syncAllInputsToGateAndUI() {
    const failedCriteria = [];

    Object.keys(inputs).forEach(key => {
        const cfg = inputs[key];
        const el = document.getElementById(cfg.id);
        const ok = validateInput(key);

        // Nếu input rỗng hoặc fail => add reason
        if (!el || el.value === '' || ok === false) {
            failedCriteria.push(cfg.name);
        }
    });

    updateProgress();

    // unique list
    return Array.from(new Set(failedCriteria));
}

/**
 * Format date to Vietnamese format (DD/MM/YYYY)
 * @param {Date} date - Date object to format
 * @returns {string} - Formatted date string
 */
function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

/**
 * Create and show modal with rejection information
 * @param {Array} failedCriteria - Array of failed criteria names
 */
function showRejectionModal(failedCriteria) {
    const today = new Date();
    const resubmitDate = new Date();
    resubmitDate.setDate(today.getDate() + 7);

    // Create modal HTML
    const modalHTML = `
        <div id="rejectionModal" style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            animation: fadeIn 0.3s ease;
        ">
            <div style="
                background: white;
                border-radius: 16px;
                padding: 32px;
                max-width: 500px;
                width: 90%;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                animation: slideUp 0.3s ease;
            ">
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="
                        width: 80px;
                        height: 80px;
                        background: #FEE2E2;
                        border-radius: 50%;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        margin-bottom: 16px;
                    ">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                            <path d="M12 8V12M12 16H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" 
                                stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>
                    <h2 style="
                        font-size: 24px;
                        font-weight: 700;
                        color: #DC2626;
                        margin: 0 0 8px 0;
                    ">Chưa đủ điều kiện</h2>
                    <p style="
                        font-size: 16px;
                        color: #6B7280;
                        margin: 0;
                    ">Bạn chưa đủ điều kiện tham gia xét duyệt Shopee Mall</p>
                </div>

                <div style="
                    background: #F9FAFB;
                    border-radius: 12px;
                    padding: 20px;
                    margin-bottom: 24px;
                ">
                    <div style="margin-bottom: 16px;">
                        <div style="
                            font-size: 13px;
                            color: #6B7280;
                            font-weight: 600;
                            margin-bottom: 4px;
                        ">📅 Ngày đăng ký xét</div>
                        <div style="
                            font-size: 16px;
                            color: #111827;
                            font-weight: 700;
                        ">${formatDate(today)}</div>
                    </div>

                    <div style="margin-bottom: 16px;">
                        <div style="
                            font-size: 13px;
                            color: #6B7280;
                            font-weight: 600;
                            margin-bottom: 4px;
                        ">⏱️ Thời gian cải thiện</div>
                        <div style="
                            font-size: 16px;
                            color: #111827;
                            font-weight: 700;
                        ">7 ngày</div>
                    </div>

                    <div style="margin-bottom: 16px;">
                        <div style="
                            font-size: 13px;
                            color: #6B7280;
                            font-weight: 600;
                            margin-bottom: 4px;
                        ">🔄 Ngày nộp lại hồ sơ</div>
                        <div style="
                            font-size: 16px;
                            color: #EE4D2D;
                            font-weight: 700;
                        ">${formatDate(resubmitDate)}</div>
                    </div>

                    <div>
                        <div style="
                            font-size: 13px;
                            color: #6B7280;
                            font-weight: 600;
                            margin-bottom: 8px;
                        ">❌ Lý do không đạt</div>
                        <div style="
                            background: #FEE2E2;
                            border-left: 4px solid #DC2626;
                            padding: 12px;
                            border-radius: 8px;
                        ">
                            ${failedCriteria.map(criteria => `
                                <div style="
                                    font-size: 14px;
                                    color: #991B1B;
                                    font-weight: 600;
                                    margin-bottom: 6px;
                                    display: flex;
                                    align-items: center;
                                    gap: 8px;
                                ">
                                    <span style="
                                        width: 6px;
                                        height: 6px;
                                        background: #DC2626;
                                        border-radius: 50%;
                                        flex-shrink: 0;
                                    "></span>
                                    <span>${criteria}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <div style="
                    display: flex;
                    gap: 12px;
                ">
                    <button onclick="closeModal()" style="
                        flex: 1;
                        padding: 14px 24px;
                        background: #6B7280;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        font-size: 15px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.2s;
                    " onmouseover="this.style.background='#4B5563'" onmouseout="this.style.background='#6B7280'">
                        Đóng
                    </button>
                    <button onclick="closeModal(); goBack();" style="
                        flex: 1;
                        padding: 14px 24px;
                        background: #EE4D2D;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        font-size: 15px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.2s;
                    " onmouseover="this.style.background='#D73211'" onmouseout="this.style.background='#EE4D2D'">
                        Quay lại chỉnh sửa
                    </button>
                </div>
            </div>
        </div>

        <style>
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes slideUp {
                from { transform: translateY(20px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            @keyframes fadeOut {
                from { opacity: 1; } 
                to { opacity: 0; }             
            }
        </style>
    `;

    // Insert modal into body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

/**
 * Close and remove modal
 */
function closeModal() {
    const modal = document.getElementById('rejectionModal');
    if (!modal) return;

    modal.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => modal.remove(), 300);
}

// ===== SUCCESS POPUP (SOFT KO) =====
let softRedirectTimer = null;

function showSuccessModalAndRedirect(nextUrl = "KPI_SCORING.html", seconds = 10) {
    // Xoá modal cũ nếu có
    const old = document.getElementById("successModal");
    if (old) old.remove();

    // Clear timer cũ nếu user bấm nhiều lần
    if (softRedirectTimer) {
        clearInterval(softRedirectTimer);
        softRedirectTimer = null;
    }

    // Tạo modal
    const modalHTML = `
    <div id="successModal" style="
      position: fixed; inset: 0;
      background: rgba(17,24,39,0.45);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; padding: 16px;
    ">
      <div style="
        width: min(420px, 100%);
        background: #fff;
        border: 1px solid #E5E7EB;
        border-radius: 14px;
        padding: 22px;
        box-shadow: 0 20px 45px rgba(0,0,0,0.18);
        text-align: center;
      ">
        <div style="font-size:38px; margin-bottom:8px;">✅</div>
        <h3 style="font-size:18px; font-weight:800; color:#065F46; margin:0 0 6px;">
          HỒ SƠ HỢP LỆ
        </h3>
        <p style="font-size:14px; color:#374151; margin:0;">
          Hệ thống sẽ tự động chuyển sang bước tiếp theo sau
          <b id="redirectCountdown">${seconds}</b> giây.
        </p>
      </div>
    </div>
  `;
    document.body.insertAdjacentHTML("beforeend", modalHTML);

    const countdownEl = document.getElementById("redirectCountdown");
    let remain = seconds;
    if (countdownEl) countdownEl.textContent = String(remain);

    softRedirectTimer = setInterval(() => {
        remain -= 1;
        if (countdownEl) countdownEl.textContent = String(Math.max(remain, 0));

        if (remain <= 0) {
            clearInterval(softRedirectTimer);
            softRedirectTimer = null;
            window.location.href = nextUrl;
        }
    }, 1000);
}

/**
 * Check gate and proceed to next step
 * - Clean: không lặp logic validate 2 lần
 */

function goNext() {
    const failedCriteria = [];

    // (1) Không duplicate logic: chỉ validate 1 lần để đồng bộ UI + gate
    Object.keys(inputs).forEach(k => {
        const cfg = inputs[k];
        const el = document.getElementById(cfg.id);
        const ok = validateInput(k);

        // add fail reason
        if (!el || String(el.value).trim() === '') failedCriteria.push(cfg.name);
        else if (!ok) failedCriteria.push(cfg.name);
    });

    updateProgress();

    const gate = initSoftGateIfMissing();
    if (gate?.gate_status === "PASS") {
        localStorage.setItem(SOFT_GATE_LOCK_KEY, "1");
        disableAllInputs();     // khóa ngay lập tức
        updateProgress();       // render lại trạng thái button/UI
        const data = {};
        Object.keys(inputs).forEach(key => {
            const input = document.getElementById(inputs[key].id);
            data[key] = input ? input.value : '';
        });

        sessionStorage.setItem("softKoData", JSON.stringify(data));
        window.softKoData = data;

        const nextBtn = document.getElementById("nextBtn");
        if (nextBtn) nextBtn.disabled = true;

        showSuccessModalAndRedirect("KPI_SCORING.html", 10);

    } else {
        showRejectionModal(Array.from(new Set(failedCriteria)));
    }
}

/**
 * Navigate back to previous page
 */
function goBack() {
    localStorage.removeItem(SOFT_GATE_LOCK_KEY); // cho phép sửa lại khi quay về
    window.location.href = 'KO_GATE.html';
}

/**
 * Initialize event listeners for all input fields
 */

function initializeEventListeners() {
    Object.keys(inputs).forEach(key => {
        const input = document.getElementById(inputs[key].id);
        if (!input) return;

        input.addEventListener('input', () => {
            const locked = (localStorage.getItem(SOFT_GATE_LOCK_KEY) === "1");
            if (locked) {
                disableAllInputs();
                updateProgress();
                return;
            }

            validateInput(key);
            updateProgress();
        });
    });
}

function restoreSoftKOFromSession() {
    const raw = sessionStorage.getItem("softKoData");
    if (!raw) return;

    let data;
    try { data = JSON.parse(raw); } catch { return; }

    Object.keys(inputs).forEach(key => {
        const cfg = inputs[key];
        const el = document.getElementById(cfg.id);
        if (!el) return;

        const v = data[key];
        if (v !== undefined && v !== null) el.value = v;
    });

    // Re-render UI theo gate / input
    Object.keys(inputs).forEach(key => validateInput(key));
    updateProgress();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    initSoftGateIfMissing();
    restoreSoftKOFromSession();
    updateProgress();

    // Nếu đã lock từ lần trước (đã bấm "Xem kết quả") thì khóa toàn bộ input
    if (localStorage.getItem(SOFT_GATE_LOCK_KEY) === "1") {
        disableAllInputs();
    }

    // Bấm "Tiếp theo" sẽ chạy goNext (popup + countdown)
    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.preventDefault(); // tránh reload nếu button nằm trong form
            goNext();
        });
    }
});

