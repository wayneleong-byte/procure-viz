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

  const ROLE_ZH = { admin: "行政部", edu: "EDU", third: "第三方" };
  const FAN_DEG = [-18, -9, 0, 9, 18];
  const FILTER = { pa: "", q: "", submitter: "", status: "" };

  const reduceMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let DATA = null;
  let emailChart = null;
  let currentView = "board";
  let kpiAnimated = false;

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

  function riskClass(days) {
    const n = Number(days);
    if (!Number.isFinite(n)) return "risk-low";
    if (n >= 21) return "risk-hi";
    if (n >= 7) return "risk-mid";
    return "risk-low";
  }

  function statusOrder() {
    return (DATA.meta && DATA.meta.status_order) || STATUS_ORDER;
  }

  function matchDoc(d) {
    const paQ = FILTER.pa.trim().toLowerCase();
    const q = FILTER.q.trim().toLowerCase();
    const subQ = FILTER.submitter.trim();
    const stQ = FILTER.status.trim();
    if (paQ && !String(d.id || "").toLowerCase().includes(paQ)) return false;
    if (subQ && (d.submitter || "").trim() !== subQ) return false;
    if (stQ && (d.status || "").trim() !== stQ) return false;
    if (q) {
      const hay = `${d.id || ""} ${d.title || ""} ${d.submitter || ""} ${(d.follow_up || []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function allDocs() {
    return (DATA.documents || []).concat(DATA.completed_documents || []);
  }

  function countUp(el, target, { duration = 700, suffix = "" } = {}) {
    if (!el) return;
    const end = Number(target) || 0;
    if (reduceMotion()) {
      el.textContent = `${end}${suffix}`;
      return;
    }
    const start = performance.now();
    const from = 0;
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = `${Math.round(from + (end - from) * eased)}${suffix}`;
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function setRing(chip, pct) {
    if (!chip) return;
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    chip.style.setProperty("--p", String(p));
    requestAnimationFrame(() => chip.classList.add("is-ready"));
  }

  function renderMeta() {
    const m = DATA.meta || {};
    const incomplete = Number(m.incomplete_count) || 0;
    const emails = Number(m.email_count) || 0;
    const off = Number(m.email_off_hours) || 0;
    const overview = Number(m.overview_count) || incomplete + (Number(m.completed_count) || 0) || 1;
    const emailDen = emails || 1;

    $("#meta-line").textContent =
      `最後更新：${m.generated_at || "—"}（${m.timezone || "Asia/Macau"}）· 資料 ${m.source_generated_at || ""}`;

    const totalChip = $('.kpi-chip[data-kpi="total"]');
    const emailChip = $('.kpi-chip[data-kpi="emails"]');
    const offChip = $('.kpi-chip[data-kpi="off"]');

    const totalPct = Math.round((incomplete / overview) * 1000) / 10;
    const offPct = Math.round((off / emailDen) * 1000) / 10;

    $("#stat-total-pct").textContent = `占總覽 ${totalPct}%`;
    $("#stat-emails-pct").textContent = `辦公 ${m.email_on_hours ?? "—"} · 非辦公 ${off}`;
    $("#stat-off-pct").textContent = `${offPct}% 非辦公`;

    if (!kpiAnimated) {
      countUp($("#stat-total"), incomplete);
      countUp($("#stat-emails"), emails);
      countUp($("#stat-off"), off);
      setRing(totalChip, totalPct);
      setRing(emailChip, Math.min(100, (emails / Math.max(emails, 160)) * 100));
      setRing(offChip, offPct);
      kpiAnimated = true;
    } else {
      $("#stat-total").textContent = String(incomplete);
      $("#stat-emails").textContent = String(emails);
      $("#stat-off").textContent = String(off);
      setRing(totalChip, totalPct);
      setRing(emailChip, Math.min(100, (emails / Math.max(emails, 160)) * 100));
      setRing(offChip, offPct);
    }

    renderStatusShare();
  }

  function renderStatusShare() {
    const box = $("#status-share");
    if (!box) return;
    const sc = (DATA.meta && DATA.meta.status_counts) || {};
    const order = statusOrder();
    const total = Number(DATA.meta && DATA.meta.incomplete_count) || order.reduce((a, s) => a + (sc[s] || 0), 0) || 1;
    box.innerHTML = order
      .map((st) => {
        const n = sc[st] || 0;
        const pct = Math.round((n / total) * 1000) / 10;
        return `<div class="share-pill" data-pct="${pct}" style="--p:0%">
          <div class="sp-name">${esc(st)}</div>
          <div class="sp-row"><span class="sp-n" data-n="${n}">0</span><span class="sp-pct">0%</span></div>
          <div class="share-bar-3d"><i></i></div>
        </div>`;
      })
      .join("");

    const pills = $$(".share-pill", box);
    const run = () => {
      pills.forEach((pill) => {
        const pct = Number(pill.dataset.pct) || 0;
        const n = Number($(".sp-n", pill).dataset.n) || 0;
        pill.style.setProperty("--p", `${pct}%`);
        countUp($(".sp-n", pill), n, { duration: 650 });
        const pctEl = $(".sp-pct", pill);
        if (reduceMotion()) {
          pctEl.textContent = `${pct}%`;
        } else {
          const start = performance.now();
          function frame(now) {
            const t = Math.min(1, (now - start) / 650);
            const eased = 1 - Math.pow(1 - t, 3);
            pctEl.textContent = `${Math.round(pct * eased * 10) / 10}%`;
            if (t < 1) requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(() => pill.classList.add("is-ready"));
      });
    };
    requestAnimationFrame(run);
  }

  function fillFilterOptions() {
    const subs = new Set((DATA.meta && DATA.meta.submitters) || []);
    allDocs().forEach((d) => {
      const s = (d.submitter || "").trim();
      if (s) subs.add(s);
    });
    const sel = $("#f-submitter");
    const keep = FILTER.submitter;
    sel.innerHTML =
      `<option value="">全部負責同事</option>` +
      Array.from(subs)
        .sort((a, b) => a.localeCompare(b, "zh-Hant"))
        .map((s) => `<option value="${esc(s)}">${esc(s)}</option>`)
        .join("");
    sel.value = keep || "";

    const order = statusOrder();
    const stSet = new Set();
    allDocs().forEach((d) => {
      if (d.status) stSet.add(d.status);
    });
    const stSel = $("#f-status");
    const keepSt = FILTER.status;
    const opts = [];
    order.forEach((s) => {
      if (stSet.has(s)) {
        opts.push(s);
        stSet.delete(s);
      }
    });
    if (stSet.has("完成")) {
      opts.push("完成");
      stSet.delete("完成");
    }
    Array.from(stSet)
      .sort((a, b) => a.localeCompare(b, "zh-Hant"))
      .forEach((s) => opts.push(s));
    stSel.innerHTML =
      `<option value="">全部狀態</option>` +
      opts.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    stSel.value = keepSt || "";
  }

  function updateFilterCount(shown, total) {
    const el = $("#filter-count");
    const filtered = !!(FILTER.pa || FILTER.q || FILTER.submitter || FILTER.status);
    el.textContent = filtered ? `顯示 ${shown}／${total}` : `共 ${total} 份未完成`;
  }

  function cardHtml(d, delayMs, zPx) {
    const days = d.days_in_status;
    const rc = riskClass(days);
    const who = (d.submitter || "").trim() || "—";
    return `<button type="button" class="doc-card ${rc}" data-id="${esc(d.id)}"
      style="--delay:${delayMs}ms;--z:${zPx}px;--lift:0px">
      <div class="id">${esc(d.id)}</div>
      <div class="title" title="${esc(d.title || "")}">${esc(d.title || "")}</div>
      <div class="meta">
        <span class="days"><i class="dot" aria-hidden="true"></i>${esc(fmtDays(days))} 天</span>
        <span>${esc(who)}</span>
      </div>
    </button>`;
  }

  function renderKanban() {
    const stage = $("#kanban-stage");
    const order = statusOrder();
    const docs = DATA.documents || [];
    const filtered = docs.filter(matchDoc);
    updateFilterCount(filtered.length, docs.length);
    const mid = (order.length - 1) / 2;

    stage.innerHTML = order
      .map((st, pi) => {
        const col = filtered.filter((d) => d.status === st);
        const allInStatus = docs.filter((d) => d.status === st).length;
        const fan = FAN_DEG[pi] != null ? FAN_DEG[pi] : (pi - mid) * 9;
        const pillarDelay = Math.min(pi * 55, 280);
        const cards =
          col.length === 0
            ? `<div class="pillar-empty">無符合文件</div>`
            : col
                .map((d, i) => {
                  const delay = Math.min(pillarDelay + 90 + i * 32, 480);
                  const z = 10 + (i % 5) * 6 + (i % 2) * 4;
                  return cardHtml(d, delay, z);
                })
                .join("");
        const countLabel =
          FILTER.pa || FILTER.q || FILTER.submitter || FILTER.status
            ? `${col.length}／${allInStatus}`
            : String(col.length);
        return `<div class="pillar-slot" style="--fan:${fan}deg;--i:${pi};animation-delay:${pillarDelay}ms" data-status="${esc(st)}">
          <div class="pillar-3d" style="animation-delay:${pillarDelay}ms">
            <div class="face face-back" aria-hidden="true"></div>
            <div class="face face-left" aria-hidden="true"></div>
            <div class="face face-right" aria-hidden="true"></div>
            <div class="face face-top" aria-hidden="true"></div>
            <div class="face face-bottom" aria-hidden="true"></div>
            <div class="face face-front">
              <div class="pillar-head">
                <h3>${esc(st)}</h3>
                <span class="pillar-count">${esc(countLabel)}</span>
              </div>
              <div class="pillar-body">${cards}</div>
            </div>
            <div class="pillar-edge-glow" aria-hidden="true"></div>
          </div>
        </div>`;
      })
      .join("");

    $$(".doc-card", stage).forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.dataset.id));
    });
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
    return `<div class="vt-item">
      <div class="vt-time"></div>
      <div class="vt-body">
        <div class="vt-gap ${esc(role)}${g.open ? " open" : ""}">
          <span class="gap-role">${esc(ROLE_ZH[role] || role)}</span>
          <span>${esc(fmtDays(g.days))} 天${g.open ? "（至今）" : ""}</span>
        </div>
      </div>
    </div>`;
  }

  function renderTimeline(doc) {
    const tl = doc.timeline || {};
    const nodes = tl.nodes || [];
    const gaps = (tl.gaps || []).slice();
    if (!nodes.length) {
      return `<div class="empty">無時間線節點 · 摘要：狀態 ${esc(doc.status || "—")} · 狀態天數 ${esc(fmtDays(doc.days_in_status))} · 首次 ${esc(doc.first_submit || "—")}</div>`;
    }
    const primary = nodes.filter((n) => !n.secondary);
    const secondary = nodes.filter((n) => n.secondary);
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
      let gIdx = gaps.findIndex((g) => {
        if (g.from_ts != null && n.ts != null) return Math.abs(g.from_ts - n.ts) < 2;
        return g.from_t === n.t;
      });
      if (gIdx < 0 && i === primary.length - 1 && gaps.length) gIdx = gaps.length - 1;
      if (gIdx >= 0) {
        const g = gaps.splice(gIdx, 1)[0];
        html += gapHtml(g);
      }
    }
    if (primary.length) {
      const lastTs = primary[primary.length - 1].ts ?? 0;
      secondary
        .filter((s) => (s.ts ?? 0) > lastTs)
        .forEach((s) => {
          html += nodeHtml(s);
        });
    }
    gaps.forEach((g) => {
      html += gapHtml(g);
    });
    html += `</div>`;

    const ts = doc.time_share || {};
    const ap = Number(ts.admin_pct) || 0;
    const ep = Number(ts.edu_pct) || 0;
    const tp = Number(ts.third_pct) || 0;
    const share =
      ap + ep + tp > 0
        ? `<div class="share-bar" role="img" aria-label="時間比例">
            <i class="seg admin" style="flex:0 0 ${ap}%;width:${ap}%"></i>
            <i class="seg edu" style="flex:0 0 ${ep}%;width:${ep}%"></i>
            <i class="seg third" style="flex:0 0 ${tp}%;width:${tp}%"></i>
          </div>
          <div class="share-labels">
            <span>行政 ${ap}%</span><span>EDU ${ep}%</span><span>第三方 ${tp}%</span>
          </div>`
        : "";
    return share + html;
  }

  function findDoc(id) {
    return allDocs().find((d) => d.id === id);
  }

  function openDetail(id) {
    const doc = findDoc(id);
    if (!doc) return;
    const drawer = $("#detail-drawer");
    const backdrop = $("#drawer-backdrop");
    $("#detail-id").textContent = doc.id || "";
    $("#detail-title").textContent = doc.title || "";
    const fu = (doc.follow_up || []).filter(Boolean).join("、") || "—";
    $("#detail-meta").innerHTML = `
      狀態：<strong style="color:#fff">${esc(doc.status || "—")}</strong>
      · 屬性：${esc(doc.attr_label || "—")}
      · 負責：${esc(doc.submitter || "—")}
      · 跟進：${esc(fu)}
      · 狀態天數：${esc(fmtDays(doc.days_in_status))}
      · 首次至今：${esc(fmtDays(doc.days_since_first_submit))}
      · 首次：${esc(doc.first_submit || "—")}
      · 最近行政回覆：${esc(doc.last_reply || "—")}
      ${doc.last_reply_summary ? `<br>摘要：${esc(doc.last_reply_summary)}` : ""}
    `;
    $("#detail-body").innerHTML = renderTimeline(doc);
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
  }

  function closeDetail() {
    const drawer = $("#detail-drawer");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    $("#drawer-backdrop").hidden = true;
  }

  function renderOverview() {
    const list = $("#list-overview");
    const docs = allDocs().filter(matchDoc);
    if (!docs.length) {
      list.innerHTML = `<div class="empty">沒有符合篩選的文件</div>`;
      return;
    }
    list.innerHTML = docs
      .map(
        (d) => `<button type="button" class="row-item" style="grid-template-columns:110px 1.2fr 90px 1.6fr 110px" data-id="${esc(d.id)}">
          <span class="rid">${esc(d.id)}</span>
          <span>${esc(d.status || "—")}</span>
          <span>${esc(d.attr_label || "—")}</span>
          <span class="rtitle">${esc(d.title || "")}</span>
          <span>${esc(d.submitter || "—")}</span>
        </button>`
      )
      .join("");
    $$(".row-item", list).forEach((el) =>
      el.addEventListener("click", () => openDetail(el.dataset.id))
    );
  }

  function renderCompleted() {
    const list = $("#list-completed");
    const docs = (DATA.completed_documents || []).filter((d) => {
      const paQ = FILTER.pa.trim().toLowerCase();
      const q = FILTER.q.trim().toLowerCase();
      const subQ = FILTER.submitter.trim();
      if (paQ && !String(d.id || "").toLowerCase().includes(paQ)) return false;
      if (subQ && (d.submitter || "").trim() !== subQ) return false;
      if (q) {
        const hay = `${d.id || ""} ${d.title || ""} ${d.submitter || ""} ${d.awarded_supplier || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (!docs.length) {
      list.innerHTML = `<div class="empty">沒有已完成文件</div>`;
      return;
    }
    list.innerHTML = docs
      .map(
        (d) => `<button type="button" class="row-item" style="grid-template-columns:110px 70px 90px 1.6fr 1fr" data-id="${esc(d.id)}">
          <span class="rid">${esc(d.id)}</span>
          <span>${esc(fmtDays(d.process_days ?? d.days_since_first_submit))}</span>
          <span>${esc(d.attr_label || "—")}</span>
          <span class="rtitle">${esc(d.title || "")}</span>
          <span>${esc(d.awarded_supplier || "—")}</span>
        </button>`
      )
      .join("");
    $$(".row-item", list).forEach((el) =>
      el.addEventListener("click", () => openDetail(el.dataset.id))
    );
  }

  function renderSupplier() {
    const q = ($("#supplier-q").value || "").trim().toLowerCase();
    const list = $("#list-supplier");
    const count = $("#supplier-count");
    if (!q) {
      count.textContent = "輸入供應商名稱以查詢";
      list.innerHTML = "";
      return;
    }
    const docs = (DATA.completed_documents || []).filter((d) =>
      String(d.awarded_supplier || "").toLowerCase().includes(q)
    );
    count.textContent = `找到 ${docs.length} 份`;
    if (!docs.length) {
      list.innerHTML = `<div class="empty">沒有匹配供應商</div>`;
      return;
    }
    const money = (v) => (v == null || v === "" ? "待補" : esc(String(v)));
    list.innerHTML = docs
      .map(
        (d) => `<div class="row-item" style="grid-template-columns:110px 1.4fr 1fr 1fr 110px;cursor:default">
          <span class="rid">${esc(d.id)}</span>
          <span>${esc(d.awarded_supplier || "—")}</span>
          <span>${money(d.budget_amount)}</span>
          <span>${money(d.award_amount)}</span>
          <span>${esc(d.award_date || "—")}</span>
        </div>`
      )
      .join("");
  }

  function renderEmail() {
    const es = DATA.email_stats || {};
    const on = es.on_hours ?? 0;
    const off = es.off_hours ?? 0;
    const total = es.total || on + off;
    $("#email-kpis").innerHTML = `
      <div class="kpi-chip glow" style="min-width:140px;padding:10px 14px"><div class="kpi-copy"><span class="kpi-label">總電郵</span><span class="kpi-pct">${total}</span></div></div>
      <div class="kpi-chip" style="min-width:140px;padding:10px 14px"><div class="kpi-copy"><span class="kpi-label">辦公時間</span><span class="kpi-pct">${on}</span></div></div>
      <div class="kpi-chip warn" style="min-width:140px;padding:10px 14px"><div class="kpi-copy"><span class="kpi-label">非辦公時間</span><span class="kpi-pct">${off}</span></div></div>
      <div class="kpi-chip" style="min-width:140px;padding:10px 14px"><div class="kpi-copy"><span class="kpi-label">非辦公比例</span><span class="kpi-pct">${total ? Math.round((off / total) * 1000) / 10 : 0}%</span></div></div>`;
    $("#email-analysis").textContent = es.analysis || "";

    if (typeof Chart !== "undefined") {
      const ctx = $("#chart-email-donut");
      if (ctx) {
        if (emailChart) emailChart.destroy();
        emailChart = new Chart(ctx, {
          type: "doughnut",
          data: {
            labels: ["辦公時間", "非辦公時間"],
            datasets: [
              {
                data: [on, off],
                backgroundColor: ["#38bdf8", "#fbbf24"],
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
    renderEmailList();
  }

  function renderEmailList() {
    const offOnly = $("#email-off-only").checked;
    const q = ($("#email-q").value || "").trim().toLowerCase();
    let emails = DATA.emails || [];
    if (offOnly) emails = emails.filter((e) => e.off_hours);
    if (q) {
      emails = emails.filter((e) => {
        const hay = `${e.pa || ""} ${e.subject || ""} ${e.from || ""} ${e.from_addr || ""}`.toLowerCase();
        return hay.includes(q);
      });
    }
    $("#email-count-view").textContent = `顯示 ${emails.length} 封`;
    const list = $("#email-list");
    if (!emails.length) {
      list.innerHTML = `<div class="empty">沒有電郵</div>`;
      return;
    }
    list.innerHTML = emails
      .slice(0, 200)
      .map(
        (e) => `<div class="email-row">
          <div class="er-top">
            <span class="er-pa">${esc(e.pa || "—")}</span>
            ${e.off_hours ? `<span class="er-off">非辦公</span>` : ""}
            <span class="er-meta">${esc(e.t || "")}</span>
          </div>
          <div class="er-sub">${esc(e.subject || "")}</div>
          <div class="er-meta">${esc(e.from || "")} · ${esc(e.kind_label || e.kind || "")}</div>
        </div>`
      )
      .join("");
  }

  function switchView(view) {
    currentView = view;
    $$(".vtab[data-view]").forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    $$(".view").forEach((p) => {
      const on = p.id === `view-${view}`;
      p.classList.toggle("active", on);
      p.hidden = !on;
    });
    refreshCurrentView();
  }

  function refreshCurrentView() {
    if (currentView === "board") renderKanban();
    else if (currentView === "overview") renderOverview();
    else if (currentView === "completed") renderCompleted();
    else if (currentView === "supplier") renderSupplier();
    else if (currentView === "email") renderEmail();
  }

  function wireFilters() {
    const bind = (id, key, evt) => {
      const el = $(id);
      el.addEventListener(evt, () => {
        FILTER[key] = el.value || "";
        refreshCurrentView();
      });
    };
    bind("#f-pa", "pa", "input");
    bind("#f-q", "q", "input");
    bind("#f-submitter", "submitter", "change");
    bind("#f-status", "status", "change");
    $("#f-reset").addEventListener("click", () => {
      FILTER.pa = FILTER.q = FILTER.submitter = FILTER.status = "";
      $("#f-pa").value = "";
      $("#f-q").value = "";
      $("#f-submitter").value = "";
      $("#f-status").value = "";
      refreshCurrentView();
    });
    $("#supplier-q").addEventListener("input", renderSupplier);
    $("#email-off-only").addEventListener("change", renderEmailList);
    $("#email-q").addEventListener("input", renderEmailList);
  }

  function wireChrome() {
    $$(".vtab[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
    $("#detail-close").addEventListener("click", closeDetail);
    $("#drawer-backdrop").addEventListener("click", closeDetail);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDetail();
    });
  }

  async function boot() {
    wireChrome();
    wireFilters();
    try {
      const vizUrl = location.pathname.includes("/preview")
        ? "../data/viz.json"
        : "./data/viz.json";
      const res = await fetch(vizUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      DATA = await res.json();
    } catch (err) {
      $("#meta-line").textContent = `載入失敗：${err.message || err}`;
      return;
    }
    renderMeta();
    fillFilterOptions();
    renderKanban();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
