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
    let html = `<button type="button" class="tab active" data-tab="home" role="tab" aria-selected="true">首頁</button>`;
    order.forEach((st) => {
      const id = STATUS_TAB[st] || st;
      const n = sc[st] || 0;
      html += `<button type="button" class="tab" data-tab="${esc(id)}" role="tab" aria-selected="false">${esc(st)}<span class="tab-count">${n}</span></button>`;
    });
    html += `<button type="button" class="tab" data-tab="email" role="tab" aria-selected="false">行政部郵件時間段統計</button>`;
    nav.innerHTML = html;
    $$(".tab", nav).forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
  }

  function buildStatusPanels() {
    const wrap = $("#status-panels");
    const order = (DATA.meta && DATA.meta.status_order) || STATUS_ORDER;
    wrap.innerHTML = order
      .map((st) => {
        const id = STATUS_TAB[st] || st;
        return `<section id="panel-${esc(id)}" class="panel" role="tabpanel">
          <div class="card" style="margin-bottom:10px">
            <h2 class="card-title">${esc(st)}</h2>
            <p class="card-hint">未展開：編號 · 目前狀態累積天數 · 由首次提交至今 · 文件屬性 · 文件名稱。點擊列展開時間線（紅＝行政部、綠＝EDU、藍＝第三方間隔天數）。</p>
            <div class="list-head">
              <span>文件編號</span><span>狀態天數</span><span>首次至今</span><span>屬性</span><span>文件名稱</span><span></span>
            </div>
            <div class="doc-list" id="list-${esc(id)}"></div>
          </div>
        </section>`;
      })
      .join("");
  }

  function renderMeta() {
    const m = DATA.meta || {};
    $("#stat-total").textContent = m.incomplete_count ?? "—";
    $("#stat-emails").textContent = m.email_count ?? "—";
    $("#stat-off").textContent = m.email_off_hours ?? "—";
    $("#meta-line").textContent =
      `最後更新：${m.generated_at || "—"}（${m.timezone || "Asia/Macau"}）`;
    $("#source-line").textContent =
      m.subtitle ||
      `資料來源 generated_at：${m.source_generated_at || "—"} · 唯讀 dataset.json`;
    const foot = $("#site-footer");
    if (foot) {
      foot.innerHTML = `教育部工作文件進程（不包括HR） · GitHub Pages · 產出 ${esc(
        m.generated_at || "—"
      )}（Asia/Macau）<br>
        公開網址：<a href="https://wayneleong-byte.github.io/procure-viz/">wayneleong-byte.github.io/procure-viz</a>
        · 資料來源：採購文件追蹤 Sheet／dataset.json（唯讀）`;
    }
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
    html += `<button type="button" class="status-card" data-goto="home" disabled style="opacity:.7;cursor:default">
      <span class="sc-name">未完成總數</span>
      <span class="sc-num">${total}</span>
    </button>`;
    html += `<button type="button" class="status-card email-entry" data-goto="email">
      <span class="sc-name">行政部郵件時間段統計</span>
      <span class="sc-num">查看 →</span>
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
    $("#btn-goto-email").onclick = () => switchTab("email");
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
    const docs = (DATA.documents || []).filter((d) => d.status === status);
    if (!docs.length) {
      list.innerHTML = `<div class="empty">此狀態目前沒有文件</div>`;
      return;
    }
    list.innerHTML = docs
      .map((d) => {
        const fu = (d.follow_up || []).filter(Boolean).join("、") || "—";
        return `<article class="doc-row" data-id="${esc(d.id)}">
          <button type="button" class="doc-summary" aria-expanded="false">
            <span class="c-id">${esc(d.id)}</span>
            <span class="c-din">${esc(fmtDays(d.days_in_status))}<small>狀態天數</small></span>
            <span class="c-dfs">${esc(fmtDays(d.days_since_first_submit))}<small>首次至今</small></span>
            <span class="c-attr">${esc(d.attr_label || "")}</span>
            <span class="c-title" title="${esc(d.title)}">${esc(d.title)}</span>
            <span class="c-chev" aria-hidden="true">›</span>
          </button>
          <div class="doc-detail">
            <div class="doc-meta-line">
              跟進：<strong style="color:#fff">${esc(fu)}</strong>
              · 提交人：${esc(d.submitter || "—")}
              · 首次／起點：${esc(d.first_submit || "—")}
              · 狀態起點：${esc(d.status_since || "—")}
              · 最近行政回覆：${esc(d.last_reply || "—")}
            </div>
            ${
              d.last_reply_summary
                ? `<div class="doc-meta-line">最近回覆摘要：${esc(d.last_reply_summary)}</div>`
                : ""
            }
            <div class="legend" style="margin-bottom:10px">
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

  function renderAllLists() {
    const order = (DATA.meta && DATA.meta.status_order) || STATUS_ORDER;
    order.forEach(renderDocList);
  }

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

    // 24h half-hour stacked
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
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: { color: "#c8d6dc", boxWidth: 10, font: { size: 10 } },
            },
            tooltip: { mode: "index", intersect: false },
          },
          scales: {
            x: {
              stacked: true,
              ticks: {
                color: "#8aa0ab",
                maxRotation: 90,
                autoSkip: true,
                maxTicksLimit: 24,
                font: { size: 9 },
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

  function renderEmails() {
    const role = $("#filter-role").value;
    const pa = $("#filter-pa").value;
    const onlyOff = $("#filter-off").checked;
    const q = ($("#filter-q").value || "").trim().toLowerCase();
    let rows = DATA.emails || [];
    if (role) rows = rows.filter((e) => e.role === role);
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
    $("#email-count-view").textContent = `顯示 ${rows.length}／${(DATA.emails || []).length}`;
    const box = $("#email-list");
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
          const roleLabel = e.role === "admin" ? "行政" : "EDU";
          return `<div class="email-row${off ? " off-hours" : ""}">
            <div>
              <div class="time">${esc(e.t || "—")}</div>
              ${off ? `<span class="badge off">非辦公</span>` : `<span class="badge on">辦公</span>`}
            </div>
            <div><span class="role-pill ${esc(e.role)}">${roleLabel}</span></div>
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
    $("#filter-role").addEventListener("change", renderEmails);
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
