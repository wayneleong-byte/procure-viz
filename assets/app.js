(function () {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  let DATA = null;
  let focusedId = null;
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function statusLabel(g, status) {
    return `<span class="badge ${esc(g)}">${esc(status)}</span>`;
  }

  function fmtNum(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  }

  function pct(ts, span) {
    if (!span || span.max_ts == null || span.min_ts == null) return 50;
    if (span.max_ts === span.min_ts) return 50;
    const p = ((ts - span.min_ts) / (span.max_ts - span.min_ts)) * 100;
    return Math.max(1, Math.min(99, p));
  }

  function parseLoose(t) {
    if (!t) return null;
    const d = Date.parse(
      String(t).replace(" ", "T") +
        (String(t).includes("+") || String(t).includes("Z") ? "" : "+08:00")
    );
    return Number.isFinite(d) ? d / 1000 : null;
  }

  function enrichSpan(doc) {
    const tl = doc.timeline || {};
    let span = tl.span ? { ...tl.span } : null;
    const times = [];
    (tl.events || []).forEach((e) => {
      const ts = e.ts != null ? e.ts : parseLoose(e.t);
      if (ts != null) times.push(ts);
    });
    (tl.segments || []).forEach((s) => {
      const a = parseLoose(s.start);
      const b = parseLoose(s.end);
      if (a != null) times.push(a);
      if (b != null) times.push(b);
    });
    if (times.length) {
      span = { min_ts: Math.min(...times), max_ts: Math.max(...times) };
    }
    return span;
  }

  /* ---- Flip board ---- */
  function makeDigitEl(ch, tone) {
    const el = document.createElement("div");
    if (ch === "." || ch === ",") {
      el.className = "flip-digit dot";
      el.textContent = ".";
      return el;
    }
    if (!/\d/.test(ch)) {
      el.className = "flip-digit char";
      el.textContent = ch;
      return el;
    }
    el.className = `flip-digit tone-${tone || "danger"}`;
    el.dataset.target = ch;
    el.innerHTML = `
      <div class="top"><span>0</span></div>
      <div class="bottom"><span>0</span></div>
      <div class="hinge"><span>0</span></div>`;
    return el;
  }

  function buildFlipBoard(display, tone) {
    const board = document.createElement("div");
    board.className = "flip-board";
    String(display ?? "—")
      .split("")
      .forEach((ch) => board.appendChild(makeDigitEl(ch, tone)));
    return board;
  }

  function animateFlipBoard(board) {
    const digits = $$(".flip-digit[data-target]", board);
    digits.forEach((digit, idx) => {
      const target = digit.dataset.target;
      const top = digit.querySelector(".top span");
      const bottom = digit.querySelector(".bottom span");
      const hinge = digit.querySelector(".hinge");
      const hingeSpan = digit.querySelector(".hinge span");
      let cur = 0;
      const steps = Number(target);
      const delay = idx * 90;
      setTimeout(() => {
        const tick = () => {
          if (cur >= steps) {
            top.textContent = target;
            bottom.textContent = target;
            hingeSpan.textContent = target;
            digit.classList.remove("flipping");
            return;
          }
          const next = cur + 1;
          hingeSpan.textContent = String(cur);
          top.textContent = String(next);
          digit.classList.remove("flipping");
          void digit.offsetWidth;
          digit.classList.add("flipping");
          const onEnd = () => {
            hinge.removeEventListener("animationend", onEnd);
            bottom.textContent = String(next);
            hingeSpan.textContent = String(next);
            digit.classList.remove("flipping");
            cur = next;
            setTimeout(tick, 40);
          };
          hinge.addEventListener("animationend", onEnd);
        };
        tick();
      }, delay);
    });
  }

  function renderHeadlines() {
    const box = $("#headlines");
    const items = (DATA.meta && DATA.meta.headlines) || [];
    if (!items.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = "";
    const boards = [];
    items.forEach((h) => {
      const card = document.createElement("article");
      card.className = `hl-card tone-${esc(h.tone || "danger")}`;
      const label = document.createElement("div");
      label.className = "hl-label";
      label.textContent = h.label || "";
      card.appendChild(label);

      if (h.id === "avg_admin_vs_edu") {
        const pair = document.createElement("div");
        pair.className = "hl-pair";
        const adminBlock = document.createElement("div");
        adminBlock.className = "hl-pair-block";
        adminBlock.innerHTML = `<span class="hl-pair-tag admin">行政（慢）</span>`;
        const adminBoard = buildFlipBoard(h.display_admin ?? h.value_admin, "admin");
        adminBlock.appendChild(adminBoard);
        const vs = document.createElement("div");
        vs.className = "hl-vs";
        vs.textContent = "vs";
        const eduBlock = document.createElement("div");
        eduBlock.className = "hl-pair-block";
        eduBlock.innerHTML = `<span class="hl-pair-tag edu">EED（快）</span>`;
        const eduBoard = buildFlipBoard(h.display_edu ?? h.value_edu, "edu");
        eduBlock.appendChild(eduBoard);
        const unit = document.createElement("span");
        unit.className = "hl-unit";
        unit.textContent = h.unit || "天";
        pair.appendChild(adminBlock);
        pair.appendChild(vs);
        pair.appendChild(eduBlock);
        pair.appendChild(unit);
        card.appendChild(pair);
        boards.push(adminBoard, eduBoard);
      } else {
        const row = document.createElement("div");
        row.className = "hl-value-row";
        const tone = h.tone === "fast" ? "fast" : "danger";
        const board = buildFlipBoard(h.display ?? h.value, tone);
        row.appendChild(board);
        const unit = document.createElement("span");
        unit.className = "hl-unit";
        unit.textContent = h.unit || "天";
        row.appendChild(unit);
        card.appendChild(row);
        boards.push(board);
      }

      if (h.sub) {
        const sub = document.createElement("div");
        sub.className = "hl-sub";
        sub.textContent = h.sub;
        card.appendChild(sub);
      }
      if (h.hint) {
        const hint = document.createElement("div");
        hint.className = "hl-hint";
        hint.textContent = h.hint;
        card.appendChild(hint);
      }
      box.appendChild(card);
    });
    requestAnimationFrame(() => boards.forEach(animateFlipBoard));
  }

  function dayBadges(d) {
    const parts = [];
    const at = fmtNum(d.admin_total);
    const ct = fmtNum(d.colleague_total);
    if (at != null) {
      parts.push(`<span class="badge days-danger" title="行政累計處理天數">行政 ${esc(at)}天</span>`);
    }
    if (ct != null) {
      parts.push(`<span class="badge days-fast" title="EED／同事累計處理天數">EED ${esc(ct)}天</span>`);
    }
    if (d.status_group === "awaiting_admin") {
      // show open wait if we can infer from open segment
      const open = (d.timeline?.segments || []).find((s) => s.open && s.role === "admin");
      if (open && open.days != null) {
        parts.push(`<span class="badge days-danger">待回覆 ${esc(fmtNum(open.days))}天</span>`);
      }
    }
    if (d.status_group === "pending_resubmit" && d.days_since_reply != null) {
      parts.push(
        `<span class="badge days-fast">待重交 ${esc(fmtNum(d.days_since_reply))}天</span>`
      );
    }
    if (!parts.length) return "";
    return `<span class="day-badges">${parts.join("")}</span>`;
  }

  function isSlowAdmin(d) {
    const at = Number(d.admin_total);
    return (Number.isFinite(at) && at >= 20) || d.status_group === "awaiting_admin";
  }

  function renderOverview() {
    const list = $("#doc-list");
    const docs = DATA.documents || [];
    if (!docs.length) {
      list.innerHTML = `<div class="empty">目前沒有未完成文件</div>`;
      return;
    }
    list.innerHTML = docs
      .map((d) => {
        const span = enrichSpan(d);
        const segs = (d.timeline?.segments || [])
          .map((s) => {
            const a = parseLoose(s.start);
            const b = parseLoose(s.end);
            if (a == null || b == null || !span) return "";
            const left = pct(Math.min(a, b), span);
            const right = pct(Math.max(a, b), span);
            const w = Math.max(0.8, right - left);
            return `<div class="seg ${esc(s.role)}${s.open ? " open" : ""}" style="left:calc(12px + (100% - 24px)*${left / 100});width:calc((100% - 24px)*${w / 100})" title="${esc(s.label || "")}"></div>`;
          })
          .join("");
        const evs = (d.timeline?.events || [])
          .map((e) => {
            const ts = e.ts != null ? e.ts : parseLoose(e.t);
            if (ts == null || !span) return "";
            const left = pct(ts, span);
            return `<div class="ev ${esc(e.kind)}" style="left:calc(12px + (100% - 24px)*${left / 100})" data-kind="${esc(e.kind)}" title="${esc((e.label || "") + " · " + (e.t || ""))}"></div>`;
          })
          .join("");

        const fu = (d.follow_up || []).filter(Boolean).join("、") || "—";
        const eventsRows = (d.timeline?.events || [])
          .map(
            (e) => `<tr>
            <td>${esc(e.t || "")}</td>
            <td><span class="role-pill ${esc(e.role)}">${e.role === "admin" ? "行政" : "EDU"}</span></td>
            <td>${esc(e.label || e.kind)}</td>
            <td>${esc(e.who || "")}${e.detail ? `<div style="color:var(--muted);font-size:.78rem;margin-top:2px">${esc(String(e.detail).slice(0, 140))}</div>` : ""}</td>
          </tr>`
          )
          .join("");

        const slow = isSlowAdmin(d) ? " slow-admin" : "";
        return `<article class="doc-row${slow}" data-id="${esc(d.id)}" tabindex="0"
          data-title="${esc(d.title)}" data-follow="${esc(fu)}" data-submitter="${esc(d.submitter || "")}">
          <div class="doc-head">
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
              <span class="doc-id">${esc(d.id)}</span>
              ${statusLabel(d.status_group, d.status)}
              ${dayBadges(d)}
              <span class="doc-meta">R${esc(d.current_round ?? "—")} · ${esc(d.stage || "")}</span>
            </div>
            <div class="doc-title-hint" title="${esc(d.title)}">${esc(d.title)}</div>
          </div>
          <div class="timeline" aria-label="來回時間線">
            <div class="track"></div>
            ${segs}${evs}
          </div>
          <div class="doc-detail">
            <div>跟進：<strong style="color:#fff">${esc(fu)}</strong>
              · 提交人：${esc(d.submitter || "—")}
              · 首次提交：${esc(d.first_submit || "—")}
              · 最近行政回覆：${esc(d.last_reply || "—")}
              · 行政累計：${esc(fmtNum(d.admin_total) ?? "—")}天
              · EED累計：${esc(fmtNum(d.colleague_total) ?? "—")}天
            </div>
            ${d.last_reply_summary ? `<div style="margin-top:6px">摘要：${esc(d.last_reply_summary)}</div>` : ""}
            <table class="event-table">
              <thead><tr><th>時間</th><th>角色</th><th>事件</th><th>說明</th></tr></thead>
              <tbody>${eventsRows || `<tr><td colspan="4">（無時間線事件）</td></tr>`}</tbody>
            </table>
          </div>
        </article>`;
      })
      .join("");

    list.classList.toggle("zoomed", !!focusedId);
    $$(".doc-row", list).forEach((row) => {
      const id = row.dataset.id;
      row.classList.toggle("focused", focusedId === id);
      row.addEventListener("click", () => toggleFocus(id));
      row.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          toggleFocus(id);
        }
      });
      row.addEventListener("mousemove", (ev) => showTip(row, ev));
      row.addEventListener("mouseleave", hideTip);
    });
  }

  function toggleFocus(id) {
    focusedId = focusedId === id ? null : id;
    const list = $("#doc-list");
    list.classList.toggle("zoomed", !!focusedId);
    $$(".doc-row", list).forEach((row) => {
      row.classList.toggle("focused", focusedId === row.dataset.id);
    });
    if (focusedId) {
      const el = $(`.doc-row[data-id="${CSS.escape(focusedId)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function showTip(row, ev) {
    tip.innerHTML = `<div class="tt-id">${esc(row.dataset.id)}</div>
      <div class="tt-title">${esc(row.dataset.title)}</div>
      <div class="tt-meta">跟進／負責：${esc(row.dataset.follow || "—")}<br>提交人：${esc(row.dataset.submitter || "—")}</div>`;
    tip.classList.add("show");
    const x = Math.min(ev.clientX + 14, window.innerWidth - 360);
    const y = Math.min(ev.clientY + 14, window.innerHeight - 120);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function hideTip() {
    tip.classList.remove("show");
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
              ${off ? `<span class="badge off">非上班</span>` : `<span class="badge on">上班時段</span>`}
            </div>
            <div><span class="role-pill ${esc(e.role)}">${roleLabel}</span></div>
            <div class="pa">${esc(e.pa || "—")}</div>
            <div>
              <div class="subj">${esc(e.subject || "(無標題)")}</div>
              <div class="from">${esc(e.from || "")} · ${esc(e.kind || "")} · ${esc(e.folder || "")}</div>
            </div>
          </div>`;
        })
        .join("") +
      (rows.length > MAX
        ? `<div class="empty">已截斷顯示前 ${MAX} 筆（請用篩選收窄）</div>`
        : "");
  }

  function bindTabs() {
    $$(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".tab").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        $$(".panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        $(`#panel-${btn.dataset.tab}`)?.classList.add("active");
      });
    });
  }

  function renderMeta() {
    const m = DATA.meta || {};
    $("#stat-incomplete").textContent = m.incomplete_count ?? "—";
    $("#stat-emails").textContent = m.email_count ?? "—";
    $("#stat-off").textContent = m.email_off_hours ?? "—";
    $("#stat-progress").textContent = m.progress_linked_count ?? "—";
    $("#meta-line").textContent =
      `資料來源 generated_at：${m.source_generated_at || "—"} · 本頁產出：${m.generated_at || "—"}（${m.timezone || "Asia/Macau"}）`;
    const sc = m.status_counts || {};
    $("#status-breakdown").textContent = Object.entries(sc)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ");
    const foot = $("#site-footer");
    if (foot) {
      foot.innerHTML = `採購文件可視化 · GitHub Pages 已上線 · 產出 ${esc(m.generated_at || "—")}（Asia/Macau）<br>
        公開網址：<a href="https://wayneleong-byte.github.io/procure-viz/">wayneleong-byte.github.io/procure-viz</a>
        · 唯讀資料來源 dataset.json`;
    }
  }

  async function boot() {
    const res = await fetch("./data/viz.json");
    if (!res.ok) throw new Error("無法載入 data/viz.json");
    DATA = await res.json();
    renderMeta();
    renderHeadlines();
    renderOverview();
    fillEmailFilters();
    renderEmails();
    bindTabs();
    $("#filter-role").addEventListener("change", renderEmails);
    $("#filter-pa").addEventListener("change", renderEmails);
    $("#filter-off").addEventListener("change", renderEmails);
    $("#filter-q").addEventListener("input", renderEmails);
    $("#btn-clear-focus").addEventListener("click", () => {
      focusedId = null;
      renderOverview();
    });
  }

  boot().catch((err) => {
    $("#doc-list").innerHTML = `<div class="empty">載入失敗：${esc(err.message)}<br>請用本機 HTTP server 開啟（見 README），勿直接用部分瀏覽器的 file:// 限制。</div>`;
    console.error(err);
  });
})();
