(function () {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const STATUS_ORDER = [
    "行政部已回覆待同事重交",
    "待對方補充資料後交行政",
    "報價進行中",
    "已提交待回覆",
    "排期執委會／董事會",
    "已獲執委會／董事會通過，待同事提交",
  ];

  const VISIBLE_COLS = 3;
  const SLIDE_MS = 420;

  const ROLE_ZH = { admin: "行政部", edu: "EDU", third: "第三方" };
  const FILTER = { pa: "", q: "", submitter: "", status: "" };

  const reduceMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let DATA = null;
  let emailChart = null;
  let currentView = "board";
  let kpiAnimated = false;
  let pendingCenter = true;

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
    if (stQ) {
      const raw = (d.status || "").trim();
      const col = (d.board_column || raw).trim();
      if (stQ !== raw && stQ !== col) return false;
    }
    if (q) {
      const hay = `${d.id || ""} ${d.title || ""} ${d.submitter || ""} ${(d.follow_up || []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function allDocs() {
    return (DATA.documents || []).concat(DATA.completed_documents || []);
  }

  function boardDocs() {
    return DATA.documents || [];
  }

  function docColumn(d) {
    return (d.board_column || d.status || "").trim();
  }

  function fanDegs(n) {
    if (n <= 1) return [0];
    const half = n >= 7 ? 18 : 18;
    const mid = (n - 1) / 2;
    const step = (2 * half) / (n - 1);
    return Array.from({ length: n }, (_, i) => Math.round((i - mid) * step * 10) / 10);
  }

  function overviewSort(a, b) {
    const id = String(a.id || "").localeCompare(String(b.id || ""), "zh-Hant", {
      numeric: true,
      sensitivity: "base",
    });
    if (id) return id;
    return String(a.first_submit || "").localeCompare(String(b.first_submit || ""));
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
    const hasDone = order.includes("完成");
    const total =
      (hasDone
        ? Number(DATA.meta && DATA.meta.overview_count)
        : Number(DATA.meta && DATA.meta.incomplete_count)) ||
      order.reduce((a, s) => a + (sc[s] || 0), 0) ||
      1;
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
    const colSet = new Set();
    const leftover = new Set();
    allDocs().forEach((d) => {
      const raw = (d.status || "").trim();
      if (!raw) return;
      if (raw === "完成") {
        leftover.add("完成");
        return;
      }
      colSet.add(docColumn(d));
    });
    const stSel = $("#f-status");
    const keepSt = FILTER.status;
    const opts = [];
    const shown = new Set();
    order.forEach((s) => {
      if (colSet.has(s) && !shown.has(s)) {
        opts.push(s);
        shown.add(s);
      }
    });
    if (leftover.has("完成")) {
      opts.push("完成");
      leftover.delete("完成");
    }
    allDocs().forEach((d) => {
      const raw = (d.status || "").trim();
      if (!raw || raw === "完成") return;
      const col = docColumn(d);
      if (!shown.has(col) && !shown.has(raw)) leftover.add(raw);
    });
    Array.from(leftover)
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
    const inc = (DATA.documents || []).length;
    const done = (DATA.completed_documents || []).length;
    el.textContent = filtered
      ? `顯示 ${shown}／${total}`
      : `共 ${inc} 份未完成（已完成 ${done} 份見「已完成」分頁）`;
  }

  function cardHtml(d, delayMs, zPx) {
    const closed = (d.status || "") === "完成";
    const days = closed ? (d.process_days ?? d.days_since_first_submit) : d.days_in_status;
    const rc = closed ? "risk-low" : riskClass(d.days_in_status);
    const who = (d.submitter || "").trim() || "—";
    const dayLabel = closed ? `${esc(fmtDays(days))} 總天數` : `${esc(fmtDays(days))} 天`;
    let extra = "";
    if (d.schedule_meeting) {
      extra += `<div class="meet-pill">${esc(d.schedule_meeting)}</div>`;
    }
    if (d.schedule_date) {
      const sd = d.schedule_days != null && d.schedule_days !== "" ? ` · 已過 ${esc(fmtDays(d.schedule_days))} 天` : "";
      extra += `<div class="sched">排期：${esc(d.schedule_date)}${sd}</div>`;
    }
    if (d.approved_date) {
      extra += `<div class="sched">批准：${esc(d.approved_date)}</div>`;
    }
    if (d.resubmit_after_approval) {
      const rd = d.approval_resub_days != null && d.approval_resub_days !== "" ? ` · ${esc(fmtDays(d.approval_resub_days))} 天` : "";
      extra += `<div class="sched">批准後再遞交：${esc(d.resubmit_after_approval)}${rd}</div>`;
    }
    return `<button type="button" class="doc-card ${rc}" data-id="${esc(d.id)}"
      style="--delay:${delayMs}ms;--z:${zPx}px;--lift:0px">
      <div class="id">${esc(d.id)}</div>
      <div class="title" title="${esc(d.title || "")}">${esc(d.title || "")}</div>
      ${extra}
      <div class="meta">
        <span class="days"><i class="dot" aria-hidden="true"></i>${dayLabel}</span>
        <span>${esc(who)}</span>
      </div>
    </button>`;
  }

  function renderKanban() {
    const stage = $("#kanban-stage");
    const order = statusOrder();
    const docs = boardDocs();
    const filtered = docs.filter(matchDoc);
    updateFilterCount(filtered.length, docs.length);
    const fans = fanDegs(order.length);

    stage.innerHTML = order
      .map((st, pi) => {
        const col = filtered.filter((d) => docColumn(d) === st);
        const allInStatus = docs.filter((d) => docColumn(d) === st).length;
        const fan = fans[pi] != null ? fans[pi] : 0;
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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (pendingCenter) {
          pendingCenter = false;
          centerAwaitingColumn();
        } else {
          restoreStagePosition();
        }
        updateStageNav();
      });
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
      ${doc.schedule_date ? ` · 排期${esc(doc.schedule_meeting ? doc.schedule_meeting : "")}：${esc(doc.schedule_date)}${doc.schedule_days != null && doc.schedule_days !== "" ? `（已過 ${esc(fmtDays(doc.schedule_days))} 天）` : ""}` : ""}
      ${doc.approved_date ? ` · 批准：${esc(doc.approved_date)}` : ""}
      ${doc.resubmit_after_approval ? ` · 批准後再遞交：${esc(doc.resubmit_after_approval)}${doc.approval_resub_days != null && doc.approval_resub_days !== "" ? `（${esc(fmtDays(doc.approval_resub_days))} 天）` : ""}` : ""}
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

  function colStep(vp) {
    const col = vp.querySelector(".pillar-slot");
    const stage = vp.querySelector(".stage") || $("#kanban-stage");
    if (!col) return Math.max(1, vp.clientWidth);
    const gap = parseFloat(getComputedStyle(stage).gap) || 0;
    return col.getBoundingClientRect().width + gap;
  }

  function maxStageIndex(vp) {
    const cols = $$(".pillar-slot", vp);
    return Math.max(0, cols.length - VISIBLE_COLS);
  }

  let stageX = 0;
  let stageIndex = 0;
  let slideAnim = 0;

  function applyStageX(x, stage) {
    stageX = x;
    stage.style.setProperty("--stage-x", `${-x}px`);
  }

  function restoreStagePosition() {
    const vp = $("#stage-viewport");
    const stage = $("#kanban-stage");
    if (!vp || !stage) return;
    stageIndex = Math.max(0, Math.min(maxStageIndex(vp), stageIndex));
    applyStageX(stageIndex * colStep(vp), stage);
  }

  function updateStageNav() {
    const vp = $("#stage-viewport");
    const prev = $("#stage-prev");
    const next = $("#stage-next");
    const wrap = vp && vp.closest(".stage-wrap");
    const hint = $("#stage-nav-hint");
    if (!vp) return;
    const cols = $$(".pillar-slot", vp);
    const maxIdx = maxStageIndex(vp);
    const canSlide = cols.length > VISIBLE_COLS;
    if (prev && next) {
      prev.disabled = !canSlide || stageIndex <= 0;
      next.disabled = !canSlide || stageIndex >= maxIdx;
    }
    if (wrap) {
      wrap.classList.toggle("can-prev", canSlide && stageIndex > 0);
      wrap.classList.toggle("can-next", canSlide && stageIndex < maxIdx);
    }
    if (hint) {
      if (!cols.length) {
        hint.textContent = "";
      } else {
        const start = stageIndex + 1;
        const end = Math.min(cols.length, stageIndex + VISIBLE_COLS);
        hint.textContent = `顯示第 ${start}–${end} 欄，共 ${cols.length} 欄 · 左右按鈕可移到上一組／下一組`;
      }
    }
  }

  function animateStageTo(index, ms) {
    const vp = $("#stage-viewport");
    const stage = $("#kanban-stage");
    if (!vp || !stage) return;
    index = Math.max(0, Math.min(maxStageIndex(vp), index));
    const target = index * colStep(vp);
    if (reduceMotion()) {
      stageIndex = index;
      applyStageX(target, stage);
      updateStageNav();
      return;
    }
    const start = stageX;
    const delta = target - start;
    if (Math.abs(delta) < 1) {
      stageIndex = index;
      applyStageX(target, stage);
      updateStageNav();
      return;
    }
    const dur = ms || SLIDE_MS;
    const id = ++slideAnim;
    const t0 = performance.now();
    function frame(now) {
      if (id !== slideAnim) return;
      const t = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      applyStageX(start + delta * eased, stage);
      if (t < 1) requestAnimationFrame(frame);
      else {
        stageIndex = index;
        applyStageX(target, stage);
        updateStageNav();
      }
    }
    requestAnimationFrame(frame);
  }

  function shiftStage(dir) {
    animateStageTo(stageIndex + dir * VISIBLE_COLS, SLIDE_MS);
  }

  function centerAwaitingColumn() {
    const vp = $("#stage-viewport");
    const stage = $("#kanban-stage");
    if (!vp || !stage) return;
    const cols = $$(".pillar-slot", vp);
    if (!cols.length) return;
    const mid = cols.findIndex((c) => (c.dataset.status || "") === "已提交待回覆");
    const vis = VISIBLE_COLS;
    let start = 0;
    if (mid >= 0) {
      start = Math.max(0, Math.min(mid - Math.floor((vis - 1) / 2), maxStageIndex(vp)));
    }
    stageIndex = start;
    applyStageX(start * colStep(vp), stage);
  }

  let stageNavBound = false;
  function bindStageNav() {
    if (stageNavBound) return;
    const vp = $("#stage-viewport");
    const prev = $("#stage-prev");
    const next = $("#stage-next");
    const stage = $("#kanban-stage");
    if (!vp || !prev || !next || !stage) return;
    stageNavBound = true;
    prev.addEventListener("click", () => shiftStage(-1));
    next.addEventListener("click", () => shiftStage(1));
    window.addEventListener("resize", () => {
      restoreStagePosition();
      updateStageNav();
    });
    document.addEventListener("keydown", (e) => {
      if (currentView !== "board") return;
      if (e.defaultPrevented) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        shiftStage(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        shiftStage(1);
      }
    });

    let pid = null;
    let dragStartX = 0;
    let dragOrigin = 0;
    let dragging = false;
    let suppressClick = false;
    let captured = false;

    const onMove = (e) => {
      if (pid == null || e.pointerId !== pid) return;
      const dx = e.clientX - dragStartX;
      if (!dragging && Math.abs(dx) < 8) return;
      if (!dragging) {
        dragging = true;
        // Capture only after a real drag starts. Capturing on pointerdown
        // retargets the following click to the viewport, so cards never open.
        try {
          vp.setPointerCapture(pid);
          captured = true;
        } catch (_) {}
      }
      slideAnim += 1;
      const max = maxStageIndex(vp) * colStep(vp);
      applyStageX(Math.max(0, Math.min(max, dragOrigin - dx)), stage);
    };

    const endDrag = (e) => {
      if (pid == null || e.pointerId !== pid) return;
      if (captured) {
        try { vp.releasePointerCapture(pid); } catch (_) {}
      }
      captured = false;
      pid = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      if (!dragging) return;
      dragging = false;
      suppressClick = true;
      const step = colStep(vp);
      const idx = Math.round(stageX / step);
      animateStageTo(Math.max(0, Math.min(maxStageIndex(vp), idx)), 320);
    };

    vp.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      pid = e.pointerId;
      dragStartX = e.clientX;
      dragOrigin = stageX;
      dragging = false;
      captured = false;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    });
    vp.addEventListener("click", (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  function renderOverview() {
    const list = $("#list-overview");
    const docs = allDocs().filter(matchDoc).sort(overviewSort);
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

  function renderWeekdayRatio(es) {
    const block = $("#weekday-block");
    const chips = $("#weekday-chips");
    const bars = $("#weekday-bars");
    const summaryEl = $("#weekday-summary");
    if (!block || !chips) return;
    const ww = es.weekday_weekdays || {};
    const byDay = ww.by_day || [];
    const byWd = es.by_weekday || {};
    const total = es.total || 0;
    if (summaryEl) {
      summaryEl.textContent =
        ww.summary ||
        (total
          ? `平日合計 ${ww.count ?? 0} 封（${ww.pct ?? 0}%）；週末合計 ${ww.weekend_count ?? 0} 封（${ww.weekend_pct ?? 0}%）。`
          : "");
    }
    const dayOrder = ["星期一", "星期二", "星期三", "星期四", "星期五"];
    const rows =
      byDay.length > 0
        ? byDay
        : dayOrder.map((label) => {
            const v = byWd[label] || {};
            return {
              label,
              count: v.count || 0,
              pct: v.pct || 0,
            };
          });
    const maxPct = Math.max(1, ...rows.map((r) => Number(r.pct) || 0));
    chips.innerHTML = rows
      .map(
        (r) => `<div class="wd-chip" title="${esc(r.label)} ${r.count} 封">
          <span class="wd-label">${esc(r.label)}</span>
          <span class="wd-count">${r.count}</span>
          <span class="wd-pct">${r.pct}%</span>
        </div>`
      )
      .join("");
    const sat = byWd["星期六"] || {};
    const sun = byWd["星期日"] || {};
    const weekendCount = ww.weekend_count ?? (sat.count || 0) + (sun.count || 0);
    const weekendPct =
      ww.weekend_pct != null
        ? ww.weekend_pct
        : total
          ? Math.round((weekendCount / total) * 1000) / 10
          : 0;
    chips.innerHTML += `<div class="wd-chip weekend" title="週末 ${weekendCount} 封">
          <span class="wd-label">週末</span>
          <span class="wd-count">${weekendCount}</span>
          <span class="wd-pct">${weekendPct}%</span>
        </div>`;
    if (bars) {
      bars.innerHTML = rows
        .map((r) => {
          const w = Math.max(4, Math.round(((Number(r.pct) || 0) / maxPct) * 100));
          return `<div class="wd-bar-row">
            <span class="wd-bar-label">${esc(r.label.replace("星期", ""))}</span>
            <div class="wd-bar-track"><div class="wd-bar-fill" style="width:${w}%"></div></div>
            <span class="wd-bar-meta">${r.count} · ${r.pct}%</span>
          </div>`;
        })
        .join("");
    }
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
    renderWeekdayRatio(es);
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
    bindStageNav();
    renderKanban();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
