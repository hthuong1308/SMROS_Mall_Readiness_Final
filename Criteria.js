// Shopee Mall Readiness – Criteria page scripts
// Split from original single-file version.
// UI tweaks: search (non-destructive), nav highlight (IntersectionObserver), Ctrl/Cmd+K focus search.

'use strict';

// ========== DATA KO GATE ==========
const koData = [
    {
        title: "Pháp lý – Ủy quyền",
        desc: "Giấy phép kinh doanh, nhãn hiệu, chứng từ phân phối/nhập khẩu, chứng từ chất lượng (nếu ngành bắt buộc).",
        failExamples: [
            "GPKD hết hạn hoặc không hợp lệ",
            "Không có giấy ủy quyền sử dụng nhãn hiệu",
            "Thiếu chứng từ nhập khẩu cho hàng ngoại",
            "Ngành bắt buộc (thực phẩm, mỹ phẩm) thiếu giấy ATTP/CBMP"
        ],
        prepare: [
            "Chuẩn bị GPKD còn hạn ≥ 6 tháng",
            "Đăng ký nhãn hiệu hoặc có hợp đồng ủy quyền",
            "Lưu trữ hoá đơn/chứng từ nhập khẩu rõ ràng",
            "Xin cấp giấy ATTP/CBMP nếu thuộc ngành yêu cầu"
        ]
    },
    {
        title: "Website thương hiệu (VNNIC)",
        desc: "Tên miền đăng ký qua VNNIC, còn hạn ≥ 1 năm, website hoạt động và chứng minh thương hiệu.",
        failExamples: [
            "Không có website hoặc website không hoạt động",
            "Tên miền không đăng ký VNNIC",
            "Tên miền hết hạn hoặc còn < 1 năm",
            "Website không hiển thị rõ thương hiệu/sản phẩm"
        ],
        prepare: [
            "Đăng ký tên miền qua VNNIC",
            "Gia hạn tên miền ≥ 1 năm",
            "Xây dựng website chuyên nghiệp, rõ ràng",
            "Đảm bảo website hoạt động ổn định"
        ]
    },
    {
        title: "Vi phạm nghiêm trọng",
        desc: "Không có lịch sử hàng giả/nhái mức nặng, vi phạm bản quyền nặng, hoặc sản phẩm bị gỡ do vi phạm nặng.",
        failExamples: [
            "Bị phát hiện bán hàng giả/nhái mức nặng",
            "Vi phạm bản quyền/nội dung nặng (cảnh báo từ Shopee)",
            "Sản phẩm bị gỡ hàng loạt do vi phạm chính sách nghiêm trọng",
            "Lịch sử khiếu nại về chất lượng/giả mạo nhiều"
        ],
        prepare: [
            "Kiểm tra kỹ nguồn gốc sản phẩm trước khi bán",
            "Không bán hàng nhái, hàng không rõ nguồn gốc",
            "Tuân thủ chính sách bản quyền và nội dung",
            "Xử lý khiếu nại khách hàng nhanh chóng, chuyên nghiệp"
        ]
    },
    {
        title: "Sao Quả Tạ",
        desc: "Trong 4 tuần gần nhất, số Sao Quả Tạ phải ≤ 2. Nếu > 2 → KO fail.",
        failExamples: [
            "Nhận > 2 Sao Quả Tạ trong 4 tuần gần nhất",
            "Thường xuyên giao hàng trễ/sai hàng",
            "Nhiều đơn bị huỷ do lỗi shop",
            "Phản hồi chat chậm/không phản hồi"
        ],
        prepare: [
            "Theo dõi và cải thiện LSR, NFR, NRR",
            "Giảm tỷ lệ đơn trễ, đơn huỷ",
            "Phản hồi chat nhanh (<12h)",
            "Đảm bảo hàng đúng mô tả, giao đúng hạn"
        ]
    }
];

// ========== DATA SCORING MODEL ==========
const scoringData = [
    {
        group: "Vận hành",
        weight: 50,
        kpis: [
            { name: "LSR (Late Shipment Rate)", desc: "Tỷ lệ giao hàng trễ ≤ 3%", weightFinal: 10, tooltip: "Đơn giao sau thời gian cam kết / Tổng đơn. Mục tiêu ≤ 3%." },
            { name: "NFR (Non-Fulfillment Rate)", desc: "Tỷ lệ đơn hàng không thành công ≤ 2%", weightFinal: 10, tooltip: "Đơn huỷ do lỗi shop / Tổng đơn. Mục tiêu ≤ 2%." },
            { name: "NRR (Negative Review Rate)", desc: "Tỷ lệ đánh giá 1-2 sao ≤ 5%", weightFinal: 5, tooltip: "Số đánh giá 1-2 sao / Tổng đánh giá. Mục tiêu ≤ 5%." },
            { name: "Tỷ lệ phản hồi chat", desc: "≥ 80% trong 4 tuần", weightFinal: 5, tooltip: "Số tin nhắn phản hồi / Tổng tin nhắn nhận. Mục tiêu ≥ 90%." },
            { name: "Thời gian phản hồi chat", desc: "< 12 giờ (TB)", weightFinal: 5, tooltip: "Thời gian trung bình từ khi nhận tin đến khi phản hồi. Mục tiêu < 12h." },
            { name: "Điểm Sao Quả Tạ", desc: "≤ 2 trong 4 tuần (cũng là KO nếu > 2)", weightFinal: 5, tooltip: "Số Sao Quả Tạ nhận trong 4 tuần. > 2 → KO fail." },
            { name: "Tỷ lệ hàng đặt trước", desc: "< 10%", weightFinal: 5, tooltip: "Đơn pre-order / Tổng đơn. Mục tiêu < 30%." },
            { name: "Vi phạm tiêu chuẩn cộng đồng (mức thường)", desc: "≤ 2 lần trong 4 tuần", weightFinal: 5, tooltip: "Vi phạm nhẹ (không nghiêm trọng). ≤ 2 lần/4 tuần." }
        ]
    },
    {
        group: "Thương hiệu",
        weight: 20,
        kpis: [
            { name: "Website VNNIC", desc: "Có đăng ký, còn hạn ≥ 1 năm, hoạt động (cũng là KO nếu fail)", weightFinal: 8, tooltip: "Xem KO Gate. Đạt = 8 điểm, không đạt = 0 điểm (và KO fail)." },
            { name: "Mạng xã hội", desc: "Facebook/Instagram hoạt động, ≥ 5k followers", weightFinal: 8, tooltip: "Ít nhất 1 kênh có ≥ 5k followers và đăng bài thường xuyên." },
            { name: "Độ phủ offline", desc: "Có cửa hàng/đại lý offline hoặc hợp tác với nhà bán lẻ", weightFinal: 4, tooltip: "Có mặt ở kênh offline (cửa hàng, đại lý, siêu thị...) = cộng điểm." }
        ]
    },
    {
        group: "Danh mục sản phẩm",
        weight: 15,
        kpis: [
            { name: "Listing đạt chuẩn", desc: "≥ 80% sản phẩm có tiêu đề/mô tả đầy đủ, không lỗi chính tả", weightFinal: 6.75, tooltip: "Tiêu đề rõ ràng, mô tả chi tiết, không lỗi. ≥ 80% listing đạt chuẩn." },
            { name: "Hình ảnh đạt chuẩn", desc: "≥ 85% có ảnh chất lượng cao, đúng sản phẩm", weightFinal: 3.75, tooltip: "Ảnh HD, đúng màu sắc, không chứa watermark/logo lạ. ≥ 85% ảnh đạt chuẩn." },
            { name: "Thuộc tính đầy đủ", desc: "≥ 90% sản phẩm điền đủ thuộc tính bắt buộc", weightFinal: 3, tooltip: "Kích thước, màu sắc, chất liệu... điền đầy đủ. ≥ 90% sản phẩm." },
            { name: "Không sản phẩm vi phạm", desc: "0 sản phẩm bị gỡ/cảnh báo trong 4 tuần", weightFinal: 1.5, tooltip: "Không có sản phẩm vi phạm chính sách trong 4 tuần gần nhất." }
        ]
    },
    {
        group: "Quy mô TMĐT",
        weight: 15,
        kpis: [
            { name: "Doanh số 4 tuần", desc: "≥ 50 triệu VNĐ (GMV)", weightFinal: 7.5, tooltip: "Tổng doanh thu (GMV) trong 4 tuần gần nhất ≥ 50 triệu." },
            { name: "Số đơn hàng 4 tuần", desc: "≥ 200 đơn", weightFinal: 4.5, tooltip: "Tổng số đơn hoàn thành trong 4 tuần ≥ 200." },
            { name: "Tăng trưởng kỳ gần nhất", desc: "Doanh số tăng ≥ 10% so với kỳ trước", weightFinal: 3, tooltip: "So sánh 4 tuần hiện tại với 4 tuần trước đó. Tăng ≥ 10%." }
        ]
    }
];
// ========== RENDER KO GATE ==========
function renderKOGate() {
    const grid = document.getElementById('koGrid');
    koData.forEach(ko => {
        const card = document.createElement('div');
        card.className = 'ko-card';
        card.innerHTML = `
      <div class="ko-badge">⚡ KO</div>
      <h3>${ko.title}</h3>
      <p>${ko.desc}</p>
      <h4>Ví dụ FAIL:</h4>
      <ul>${ko.failExamples.map(ex => `<li>${ex}</li>`).join('')}</ul>
      <div class="consequence">Hậu quả: Fail → MRSM_Final = 0 / Not Ready</div>
      <h4>Cần chuẩn bị:</h4>
      <ul>${ko.prepare.map(pr => `<li>${pr}</li>`).join('')}</ul>
    `;
        grid.appendChild(card);
    });
}

// ========== RENDER SCORING MODEL ==========
function renderScoring() {
    const container = document.getElementById('scoringGroups');
    scoringData.forEach(group => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'scoring-group';
        groupDiv.innerHTML = `
      <div class="group-header">
        <h3>${group.group}</h3>
        <span class="weight-badge">${group.weight}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${group.weight}%"></div>
      </div>
      <table class="kpi-table">
        <thead>
          <tr>
            <th style="width:30%">KPI</th>
            <th style="width:45%">Mô tả / Ngưỡng</th>
            <th style="width:25%; text-align:right">Weight Final</th>
          </tr>
        </thead>
        <tbody>
          ${group.kpis.map(kpi => `
            <tr>
              <td><strong>${kpi.name}</strong><span class="tooltip" title="${kpi.tooltip}">i</span></td>
              <td>${kpi.desc}</td>
              <td style="text-align:right; font-weight:700; color:var(--brand)">${kpi.weightFinal}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
        container.appendChild(groupDiv);
    });
}
// ========== SEARCH ==========
function setupSearch() {
    const input = document.getElementById('searchInput');
    const targets = Array.from(document.querySelectorAll('.ko-card, .scoring-group'));

    function applyFilter(raw) {
        const query = (raw || '').trim().toLowerCase();
        if (!query) {
            targets.forEach(el => el.classList.remove('is-hidden'));
            return;
        }
        targets.forEach(el => {
            const hay = (el.textContent || '').toLowerCase();
            el.classList.toggle('is-hidden', !hay.includes(query));
        });
    }

    input.addEventListener('input', (e) => applyFilter(e.target.value));

    // Ctrl/Cmd+K: focus search
    window.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toLowerCase().includes('mac');
        const mod = isMac ? e.metaKey : e.ctrlKey;
        if (mod && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            input.focus();
        }
    });
}
// ========== SCROLL FUNCTIONS ==========
function scrollToSection(id) {
    document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
}
// ========== GO HOME ==========
function goHome() {
    window.location.href = "Homepage.html";
}
// ========== BACK TO TOP ==========
window.addEventListener('scroll', () => {
    const btn = document.getElementById('backToTop');
    if (window.scrollY > 300) {
        btn.classList.add('show');
    } else {
        btn.classList.remove('show');
    }
});
// ========== NAV ACTIVE ==========
function setupNavActive() {
    const navLinks = Array.from(document.querySelectorAll('.nav-list a'));
    const sections = Array.from(document.querySelectorAll('main .section'));

    function setActive(id) {
        navLinks.forEach(a => {
            const href = a.getAttribute('href') || '';
            a.classList.toggle('active', href === `#${id}`);
        });
    }

    // Click: smooth scroll
    navLinks.forEach(a => {
        a.addEventListener('click', (e) => {
            const href = a.getAttribute('href') || '';
            if (!href.startswith || !href.startsWith('#')) return;
            const id = href.slice(1);
            const el = document.getElementById(id);
            if (!el) return;
            e.preventDefault();
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            history.replaceState(null, '', href);
        });
    });

    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            const visible = entries
                .filter(en => en.isIntersecting)
                .sort((a, b) => (b.intersectionRatio - a.intersectionRatio));
            if (visible[0]) setActive(visible[0].target.id);
        }, {
            root: null,
            threshold: [0.15, 0.25, 0.35, 0.5, 0.65],
            rootMargin: '-20% 0px -65% 0px'
        });

        sections.forEach(sec => io.observe(sec));
    } else {
        // Fallback: simple scroll spy
        window.addEventListener('scroll', () => {
            let current = '';
            sections.forEach(sec => {
                const top = sec.offsetTop;
                if (window.scrollY >= top - 120) current = sec.id;
            });
            if (current) setActive(current);
        });
    }
}

// ========== INIT ==========
renderKOGate();
renderScoring();
setupSearch();
setupNavActive();
