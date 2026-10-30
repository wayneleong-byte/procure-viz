(function () {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const STATUS_ORDER = [
    "已提交待回覆",
    "報價進行中",
    "行政部與甲方跟進中",
    "待對方補充資料後交行政",
    "行政部已回覆待同事重交",
  ];

  const STATUS_TAB = {
    "已提交待回覆": "awaiting",
    "報價進行中": "quotation",
    "行政部與甲方跟進中": "admin_client",
    "待對方補充資料後交行政": "awaiting_party",
    "行政部已回覆待同事重交": "pending",
  };

  const ROLE_ZH = { admin: "行政部", edu: "EDU", third: "第三方" };
  /** Oscar：指定用黑色時間比例（數據不足／特殊跟進） */
  const FORCE_BLACK_SHARE = new Set([
    "PA-26-135",
    "PA-26-220",
    "科學館與蔚來簽署第二次補充合作協議",
  ]);
  /** Oscar：已完成但仍顯示行政／EDU／第三方三色（資料完整） */
  const FULL_COLOR_SHARE = new Set([
    "PA-26-120(2)",
    "PA-26-199(2)",
    "PA-26-242",
  ]);

  /** Shared doc-list filters (PA text + submitter). */
  const DOC_FILTER = { pa: "", submitter: "", status: "", sort: "pa" };

  const TYPE_COLORS = [
    "#38bdf8", "#a78bfa", "#f472b6", "#fbbf24", "#34d399",
    "#fb923c", "#60a5fa", "#c084fc", "#4ade80", "#f87171",
  ];

  let DATA = null;
  let charts = {};
  let emailChartsReady = false;

  function applyChartDefaults() {
    if (typeof Chart === "undefined") return;
    Chart.defaults.font.family = '"Noto Sans TC", "PingFang TC", sans-serif';
    Chart.defaults.font.size = 14;
    Chart.defaults.color = "#c5d5de";
  }


  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDays(v) {
    if (v == null || v === "") return "—";
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      delete charts[key];
    }
  }

  function switchTab(tabId) {
    $$(".tab").forEach((b) => {
      const on = b.dataset.tab === tabId;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    $$(".panel").forEach((p) => p.classList.remove("active"));
    const panel = $(`#panel-${tabId}`);
    if (panel) panel.classList.add("active");
    if (tabId === "completed") {
      const st = (DOC_FILTER.status || "").trim();
      if (st && st !== "完成") {
        DOC_FILTER.status = "";
        syncDocFilterInputs();
        renderAllLists();
      }
    }
    if (tabId === "email") {
      requestAnimationFrame(() => renderEmailCharts());
    }
    if (tabId === "home") {
      requestAnimationFrame(() => renderHomeCharts());
    }
  }

  function buildTabs() {
    const nav = $("#main-tabs");
    const sc = (DATA.meta && DATA.meta.status_counts) || {};
    const order = (DATA.meta && DATA.meta.status_order) || STATUS_ORDER;
    const oc =
      (DATA.meta && DATA.meta.overview_count) ??
      ((DATA.documents || []).length + (DATA.completed_documents || []).length);
    let html = `<button type="button" class="tab active" data-tab="home" role="tab" aria-selected="true">首頁</button>`;
    html += `<button type="button" class="tab" data-tab="overview" role="tab" aria-selected="false">總覽<span class="tab-count">${oc}</span></button>`;
    order.forEach((st) => {
      const id = STATUS_TAB[st] || st;
      const n = sc[st] || 0;
      html += `<button type="button" class="tab" data-tab="${esc(id)}" role="tab" aria-selected="false">${esc(st)}<span class="tab-count">${n}</span></button>`;
    });
    const cc = (DATA.meta && DATA.meta.completed_count) ?? ((DATA.completed_documents || []).length);
    html += `<button type="button" class="tab" data-tab="completed" role="tab" aria-selected="false">已完成文件流程時間記錄<span class="tab-count">${cc}</span></button>`;
    html += `<button type="button" class="tab" data-tab="email" role="tab" aria-selected="false">行政部郵件時間段統計</button>`;
    nav.innerHTML = html;
    $$(".tab", nav).forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
  }

  function docFilterToolbar(scope) {
    const showShareLegend = scope !== "overview";
    const statusSelect =
      scope === "overview"
        ? `<select class="doc-filter-status" aria-label="目前狀態">
          <option value="">全部目前狀態</option>
        </select>`
        : "";
    const sortSelect =
      scope === "overview"
        ? `<select class="doc-filter-sort" aria-label="排序">
          <option value="pa"${DOC_FILTER.sort === "pa" ? " selected" : ""}>文件編號</option>
          <option value="first_submit"${DOC_FILTER.sort === "first_submit" ? " selected" : ""}>第一次提交日期（由最舊排起）</option>
        </select>`
        : "";
    const legend = showShareLegend
      ? `<div class="legend share-legend">
        <span><i class="swatch admin"></i>行政部</span>
        <span><i class="swatch edu"></i>EDU</span>
        <span><i class="swatch third"></i>第三方</span>
      </div>`
      : "";
    return `<div class="toolbar doc-filter-bar" data-scope="${esc(scope)}">
      ${legend}
      <div class="filters">
        <input type="search" class="doc-filter-pa" placeholder="搜尋文件編號" aria-label="搜尋文件編號" value="${esc(DOC_FILTER.pa)}">
        <select class="doc-filter-submitter" aria-label="負責同事">
          <option value="">全部負責同事</option>
        </select>
        ${statusSelect}
        ${sortSelect}
      </div>
    </div>
    <div class="email-stats-line doc-filter-count" data-scope="${esc(scope)}"></div>`;
  }

  function buildStatusPanels() {
    const wrap = $("#status-panels");
    const order = (DATA.meta && DATA.meta.status_order) || STATUS_ORDER;
    let html = `<section id="panel-overview" class="panel" role="tabpanel">
      <div class="card" style="margin-bottom:10px">
        <h2 class="card-title">總覽</h2>
        <p class="card-hint">列出全部文件（未完成＋已完成）；可用排序選項（文件編號／第一次提交日期）。欄位：文件編號 · 目前狀態 · 屬性 · 文件名稱 · 負責同事。純列表，唔展開。</p>
        ${docFilterToolbar("overview")}
        <div class="list-head overview-head">
          <span>文件編號</span><span>目前狀態</span><span>屬性</span><span>文件名稱</span><span>負責同事</span>
        </div>
        <div class="doc-list flat" id="list-overview"></div>
      </div>
    </section>`;
    html += order
      .map((st) => {
        const id = STATUS_TAB[st] || st;
        return `<section id="panel-${esc(id)}" class="panel" role="tabpanel">
          <div class="card" style="margin-bottom:10px">
            <h2 class="card-title">${esc(st)}</h2>
            <p class="card-hint">未展開：編號 · 狀態天數 · 首次至今 · 屬性 · 文件名稱 · 行政／EDU／第三方時間比例。點擊列展開時間線（紅＝行政部、綠＝EDU、藍＝第三方）。</p>
            ${docFilterToolbar(id)}
            <div class="list-head status-head">
              <span>文件編號</span><span>狀態天數</span><span>首次至今</span><span>屬性</span><span>文件名稱</span><span>時間比例</span><span></span>
            </div>
            <div class="doc-list" id="list-${esc(id)}"></div>
          </div>
        </section>`;
      })
      .join("");
    html += `<section id="panel-completed" class="panel" role="tabpanel">
      <div class="card" style="margin-bottom:10px">
        <h2 class="card-title">已完成文件流程時間記錄</h2>
        <p class="card-hint">未展開：編號 · 文件總天數（首次／紀錄起點→完成）· 屬性 · 文件名稱 · 時間比例。資料完整者（目前 PA-26-120(2)、PA-26-199(2)、PA-26-242）顯示行政／EDU／第三方三色；其餘已完成因數據不足顯示黑色比例條。點擊列展開流程時間線（已完成唔再延伸至今日）。</p>
        ${docFilterToolbar("completed")}
        <div class="list-head completed-head">
          <span>文件編號</span><span>文件總天數</span><span>屬性</span><span>文件名稱</span><span>時間比例</span><span></span>
        </div>
        <div class="doc-list" id="list-completed"></div>
      </div>
    </section>`;
    wrap.innerHTML = html;
    wireDocFilters();
  }

  function renderMeta() {
    const m = DATA.meta || {};
    $("#stat-total").textContent = m.incomplete_count ?? "—";
    $("#stat-emails").textContent = m.email_count ?? "—";
    $("#stat-off").textContent = m.email_off_hours ?? "—";
    $("#meta-line").textContent =
      `最後更新：${m.generated_at || "—"}（${m.timezone || "Asia/Macau"}）`;
  }

  function renderHome() {
    const sc = (DATA.meta && DATA.meta.status_counts) || {};
    const order = (DATA.meta && DATA.meta.status_order) || STATUS_ORDER;
    const box = $("#status-cards");
    const total = DATA.meta?.incomplete_count ?? 0;
    let html = order
      .map((st) => {
        const id = STATUS_TAB[st] || st;
        const n = sc[st] || 0;
        return `<button type="button" class="status-card" data-goto="${esc(id)}">
          <span class="sc-name">${esc(st)}</span>
          <span class="sc-num">${n}</span>
        </button>`;
      })
      .join("");
    html += `<button type="button" class="status-card total-card" data-goto="home" disabled>
      <span class="sc-name">未完成總數</span>
      <span class="sc-num">${total}</span>
    </button>`;
    box.innerHTML = html;
    $$(".status-card[data-goto]", box).forEach((btn) => {
      if (btn.disabled) return;
      btn.addEventListener("click", () => switchTab(btn.dataset.goto));
    });

    const es = DATA.email_stats || {};
    const prev = $("#email-preview-stats");
    const on = es.on_hours ?? 0;
    const off = es.off_hours ?? 0;
    const t = es.total || on + off || 1;
    prev.innerHTML = `
      <div class="chip"><b>${on}</b><span>辦公時間</span></div>
      <div class="chip"><b>${off}</b><span>非辦公時間</span></div>
      <div class="chip"><b>${t ? Math.round((off / t) * 1000) / 10 : 0}%</b><span>非辦公比例</span></div>`;
    const btn = $("#btn-goto-email");
    if (btn) btn.onclick = () => switchTab("email");
  }

  function renderHomeCharts() {
    if (typeof Chart === "undefined") return;
    const sc = (DATA.meta && DATA.meta.status_counts) || {};
    const order = (DATA.meta && DATA.meta.status_order) || STATUS_ORDER;
    const labels = order.slice();
    const values = order.map((s) => sc[s] || 0);

    destroyChart("status");
    const ctx = $("#chart-status");
    if (ctx) {
      charts.status = new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "文件數",
              data: values,
              backgroundColor: [
                "#38bdf8",
                "#a78bfa",
                "#60a5fa",
                "#818cf8",
                "#34d399",
              ],
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => items[0]?.label || "",
              },
            },
          },
          scales: {
            x: {
              ticks: {
                color: "#8aa0ab",
                maxRotation: 45,
                minRotation: 20,
                font: { size: 10 },
              },
              grid: { display: false },
            },
            y: {
              beginAtZero: true,
              ticks: { color: "#8aa0ab", precision: 0 },
              grid: { color: "rgba(255,255,255,.06)" },
            },
          },
        },
      });
    }

    const es = DATA.email_stats || {};
    destroyChart("emailPreview");
    const ctx2 = $("#chart-email-preview");
    if (ctx2) {
      charts.emailPreview = new Chart(ctx2, {
        type: "doughnut",
        data: {
          labels: ["辦公時間", "非辦公時間"],
          datasets: [
            {
              data: [es.on_hours || 0, es.off_hours || 0],
              backgroundColor: ["#38bdf8", "#fb923c"],
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom", labels: { color: "#c8d6dc", boxWidth: 12 } },
          },
        },
      });
    }
  }

  function allDocs() {
    return (DATA.documents || []).concat(DATA.completed_documents || []);
  }

  function submitterOptionsHtml() {
    const fromMeta = (DATA.meta && DATA.meta.submitters) || [];
    const set = new Set(fromMeta);
    allDocs().forEach((d) => {
      const s = (d.submitter || "").trim();
      if (s) set.add(s);
    });
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "zh-Hant"))
      .map(
        (s) =>
          `<option value="${esc(s)}"${DOC_FILTER.submitter === s ? " selected" : ""}>${esc(s)}</option>`
      )
      .join("");
  }

  function statusOptionsHtml() {
    const order = (DATA.meta && DATA.meta.status_order) || STATUS_ORDER;
    const set = new Set();
    allDocs().forEach((d) => {
      const s = (d.status || "").trim();
      if (s) set.add(s);
    });
    const ordered = [];
    order.forEach((s) => {
      if (set.has(s)) {
        ordered.push(s);
        set.delete(s);
      }
    });
    if (set.has("完成")) {
      ordered.push("完成");
      set.delete("完成");
    }
    Array.from(set)
      .sort((a, b) => a.localeCompare(b, "zh-Hant"))
      .forEach((s) => ordered.push(s));
    return ordered
      .map(
        (s) =>
          `<option value="${esc(s)}"${DOC_FILTER.status === s ? " selected" : ""}>${esc(s)}</option>`
      )
      .join("");
  }

  function wireDocFilters() {
    $$(".doc-filter-bar").forEach((bar) => {
      const pa = $(".doc-filter-pa", bar);
      const sel = $(".doc-filter-submitter", bar);
      const st = $(".doc-filter-status", bar);
      const sort = $(".doc-filter-sort", bar);
      if (sel) {
        const keep = DOC_FILTER.submitter;
        sel.innerHTML = `<option value="">全部負責同事</option>` + submitterOptionsHtml();
        sel.value = keep || "";
      }
      if (st) {
        const keep = DOC_FILTER.status;
        st.innerHTML = `<option value="">全部目前狀態</option>` + statusOptionsHtml();
        st.value = keep || "";
      }
      if (sort) {
        sort.value = DOC_FILTER.sort === "first_submit" ? "first_submit" : "pa";
      }
      if (pa) {
        pa.value = DOC_FILTER.pa || "";
        pa.oninput = () => {
          DOC_FILTER.pa = pa.value || "";
          syncDocFilterInputs();
          renderAllLists();
        };
      }
      if (sel) {
        sel.onchange = () => {
          DOC_FILTER.submitter = sel.value || "";
          syncDocFilterInputs();
          renderAllLists();
        };
      }
      if (st) {
        st.onchange = () => {
          DOC_FILTER.status = st.value || "";
          syncDocFilterInputs();
          renderAllLists();
        };
      }
      if (sort) {
        sort.onchange = () => {
          DOC_FILTER.sort = sort.value === "first_submit" ? "first_submit" : "pa";
          syncDocFilterInputs();
          renderAllLists();
        };
      }
    });
  }

  function syncDocFilterInputs() {
    $$(".doc-filter-pa").forEach((el) => {
      if (el.value !== DOC_FILTER.pa) el.value = DOC_FILTER.pa || "";
    });
    $$(".doc-filter-submitter").forEach((el) => {
      if (el.value !== DOC_FILTER.submitter) el.value = DOC_FILTER.submitter || "";
    });
    $$(".doc-filter-status").forEach((el) => {
      if (el.value !== DOC_FILTER.status) el.value = DOC_FILTER.status || "";
    });
    $$(".doc-filter-sort").forEach((el) => {
      const v = DOC_FILTER.sort === "first_submit" ? "first_submit" : "pa";
      if (el.value !== v) el.value = v;
    });
  }

  function matchDocFilter(d) {
    const paQ = (DOC_FILTER.pa || "").trim().toLowerCase();
    const subQ = (DOC_FILTER.submitter || "").trim();
    const stQ = (DOC_FILTER.status || "").trim();
    if (paQ) {
      const id = String(d.id || "").toLowerCase();
      if (!id.includes(paQ)) return false;
    }
    if (subQ) {
      if ((d.submitter || "").trim() !== subQ) return false;
    }
    if (stQ) {
      if ((d.status || "").trim() !== stQ) return false;
    }
    return true;
  }

  function setFilterCount(scope, shown, total) {
    const el = $(`.doc-filter-count[data-scope="${scope}"]`);
    if (!el) return;
    const filtered = !!(DOC_FILTER.pa || DOC_FILTER.submitter || DOC_FILTER.status);
    el.textContent = filtered
      ? `顯示 ${shown}／${total}`
      : `共 ${total} 份`;
  }

  function paSortKey(id) {
    const s = String(id || "").trim();
    if (!s) return [2, 0, 0, 0, ""];
    const m = s.match(/^PA-(\d+)-(\d+)(?:\((\d+)\))?/i);
    if (m) return [0, +m[1], +m[2], +(m[3] || 0), s.toUpperCase()];
    return [1, 0, 0, 0, s.toUpperCase()];
  }

  function cmpPa(a, b) {
    const ka = paSortKey(a);
    const kb = paSortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  }

  function timeShareHtml(ts, { compact = false } = {}) {
    const t = ts || {};
    const total = Number(t.total_days) || 0;
    const ap = Number(t.admin_pct) || 0;
    const ep = Number(t.edu_pct) || 0;
    const tp = Number(t.third_pct) || 0;
    if (total <= 0 && ap + ep + tp <= 0) {
      return `<div class="share-bar empty" title="暫無時間比例"><span class="share-empty">—</span></div>`;
    }
    const title = `行政部 ${ap}%（${fmtDays(t.admin_days)}天）· EDU ${ep}%（${fmtDays(t.edu_days)}天）· 第三方 ${tp}%（${fmtDays(t.third_days)}天）`;
    const labels = compact
      ? `<div class="share-labels compact"><span class="admin">${ap}%</span><span class="edu">${ep}%</span><span class="third">${tp}%</span></div>`
      : `<div class="share-labels"><span class="admin">${ap}%</span><span class="edu">${ep}%</span><span class="third">${tp}%</span></div>`;
    return `<div class="share-wrap" title="${esc(title)}">
      <div class="share-bar" role="img" aria-label="${esc(title)}">
        <i class="seg admin" style="flex:0 0 ${ap}%;width:${ap}%"></i>
        <i class="seg edu" style="flex:0 0 ${ep}%;width:${ep}%"></i>
        <i class="seg third" style="flex:0 0 ${tp}%;width:${tp}%"></i>
      </div>
      ${labels}
    </div>`;
  }

  function timeShareHtmlBlack(ts, { compact = false } = {}) {
    const t = ts || {};
    const total = Number(t.total_days) || Number(t.admin_days) + Number(t.edu_days) + Number(t.third_days) || 0;
    const title = total > 0
      ? `數據不足，暫以黑色顯示合計 ${fmtDays(total)} 天（唔分行政／EDU／第三方）`
      : "數據不足，暫無可靠時間比例";
    if (total <= 0) {
      return `<div class="share-bar empty" title="${esc(title)}"><span class="share-empty">數據不足</span></div>`;
    }
    const labels = compact
      ? `<div class="share-labels mono compact"><span class="muted-share">數據不足 · ${esc(fmtDays(total))}天</span></div>`
      : `<div class="share-labels mono"><span class="muted-share">合計 ${esc(fmtDays(total))} 天（數據不足，黑色＝唔分角色）</span></div>`;
    return `<div class="share-wrap share-wrap-black" title="${esc(title)}">
      <div class="share-bar share-bar-black" role="img" aria-label="${esc(title)}">
        <i class="seg black" style="flex:0 0 100%;width:100%"></i>
      </div>
      ${labels}
    </div>`;
  }

  function forceBlackShare(d) {
    const id = String(d.id || "");
    if (FORCE_BLACK_SHARE.has(id)) return true;
    // completed: whitelist keeps RGB; all other completed → black
    if (d.status_group === "completed" || d.status === "完成") {
      return !FULL_COLOR_SHARE.has(id);
    }
    return false;
  }

  function docShareHtml(d, { compact = false } = {}) {
    const ts = d.time_share || {};
    if (forceBlackShare(d)) return timeShareHtmlBlack(ts, { compact });
    return timeShareHtml(ts, { compact });
  }

  function completedShareHtml(d, { compact = false } = {}) {
    return docShareHtml(d, { compact });
  }

  function ownerLabel(d) {
    return (d.submitter || "").trim() || "—";
  }

  function renderTimeline(doc) {
    const tl = doc.timeline || {};
    const nodes = tl.nodes || [];
    const gaps = tl.gaps || [];
    if (!nodes.length) {
      return `<div class="empty">無時間線節點</div>`;
    }
    const primary = nodes.filter((n) => !n.secondary);
    const secondary = nodes.filter((n) => n.secondary);
    return buildTimelineHtml(primary, secondary, gaps);
  }

  function nodeHtml(n) {
    const role = n.role || "edu";
    return `<div class="vt-item">
      <div class="vt-time">${esc(n.t || "")}</div>
      <div class="vt-body">
        <div class="vt-node role-${esc(role)}${n.secondary ? " secondary" : ""}">
          <div class="vt-label">
            <span class="role-pill ${esc(role)}">${esc(ROLE_ZH[role] || role)}</span>
            ${esc(n.label || n.kind || "")}${n.secondary ? " · 次要" : ""}
          </div>
          ${n.who ? `<div class="vt-who">${esc(n.who)}</div>` : ""}
          ${n.detail ? `<div class="vt-detail">${esc(n.detail)}</div>` : ""}
        </div>
      </div>
    </div>`;
  }

  function gapHtml(g) {
    if (!g) return "";
    const role = g.role || "third";
    const days = fmtDays(g.days);
    return `<div class="vt-item">
      <div class="vt-time"></div>
      <div class="vt-body">
        <div class="vt-gap ${esc(role)}${g.open ? " open" : ""}">
          <span class="gap-role">${esc(ROLE_ZH[role] || role)}</span>
          <span>${days} 天${g.open ? "（至今）" : ""}</span>
        </div>
      </div>
    </div>`;
  }

  function buildTimelineHtml(primary, secondary, gaps) {
    // Pair gaps to primary by sequential from_ts matching
    const gapPool = gaps.slice();
    let html = `<div class="v-timeline">`;
    for (let i = 0; i < primary.length; i++) {
      const n = primary[i];
      const prevTs = i === 0 ? Number.NEGATIVE_INFINITY : primary[i - 1].ts ?? Number.NEGATIVE_INFINITY;
      const curTs = n.ts != null ? n.ts : Number.POSITIVE_INFINITY;
      secondary
        .filter((s) => {
          const ts = s.ts != null ? s.ts : 0;
          return ts > prevTs && ts <= curTs + 0.001;
        })
        .forEach((s) => {
          html += nodeHtml(s);
        });
      html += nodeHtml(n);

      // Find best matching unused gap starting at this node
      let gIdx = gapPool.findIndex((g) => {
        if (g.from_ts != null && n.ts != null) return Math.abs(g.from_ts - n.ts) < 2;
        return g.from_t === n.t;
      });
      if (gIdx < 0 && i < gapPool.length) {
        // if open last gap etc., take next remaining if last primary
        if (i === primary.length - 1 && gapPool.length) gIdx = gapPool.length - 1;
      }
      if (gIdx >= 0) {
        const g = gapPool.splice(gIdx, 1)[0];
        html += gapHtml(g);
      }
    }
    // trailing secondaries after last primary
    if (primary.length) {
      const lastTs = primary[primary.length - 1].ts ?? 0;
      secondary
        .filter((s) => (s.ts ?? 0) > lastTs)
        .forEach((s) => {
          html += nodeHtml(s);
        });
    }
    // leftover gaps
    gapPool.forEach((g) => {
      html += gapHtml(g);
    });
    html += `</div>`;
    return html;
  }

  function renderDocList(status) {
    const id = STATUS_TAB[status] || status;
    const list = $(`#list-${id}`);
    if (!list) return;
    const all = (DATA.documents || []).filter((d) => d.status === status);
    const docs = all.filter(matchDocFilter);
    setFilterCount(id, docs.length, all.length);
    if (!all.length) {
      list.innerHTML = `<div class="empty">此狀態目前沒有文件</div>`;
      return;
    }
    if (!docs.length) {
      list.innerHTML = `<div class="empty">沒有符合篩選的文件</div>`;
      return;
    }
    list.innerHTML = docs
      .map((d) => {
        const fu = (d.follow_up || []).filter(Boolean).join("、") || "—";
        const ts = d.time_share || {};
        const black = forceBlackShare(d);
        const shareDetail = black
          ? `<div class="doc-meta-line share-detail">
              時間比例：按指定以黑色條顯示合計 ${esc(fmtDays(ts.total_days))} 天（唔分行政／EDU／第三方）
            </div>
            ${timeShareHtmlBlack(ts)}`
          : `<div class="doc-meta-line share-detail">
              時間比例：行政部 ${esc(fmtDays(ts.admin_pct))}%（${esc(fmtDays(ts.admin_days))} 天）
              · EDU ${esc(fmtDays(ts.edu_pct))}%（${esc(fmtDays(ts.edu_days))} 天）
              · 第三方 ${esc(fmtDays(ts.third_pct))}%（${esc(fmtDays(ts.third_days))} 天）
              · 合計 ${esc(fmtDays(ts.total_days))} 天
            </div>
            ${timeShareHtml(ts)}`;
        return `<article class="doc-row" data-id="${esc(d.id)}">
          <button type="button" class="doc-summary has-share" aria-expanded="false">
            <span class="c-id">${esc(d.id)}</span>
            <span class="c-din">${esc(fmtDays(d.days_in_status))}<small>狀態天數</small></span>
            <span class="c-dfs">${esc(fmtDays(d.days_since_first_submit))}<small>首次至今</small></span>
            <span class="c-attr">${esc(d.attr_label || "")}</span>
            <span class="c-title" title="${esc(d.title)}">${esc(d.title)}</span>
            <span class="c-share">${docShareHtml(d, { compact: true })}</span>
            <span class="c-chev" aria-hidden="true">›</span>
          </button>
          <div class="doc-detail">
            <div class="doc-meta-line">
              跟進：<strong style="color:#fff">${esc(fu)}</strong>
              · 負責同事：${esc(ownerLabel(d))}
              · 首次／起點：${esc(d.first_submit || "—")}
              · 狀態起點：${esc(d.status_since || "—")}
              · 最近行政回覆：${esc(d.last_reply || "—")}
            </div>
            ${shareDetail}
            ${
              d.last_reply_summary
                ? `<div class="doc-meta-line">最近回覆摘要：${esc(d.last_reply_summary)}</div>`
                : ""
            }
            <div class="legend" style="margin:12px 0 10px">
              <span><i class="swatch admin"></i>行政部間隔</span>
              <span><i class="swatch edu"></i>EDU 間隔</span>
              <span><i class="swatch third"></i>第三方間隔</span>
            </div>
            ${renderTimeline(d)}
          </div>
        </article>`;
      })
      .join("");

    $$(".doc-row", list).forEach((row) => {
      const btn = $(".doc-summary", row);
      btn.addEventListener("click", () => {
        const open = row.classList.toggle("open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });
  }

  function matchCompletedDocFilter(d) {
    const paQ = (DOC_FILTER.pa || "").trim().toLowerCase();
    const subQ = (DOC_FILTER.submitter || "").trim();
    const stQ = (DOC_FILTER.status || "").trim();
    if (paQ) {
      const id = String(d.id || "").toLowerCase();
      if (!id.includes(paQ)) return false;
    }
    if (subQ) {
      if ((d.submitter || "").trim() !== subQ) return false;
    }
    // Completed tab: ignore non-「完成」status filters (they would hide every row)
    if (stQ && stQ !== "完成") return true;
    if (stQ === "完成" && (d.status || "").trim() !== stQ) return false;
    return true;
  }

  function renderCompletedList() {
    const list = $("#list-completed");
    if (!list) return;
    const sorter =
      DOC_FILTER.sort === "first_submit"
        ? (a, b) => cmpFirstSubmit(a, b)
        : (a, b) => cmpPa(a.id, b.id);
    const all = (DATA.completed_documents || []).slice().sort(sorter);
    const docs = all.filter(matchCompletedDocFilter);
    const stQ = (DOC_FILTER.status || "").trim();
    const statusActive = stQ === "完成";
    const filtered = !!(DOC_FILTER.pa || DOC_FILTER.submitter || statusActive);
    const countEl = $(`.doc-filter-count[data-scope="completed"]`);
    if (countEl) {
      countEl.textContent = filtered
        ? `顯示 ${docs.length}／${all.length}`
        : `共 ${all.length} 份`;
    }
    if (!all.length) {
      list.innerHTML = `<div class="empty">目前沒有已完成文件記錄</div>`;
      return;
    }
    if (!docs.length) {
      list.innerHTML = `<div class="empty">沒有符合篩選的文件</div>`;
      return;
    }
    list.innerHTML = docs
      .map((d) => {
        const fu = (d.follow_up || []).filter(Boolean).join("、") || "—";
        const ts = d.time_share || {};
        const totalDays =
          d.process_days != null && d.process_days !== ""
            ? d.process_days
            : ts.total_days;
        const fullColor = FULL_COLOR_SHARE.has(String(d.id || ""));
        const shareDetail = fullColor
          ? `<div class="doc-meta-line share-detail">
              時間比例：行政部 ${esc(fmtDays(ts.admin_pct))}%（${esc(fmtDays(ts.admin_days))} 天）
              · EDU ${esc(fmtDays(ts.edu_pct))}%（${esc(fmtDays(ts.edu_days))} 天）
              · 第三方 ${esc(fmtDays(ts.third_pct))}%（${esc(fmtDays(ts.third_days))} 天）
              · 合計 ${esc(fmtDays(ts.total_days))} 天
            </div>
            ${timeShareHtml(ts)}`
          : `<div class="doc-meta-line share-detail">
              時間比例：數據不足，以黑色條表示合計 ${esc(fmtDays(ts.total_days != null ? ts.total_days : totalDays))} 天（唔分行政／EDU／第三方）
            </div>
            ${timeShareHtmlBlack(ts)}`;
        return `<article class="doc-row" data-id="${esc(d.id)}">
          <button type="button" class="doc-summary completed-summary has-share" aria-expanded="false">
            <span class="c-id">${esc(d.id)}</span>
            <span class="c-din">${esc(fmtDays(totalDays))}<small>文件總天數</small></span>
            <span class="c-attr">${esc(d.attr_label || "")}</span>
            <span class="c-title" title="${esc(d.title)}">${esc(d.title)}</span>
            <span class="c-share">${completedShareHtml(d, { compact: true })}</span>
            <span class="c-chev" aria-hidden="true">›</span>
          </button>
          <div class="doc-detail">
            <div class="doc-meta-line">
              跟進：<strong style="color:#fff">${esc(fu)}</strong>
              · 負責同事：${esc(ownerLabel(d))}
              · 首次／起點：${esc(d.first_submit || "—")}
              · 完成時間：${esc(d.completed_at || d.last_reply || "—")}
              · 文件總天數：${esc(fmtDays(totalDays))}
            </div>
            ${shareDetail}
            ${
              d.last_reply_summary
                ? `<div class="doc-meta-line">最近回覆摘要：${esc(d.last_reply_summary)}</div>`
                : ""
            }
            ${
              /採購失敗|未能[^。；\n]{0,20}判給/.test(String(d.last_reply_summary || ""))
                ? `<div class="doc-meta-line" style="color:#fbbf24;font-weight:600">⚠ 採購失敗／未能判給（已完成分類；須另開新文件）</div>`
                : ""
            }
            <div class="legend" style="margin:12px 0 10px">
              <span><i class="swatch admin"></i>行政部間隔</span>
              <span><i class="swatch edu"></i>EDU 間隔</span>
              <span><i class="swatch third"></i>第三方間隔</span>
              ${fullColor ? "" : `<span><i class="swatch black"></i>比例（數據不足）</span>`}
            </div>
            ${renderTimeline(d)}
          </div>
        </article>`;
      })
      .join("");

    $$(".doc-row", list).forEach((row) => {
      const btn = $(".doc-summary", row);
      btn.addEventListener("click", () => {
        const open = row.classList.toggle("open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });
  }

  function cmpFirstSubmit(a, b) {
    const fa = String(a.first_submit || "").trim();
    const fb = String(b.first_submit || "").trim();
    if (!fa && !fb) return cmpPa(a.id, b.id);
    if (!fa) return 1;
    if (!fb) return -1;
    if (fa < fb) return -1;
    if (fa > fb) return 1;
    return cmpPa(a.id, b.id);
  }

  function renderOverviewList() {
    const list = $("#list-overview");
    if (!list) return;
    const sorter =
      DOC_FILTER.sort === "first_submit"
        ? (a, b) => cmpFirstSubmit(a, b)
        : (a, b) => cmpPa(a.id, b.id);
    const all = allDocs().slice().sort(sorter);
    const docs = all.filter(matchDocFilter);
    setFilterCount("overview", docs.length, all.length);
    if (!all.length) {
      list.innerHTML = `<div class="empty">目前沒有文件</div>`;
      return;
    }
    if (!docs.length) {
      list.innerHTML = `<div class="empty">沒有符合篩選的文件</div>`;
      return;
    }
    list.innerHTML = docs
      .map((d) => {
        const st = d.status || "—";
        const done = d.status_group === "completed" || st === "完成";
        return `<div class="overview-row${done ? " is-done" : ""}" data-id="${esc(d.id)}">
          <span class="c-id">${esc(d.id || "—")}</span>
          <span class="c-status">${esc(st)}</span>
          <span class="c-attr">${esc(d.attr_label || "—")}</span>
          <span class="c-title" title="${esc(d.title)}">${esc(d.title || "—")}</span>
          <span class="c-owner">${esc(ownerLabel(d))}</span>
        </div>`;
      })
      .join("");
  }

  function renderAllLists() {
    const order = (DATA.meta && DATA.meta.status_order) || STATUS_ORDER;
    renderOverviewList();
    order.forEach(renderDocList);
    renderCompletedList();
  }

  /** Half-hour index: 0=00:00 … 18=09:00 … 37=18:30 … 47=23:30 */
  const WORK_START_I = 18; // 09:00
  const WORK_END_I = 37;   // 18:30 inclusive

  function isWorkBucket(i) {
    return i >= WORK_START_I && i <= WORK_END_I;
  }

  /** Chart.js plugin: paint office / off-hours vertical bands + axis labels */
  const officeHoursBandsPlugin = {
    id: "officeHoursBands",
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.x) return;
      const x = scales.x;
      const n = (chart.data.labels || []).length;
      if (!n) return;
      const y0 = chartArea.top;
      const y1 = chartArea.bottom;
      const h = y1 - y0;

      // Off-hours (left of work): 0 .. WORK_START_I-1
      // Work: WORK_START_I .. WORK_END_I
      // Off-hours (right): WORK_END_I+1 .. n-1
      const bands = [
        { from: 0, to: WORK_START_I - 1, fill: "rgba(71, 85, 105, 0.38)", label: "非辦公時間" },
        { from: WORK_START_I, to: WORK_END_I, fill: "rgba(52, 211, 153, 0.16)", label: "辦公時間" },
        { from: WORK_END_I + 1, to: n - 1, fill: "rgba(71, 85, 105, 0.38)", label: "非辦公時間" },
      ];

      ctx.save();
      for (const b of bands) {
        if (b.to < b.from || b.from >= n) continue;
        const x0 = x.getPixelForValue(b.from) - (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2;
        const x1 = x.getPixelForValue(b.to) + (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2;
        const left = Math.max(chartArea.left, Math.min(x0, x1));
        const right = Math.min(chartArea.right, Math.max(x0, x1));
        if (right <= left) continue;
        ctx.fillStyle = b.fill;
        ctx.fillRect(left, y0, right - left, h);
      }

      // Vertical dividers at work boundaries
      ctx.strokeStyle = "rgba(52, 211, 153, 0.55)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      for (const edge of [WORK_START_I, WORK_END_I + 1]) {
        if (edge < 0 || edge >= n) continue;
        const px = x.getPixelForValue(edge) - (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2;
        if (px < chartArea.left || px > chartArea.right) continue;
        ctx.beginPath();
        ctx.moveTo(px, y0);
        ctx.lineTo(px, y1);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Band labels near top
      ctx.font = "650 12px Noto Sans TC, sans-serif";
      ctx.textBaseline = "top";
      for (const b of bands) {
        if (b.to < b.from || b.from >= n) continue;
        const mid = (b.from + b.to) / 2;
        const px = x.getPixelForValue(mid);
        if (px < chartArea.left + 8 || px > chartArea.right - 8) continue;
        ctx.fillStyle = b.label === "辦公時間" ? "rgba(167, 243, 208, 0.95)" : "rgba(203, 213, 225, 0.85)";
        ctx.textAlign = "center";
        ctx.fillText(b.label, px, y0 + 4);
      }
      ctx.restore();
    },
  };

  function renderEmailCharts() {
    if (typeof Chart === "undefined") return;
    applyChartDefaults();
    const es = DATA.email_stats || {};

    destroyChart("emailTotal");
    const ctx1 = $("#chart-email-total");
    if (ctx1) {
      charts.emailTotal = new Chart(ctx1, {
        type: "doughnut",
        data: {
          labels: ["辦公時間", "非辦公時間"],
          datasets: [
            {
              data: [es.on_hours || 0, es.off_hours || 0],
              backgroundColor: ["#38bdf8", "#fb923c"],
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom", labels: { color: "#c8d6dc" } },
            title: {
              display: true,
              text: `共 ${es.total || 0} 封`,
              color: "#e8f2f6",
              font: { size: 13 },
            },
          },
        },
      });
    }

    // Grouped bar: per stage on vs off (admin)
    destroyChart("emailStage");
    const ctx2 = $("#chart-email-stage");
    const byStage = es.by_stage || {};
    const stageLabels = Object.keys(byStage);
    if (ctx2) {
      charts.emailStage = new Chart(ctx2, {
        type: "bar",
        data: {
          labels: stageLabels.length ? stageLabels : ["（無）"],
          datasets: [
            {
              label: "辦公時間",
              data: stageLabels.map((k) => byStage[k].on),
              backgroundColor: "#38bdf8",
              borderRadius: 4,
            },
            {
              label: "非辦公時間",
              data: stageLabels.map((k) => byStage[k].off),
              backgroundColor: "#fb923c",
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom", labels: { color: "#c8d6dc", boxWidth: 12 } },
          },
          scales: {
            x: { ticks: { color: "#8aa0ab" }, grid: { display: false } },
            y: {
              beginAtZero: true,
              stacked: false,
              ticks: { color: "#8aa0ab", precision: 0 },
              grid: { color: "rgba(255,255,255,.06)" },
            },
          },
        },
      });
    }

    // 24h half-hour stacked — with office / off-hours band backgrounds
    destroyChart("emailHourly");
    const ctx3 = $("#chart-email-hourly");
    const buckets = es.half_hour || [];
    const typeKeys = es.type_keys || [];
    if (ctx3) {
      const labels = buckets.map((b) => b.label);
      const datasets = typeKeys.map((typ, i) => ({
        label: typ,
        data: buckets.map((b) => (b.by_type && b.by_type[typ]) || 0),
        backgroundColor: TYPE_COLORS[i % TYPE_COLORS.length],
        stack: "s",
        borderWidth: 0,
      }));
      charts.emailHourly = new Chart(ctx3, {
        type: "bar",
        data: { labels, datasets },
        plugins: [officeHoursBandsPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: { color: "#c8d6dc", boxWidth: 10, font: { size: 10 } },
            },
            tooltip: {
              mode: "index",
              intersect: false,
              callbacks: {
                afterTitle(items) {
                  const i = items[0]?.dataIndex;
                  if (i == null) return "";
                  return isWorkBucket(i) ? "（辦公時間）" : "（非辦公時間）";
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: {
                maxRotation: 90,
                autoSkip: true,
                maxTicksLimit: 24,
                font: { size: 9 },
                color(ctx) {
                  const i = ctx.index;
                  return isWorkBucket(i) ? "#6ee7b7" : "#94a3b8";
                },
              },
              grid: { display: false },
            },
            y: {
              stacked: true,
              beginAtZero: true,
              ticks: { color: "#8aa0ab", precision: 0 },
              grid: { color: "rgba(255,255,255,.06)" },
            },
          },
        },
      });
    }
    emailChartsReady = true;
  }

  function fillEmailFilters() {
    const paSel = $("#filter-pa");
    const pas = Array.from(
      new Set((DATA.emails || []).map((e) => e.pa).filter(Boolean))
    ).sort();
    paSel.innerHTML =
      `<option value="">全部文件</option>` +
      pas.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  }

  function emailTimeLabel(e) {
    if (e && e.t) return e.t;
    if (e && e.iso) {
      try {
        const d = new Date(e.iso);
        if (!Number.isNaN(d.getTime())) {
          const p = (n) => String(n).padStart(2, "0");
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        }
      } catch (_) {}
    }
    return "—";
  }

  function renderEmails() {
    const pa = $("#filter-pa") ? $("#filter-pa").value : "";
    const onlyOff = $("#filter-off") ? $("#filter-off").checked : false;
    const q = ($("#filter-q") && $("#filter-q").value || "").trim().toLowerCase();
    // 只顯示行政部（資料層已過濾；此處再保險）
    let rows = (DATA.emails || []).filter((e) => e.role === "admin" || !e.role);
    if (pa) rows = rows.filter((e) => e.pa === pa);
    if (onlyOff) rows = rows.filter((e) => e.off_hours === true);
    if (q) {
      rows = rows.filter(
        (e) =>
          (e.subject || "").toLowerCase().includes(q) ||
          (e.from || "").toLowerCase().includes(q) ||
          (e.pa || "").toLowerCase().includes(q)
      );
    }
    const total = (DATA.emails || []).length;
    if ($("#email-count-view")) {
      $("#email-count-view").textContent = `顯示 ${rows.length}／${total}`;
    }
    const box = $("#email-list");
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = `<div class="empty">沒有符合篩選的電郵</div>`;
      return;
    }
    const MAX = 400;
    const slice = rows.slice(0, MAX);
    box.innerHTML =
      slice
        .map((e) => {
          const off = e.off_hours === true;
          return `<div class="email-row${off ? " off-hours" : ""}">
            <div>
              <div class="time">${esc(emailTimeLabel(e))}</div>
              ${off ? `<span class="badge off">非辦公時間</span>` : `<span class="badge on">辦公時間</span>`}
            </div>
            <div><span class="role-pill admin">行政</span></div>
            <div class="pa">${esc(e.pa || "—")}</div>
            <div>
              <div class="subj">${esc(e.subject || "(無標題)")}</div>
              <div class="from">${esc(e.from || "")} · ${esc(e.kind_label || e.kind || "")} · ${esc(e.stage || "")}</div>
            </div>
          </div>`;
        })
        .join("") +
      (rows.length > MAX
        ? `<div class="empty">已截斷顯示前 ${MAX} 筆（請用篩選收窄）</div>`
        : "");
  }

  function renderEmailAnalysis() {
    const es = DATA.email_stats || {};
    $("#email-analysis").textContent = es.analysis || "（暫無分析）";
  }

  function waitForChart(cb, tries = 40) {
    if (typeof Chart !== "undefined") {
      cb();
      return;
    }
    if (tries <= 0) {
      console.warn("Chart.js 未能載入");
      return;
    }
    setTimeout(() => waitForChart(cb, tries - 1), 50);
  }

  async function boot() {
    const res = await fetch("./data/viz.json");
    if (!res.ok) throw new Error("無法載入 data/viz.json");
    DATA = await res.json();
    renderMeta();
    buildTabs();
    buildStatusPanels();
    renderHome();
    renderAllLists();
    renderEmailAnalysis();
    fillEmailFilters();
    renderEmails();
    $("#filter-pa").addEventListener("change", renderEmails);
    $("#filter-off").addEventListener("change", renderEmails);
    $("#filter-q").addEventListener("input", renderEmails);
    waitForChart(() => {
      applyChartDefaults();
      renderHomeCharts();
    });
  }

  boot().catch((err) => {
    const el = $("#status-cards") || $("#panel-home");
    if (el) {
      el.innerHTML = `<div class="empty">載入失敗：${esc(err.message)}</div>`;
    }
    console.error(err);
  });
})();
