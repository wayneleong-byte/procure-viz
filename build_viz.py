#!/usr/bin/env python3
"""Build slim viz.json for 教育部工作文件進程（不包括HR）.

Read-only on /workspace/procure/{dataset,sheet_rows,history}.json.
Writes /workspace/procure-viz/data/viz.json.
Timezone: Asia/Macau. No secrets. No qualitative 快/慢 wording.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PROCURE = Path("/workspace/procure")
OUT_DIR = Path("/workspace/procure-viz")
DATA_DIR = OUT_DIR / "data"
TZ = ZoneInfo("Asia/Macau")

WORK_START = 9 * 60
WORK_END = 18 * 60 + 30

ADMIN_FOLDERS = {"04 Procure"}
EDU_FOLDERS = {"000[提交至行政採購文件]", "000 文件進度查詢"}

# Fixed display order for home + tabs
STATUS_ORDER = [
    "已提交待回覆",
    "報價進行中",
    "行政部與甲方跟進中",
    "待對方補充資料後交行政",
    "行政部已回覆待同事重交",
]

STATUS_GROUP = {
    "已提交待回覆": "awaiting_admin",
    "報價進行中": "quotation",
    "行政部與甲方跟進中": "admin_client",
    "待對方補充資料後交行政": "awaiting_party",
    "行政部已回覆待同事重交": "pending_resubmit",
}

THIRD_STATUSES = {
    "報價進行中",
    "行政部與甲方跟進中",
    "待對方補充資料後交行政",
}

KIND_LABEL_ZH = {
    "submission": "提交",
    "revision": "修改回覆",
    "approval": "批准／通過",
    "info": "資訊",
    "notice": "通知",
    "other": "其他",
    "progress_inquiry": "進度查詢",
}

STAGE_LABEL_ZH = {
    "Form 1": "Form 1",
    "Form 2": "Form 2",
    "不適用（無編號）": "無編號",
    "": "未分類",
}


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    s = str(s).strip()
    try:
        if "T" in s or "+" in s[10:] or s.endswith("Z"):
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=TZ)
            else:
                dt = dt.astimezone(TZ)
            return dt
    except Exception:
        pass
    for fmt, n in (
        ("%Y-%m-%d %H:%M:%S", 19),
        ("%Y-%m-%d %H:%M", 16),
        ("%Y-%m-%d", 10),
    ):
        try:
            dt = datetime.strptime(s[:n], fmt)
            return dt.replace(tzinfo=TZ)
        except ValueError:
            continue
    return None


def is_off_hours(dt: datetime | None) -> bool | None:
    if dt is None:
        return None
    if dt.weekday() >= 5:
        return True
    mins = dt.hour * 60 + dt.minute
    return not (WORK_START <= mins <= WORK_END)


def display_name(person) -> str:
    if not person:
        return ""
    if isinstance(person, list):
        return ", ".join(display_name(p) for p in person if p)
    s = str(person)
    m = re.match(r"^([^<]+)<", s)
    if m:
        return m.group(1).strip()
    return s.strip()


def role_of_email(e: dict) -> str:
    folder = e.get("folder") or ""
    if folder in ADMIN_FOLDERS:
        return "admin"
    if folder in EDU_FOLDERS:
        return "edu"
    fa = (e.get("from_addr") or "").lower()
    if "procure@" in fa:
        return "admin"
    return "edu"


def to_float(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def days_between(a: datetime | None, b: datetime | None) -> float | None:
    if not a or not b:
        return None
    return max(0.0, round((b - a).total_seconds() / 86400.0, 1))


def days_since(date_str: str | None, today_d) -> int | None:
    dt = parse_dt(date_str)
    if not dt:
        return None
    return max(0, (today_d - dt.date()).days)


def stage_short(stage: str) -> str:
    s = (stage or "").strip()
    if s in ("不適用（無編號）", "不適用", "無編號"):
        return "無編號"
    return s or "—"


def attr_label(doc: dict) -> str:
    rn = doc.get("current_round")
    rpart = f"R{rn}" if rn not in (None, "") else "R—"
    return f"{rpart} · {stage_short(doc.get('stage') or '')}"


def parse_reply_annotations(round_obj: dict) -> dict[str, str]:
    """Extract date → summary from round notes like 2026-10-09「行政部收到第三方回饋」."""
    out: dict[str, str] = {}
    for note in round_obj.get("notes") or []:
        if not note:
            continue
        for m in re.finditer(
            r"(20\d{2}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*[「\"]([^」\"]+)[」\"]",
            str(note),
        ):
            out[m.group(1).strip()] = m.group(2).strip()
        # also bare: 行政部回覆 2026-09-07 …
        for m in re.finditer(
            r"行政部回覆\s+(20\d{2}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?)",
            str(note),
        ):
            out.setdefault(m.group(1).strip(), "行政部回覆")
    return out


def resolve_first_submit(doc: dict) -> tuple[str, bool]:
    """Return (date_str, estimated). Prefer dataset first_submit; else earliest round date."""
    fs = (doc.get("first_submit") or "").strip()
    if fs:
        return fs, False
    candidates: list[tuple[int, float, str]] = []  # priority, ts, raw
    for r in doc.get("rounds") or []:
        for key, pri in (("submission_date", 0), ("resub_date", 1), ("reply_date", 2)):
            raw = r.get(key) or ""
            if not raw:
                continue
            dt = parse_dt(raw)
            if dt:
                candidates.append((pri, dt.timestamp(), raw))
        for rd in r.get("reply_dates") or []:
            if not rd:
                continue
            dt = parse_dt(rd)
            if dt:
                candidates.append((2, dt.timestamp(), rd))
    if not candidates:
        return "", True
    # earliest by time; if tie, prefer submission
    candidates.sort(key=lambda x: (x[1], x[0]))
    pri, _, raw = candidates[0]
    return raw, pri >= 2


def resolve_completed_at(doc: dict) -> str:
    """Best-effort completion / last-event timestamp for closed docs."""
    candidates: list[tuple[float, str]] = []
    for raw in (doc.get("last_resubmit"), doc.get("last_reply")):
        if not raw:
            continue
        dt = parse_dt(raw)
        if dt:
            candidates.append((dt.timestamp(), raw))
    for r in doc.get("rounds") or []:
        for key in ("resub_date", "reply_date", "submission_date"):
            raw = r.get(key) or ""
            if not raw:
                continue
            dt = parse_dt(raw)
            if dt:
                candidates.append((dt.timestamp(), raw))
        for rd in r.get("reply_dates") or []:
            if not rd:
                continue
            dt = parse_dt(rd)
            if dt:
                candidates.append((dt.timestamp(), rd))
    if not candidates:
        return ""
    candidates.sort(key=lambda x: x[0])
    return candidates[-1][1]


def status_anchor_date(doc: dict) -> str:
    """Date when current status started (for days_in_status)."""
    status = doc.get("status") or ""
    first, _ = resolve_first_submit(doc)
    if status == "完成":
        return resolve_completed_at(doc) or doc.get("last_reply") or first or ""
    if status == "行政部已回覆待同事重交":
        return doc.get("last_reply") or ""
    if status == "已提交待回覆":
        return doc.get("last_resubmit") or first or ""
    if status in THIRD_STATUSES:
        return (
            doc.get("last_reply")
            or doc.get("last_resubmit")
            or first
            or ""
        )
    return first or ""


def gap_role_between(prev: dict, nxt: dict | None, status: str, open_end: bool) -> str:
    """Assign interval colour role: admin | edu | third."""
    pk = prev.get("kind") or ""
    pr = prev.get("role") or ""

    if open_end or nxt is None:
        if status == "已提交待回覆":
            return "admin"
        if status == "行政部已回覆待同事重交":
            return "edu"
        if status in THIRD_STATUSES:
            return "third"
        if pr == "edu" or pk in ("submission", "resubmission", "first_submit"):
            return "admin"
        if pr == "admin" or pk == "admin_reply":
            return "edu"
        return "third"

    nk = nxt.get("kind") or ""
    nr = nxt.get("role") or ""

    # EDU提交 → 行政回覆：行政處理
    if pk in ("submission", "resubmission", "first_submit") and (
        nk == "admin_reply" or nr == "admin"
    ):
        return "admin"
    # 行政回覆 → EDU重交／提交：EDU處理
    if pk == "admin_reply" and nk in ("submission", "resubmission", "first_submit"):
        return "edu"
    # 涉及第三方／甲方節點：間隔用藍色
    if pr == "third" or nr == "third" or pk == "third_party" or nk == "third_party":
        if status in THIRD_STATUSES or pr == "third" or nr == "third":
            return "third"
    # 行政回覆 → 另一則行政回覆：仍算行政段（或第三方跟進中）
    if pk == "admin_reply" and nk == "admin_reply":
        if status in THIRD_STATUSES:
            return "third"
        return "admin"
    # 兩次 EDU 節點之間
    if pr == "edu" and nr == "edu":
        return "edu"
    if pr == "admin" and nr == "edu":
        return "edu"
    if pr == "edu" and nr == "admin":
        return "admin"
    if status in THIRD_STATUSES:
        return "third"
    if pr == "admin":
        return "admin"
    if pr == "edu":
        return "edu"
    return "third"


def build_timeline(
    doc: dict,
    progress: list[dict],
    today_dt: datetime,
    *,
    closed: bool = False,
) -> dict:
    """nodes + gaps; gaps show days with role colour (admin/edu/third).

    closed=True（已完成）：唔加「至今」open gap；可加完成節點並喺終點收束。
    """
    status = doc.get("status") or ""
    nodes: list[dict] = []
    first, first_est = resolve_first_submit(doc)
    first_dt = parse_dt(first)

    # Ensure first-submit / 紀錄起點 node exists at timeline start
    if first:
        already_sub = any(
            (r.get("submission_date") or "") == first for r in (doc.get("rounds") or [])
        )
        if not already_sub:
            nodes.append(
                {
                    "t": first,
                    "ts": first_dt.timestamp() if first_dt else None,
                    "kind": "first_submit",
                    "role": "edu",
                    "label": "紀錄起點（缺首次提交時間）" if first_est else "首次提交",
                    "detail": "",
                    "who": display_name(doc.get("submitter")),
                    "round": None,
                    "secondary": False,
                }
            )

    rounds = sorted(doc.get("rounds") or [], key=lambda r: (r.get("round") is None, r.get("round") or 0))
    for r in rounds:
        rn = r.get("round")
        sub_raw = r.get("submission_date") or ""
        reply_raw = r.get("reply_date") or ""
        resub_raw = r.get("resub_date") or ""
        reply_dates = r.get("reply_dates") or ([] if not reply_raw else [reply_raw])

        if sub_raw:
            # skip duplicate of first_submit node with same timestamp
            sub_dt = parse_dt(sub_raw)
            nodes.append(
                {
                    "t": sub_raw,
                    "ts": sub_dt.timestamp() if sub_dt else None,
                    "kind": "submission",
                    "role": "edu",
                    "label": f"R{rn} 提交",
                    "detail": r.get("submission_subject") or r.get("label") or "",
                    "who": display_name(r.get("submitter") or doc.get("submitter")),
                    "round": rn,
                    "secondary": False,
                }
            )

        annotations = parse_reply_annotations(r)
        seen = set()
        for rd in reply_dates:
            if not rd or rd in seen:
                continue
            seen.add(rd)
            rdt = parse_dt(rd)
            is_main = rd == reply_raw
            summary = ""
            if is_main:
                summary = r.get("reply_summary") or ""
            if not summary:
                summary = annotations.get(rd) or ""
            # fuzzy: annotation key may be date-only while rd has time
            if not summary:
                rd_day = rd[:10]
                for ak, av in annotations.items():
                    if ak.startswith(rd_day) or rd.startswith(ak[:10]):
                        summary = av
                        break
            if len(summary) > 160:
                summary = summary[:157] + "…"
            is_third = bool(summary and ("第三方" in summary or "甲方" in summary or "供應商" in summary))
            role = "third" if is_third else "admin"
            if is_third:
                label = f"R{rn} 第三方／甲方跟進" + ("" if is_main else "")
                kind = "third_party"
            else:
                label = f"R{rn} 行政回覆" + ("" if is_main else "（追加）")
                kind = "admin_reply"
            if summary and is_third:
                # Prefer the concrete event text as label suffix for clarity
                label = summary
            nodes.append(
                {
                    "t": rd,
                    "ts": rdt.timestamp() if rdt else None,
                    "kind": kind,
                    "role": role,
                    "label": label,
                    "detail": summary if not is_third else ("" if label == summary else summary),
                    "who": display_name(r.get("replier") or ("第三方" if is_third else "行政部")),
                    "round": rn,
                    "secondary": False,
                }
            )

        if resub_raw:
            # resub often equals next round submission; still record if distinct
            rdt = parse_dt(resub_raw)
            nodes.append(
                {
                    "t": resub_raw,
                    "ts": rdt.timestamp() if rdt else None,
                    "kind": "resubmission",
                    "role": "edu",
                    "label": f"R{rn} 重交",
                    "detail": "",
                    "who": display_name(r.get("submitter") or doc.get("submitter")),
                    "round": rn,
                    "secondary": False,
                }
            )

    # Progress inquiry markers (secondary)
    for p in progress:
        if not p.get("linked"):
            continue
        if p.get("pa") != doc.get("key"):
            continue
        raw = p.get("inquiry_date") or p.get("date") or ""
        pdt = parse_dt(raw)
        nodes.append(
            {
                "t": raw,
                "ts": pdt.timestamp() if pdt else None,
                "kind": "progress_inquiry",
                "role": "edu",
                "label": "進度查詢",
                "detail": (p.get("subject") or p.get("summary") or "")[:120],
                "who": display_name(p.get("from")),
                "round": None,
                "secondary": True,
                "closed": bool(p.get("closed")),
            }
        )

    # Completed docs: append a terminal 「完成」 node if we have an end time
    # that is not already the last primary-ish event.
    if closed:
        end_raw = (
            (doc.get("last_resubmit") or "").strip()
            or (doc.get("last_reply") or "").strip()
            or ""
        )
        # Prefer latest among last_reply / last_resubmit / latest round dates
        end_candidates: list[tuple[float, str]] = []
        for raw in (
            doc.get("last_reply"),
            doc.get("last_resubmit"),
            end_raw,
        ):
            if not raw:
                continue
            edt = parse_dt(raw)
            if edt:
                end_candidates.append((edt.timestamp(), raw))
        for r in doc.get("rounds") or []:
            for key in ("resub_date", "reply_date", "submission_date"):
                raw = r.get(key) or ""
                if not raw:
                    continue
                edt = parse_dt(raw)
                if edt:
                    end_candidates.append((edt.timestamp(), raw))
            for rd in r.get("reply_dates") or []:
                if not rd:
                    continue
                edt = parse_dt(rd)
                if edt:
                    end_candidates.append((edt.timestamp(), rd))
        if end_candidates:
            end_candidates.sort(key=lambda x: x[0])
            end_ts, end_t = end_candidates[-1]
            # Only add explicit 完成 marker if no existing node at that instant
            # with a substantive kind (submission/admin_reply/third/resub)
            has_at_end = any(
                n.get("ts") is not None
                and abs(n["ts"] - end_ts) < 1
                and n.get("kind")
                in ("submission", "resubmission", "admin_reply", "third_party", "completed")
                for n in nodes
            )
            if not has_at_end:
                nodes.append(
                    {
                        "t": end_t,
                        "ts": end_ts,
                        "kind": "completed",
                        "role": "edu",
                        "label": "完成",
                        "detail": "",
                        "who": "",
                        "round": None,
                        "secondary": False,
                    }
                )
            else:
                # Tag an existing end node? Prefer adding label only when last
                # node isn't already clearly terminal — leave as-is; closed
                # gaps handle the rest.
                pass

    # Deduplicate nodes: same ts+kind+label keep one; prefer non-first_submit over duplicate submission
    def dedupe(nodes_in: list[dict]) -> list[dict]:
        kind_rank = {
            "first_submit": 0,
            "submission": 1,
            "resubmission": 2,
            "admin_reply": 3,
            "third_party": 3,
            "completed": 5,
            "progress_inquiry": 4,
        }
        # Sort first
        def sk(n):
            kr = kind_rank.get(n.get("kind") or "", 9)
            if n.get("ts") is not None:
                return (0, n["ts"], 0 if not n.get("secondary") else 1, kr, n.get("label") or "")
            return (1, 0, 1, kr, n.get("t") or "")

        nodes_in = sorted(nodes_in, key=sk)
        out = []
        seen_keys = set()
        for n in nodes_in:
            key = (n.get("ts"), n.get("t"), n.get("kind"), n.get("label"))
            # Also collapse first_submit that matches a later submission with same t
            if n.get("kind") == "first_submit":
                # keep for now; remove if identical t submission exists
                pass
            if key in seen_keys:
                continue
            seen_keys.add(key)
            out.append(n)
        # Remove first_submit if any submission/resub with same t exists
        times_sub = {
            (n.get("ts"), n.get("t"))
            for n in out
            if n.get("kind") in ("submission", "resubmission")
        }
        cleaned = []
        for n in out:
            if n.get("kind") == "first_submit" and (n.get("ts"), n.get("t")) in times_sub:
                continue
            cleaned.append(n)
        # Collapse identical t+role consecutive resubmission+submission
        final = []
        for n in cleaned:
            if final:
                prev = final[-1]
                if (
                    prev.get("ts") == n.get("ts")
                    and prev.get("t") == n.get("t")
                    and prev.get("role") == n.get("role")
                    and {prev.get("kind"), n.get("kind")} <= {"submission", "resubmission"}
                ):
                    # keep submission label if available
                    if n.get("kind") == "submission":
                        final[-1] = n
                    continue
            final.append(n)
        return final

    nodes = dedupe(nodes)

    # Build gaps between primary (non-secondary) nodes; progress stays as markers only
    primary = [n for n in nodes if not n.get("secondary")]
    gaps: list[dict] = []
    today_str = today_dt.strftime("%Y-%m-%d %H:%M")

    for i, cur in enumerate(primary):
        nxt = primary[i + 1] if i + 1 < len(primary) else None
        start_dt = parse_dt(cur.get("t"))
        if nxt is None:
            if closed:
                # Completed: no open-to-today gap; timeline ends at last event
                continue
            # open gap to today for incomplete docs
            end_dt = today_dt
            end_t = today_str
            open_end = True
            role = gap_role_between(cur, None, status, True)
            days = days_between(start_dt, end_dt)
            gaps.append(
                {
                    "from_t": cur.get("t"),
                    "to_t": end_t,
                    "from_ts": cur.get("ts"),
                    "to_ts": end_dt.timestamp(),
                    "days": days,
                    "role": role,  # admin | edu | third
                    "open": True,
                    "label": f"至今 {days if days is not None else '—'} 天",
                }
            )
        else:
            end_dt = parse_dt(nxt.get("t"))
            role = gap_role_between(cur, nxt, status, False)
            days = days_between(start_dt, end_dt)
            # Skip zero-length gaps (same instant)
            same_ts = (
                cur.get("ts") is not None
                and nxt.get("ts") is not None
                and abs(cur["ts"] - nxt["ts"]) < 1
            )
            if same_ts or (cur.get("t") and cur.get("t") == nxt.get("t") and (days or 0) == 0):
                continue
            gaps.append(
                {
                    "from_t": cur.get("t"),
                    "to_t": nxt.get("t"),
                    "from_ts": cur.get("ts"),
                    "to_ts": nxt.get("ts"),
                    "days": days,
                    "role": role,
                    "open": False,
                    "label": f"{days if days is not None else '—'} 天",
                }
            )

    times = [n["ts"] for n in nodes if n.get("ts") is not None]
    for g in gaps:
        if g.get("from_ts") is not None:
            times.append(g["from_ts"])
        if g.get("to_ts") is not None:
            times.append(g["to_ts"])
    span = {"min_ts": min(times), "max_ts": max(times)} if times else None

    return {"nodes": nodes, "gaps": gaps, "span": span}



def compute_time_share(gaps: list[dict] | None) -> dict:
    """Sum gap days by role (admin/edu/third); pcts sum to 100 when total > 0."""
    admin_days = 0.0
    edu_days = 0.0
    third_days = 0.0
    for g in gaps or []:
        raw = g.get("days")
        if raw is None or raw == "":
            continue
        try:
            d = float(raw)
        except (TypeError, ValueError):
            continue
        if d < 0:
            d = 0.0
        role = g.get("role") or ""
        if role == "admin":
            admin_days += d
        elif role == "edu":
            edu_days += d
        elif role == "third":
            third_days += d
    total = admin_days + edu_days + third_days

    def pct(part: float) -> float:
        if total <= 0:
            return 0.0
        return round(100.0 * part / total, 1)

    ap, ep, tp = pct(admin_days), pct(edu_days), pct(third_days)
    if total > 0:
        diff = round(100.0 - (ap + ep + tp), 1)
        if abs(diff) >= 0.05:
            # Nudge the largest share so percentages total 100
            parts = [("admin", ap), ("edu", ep), ("third", tp)]
            parts.sort(key=lambda x: -x[1])
            key = parts[0][0]
            if key == "admin":
                ap = round(ap + diff, 1)
            elif key == "edu":
                ep = round(ep + diff, 1)
            else:
                tp = round(tp + diff, 1)

    return {
        "admin_days": round(admin_days, 1),
        "edu_days": round(edu_days, 1),
        "third_days": round(third_days, 1),
        "total_days": round(total, 1),
        "admin_pct": ap if total > 0 else 0.0,
        "edu_pct": ep if total > 0 else 0.0,
        "third_pct": tp if total > 0 else 0.0,
    }


def pa_sort_key(doc_id: str | None):
    """Sort PA ids numerically; missing ids last."""
    s = (doc_id or "").strip()
    if not s:
        return (2, 0, 0, 0, "")
    m = re.match(r"^PA-(\d+)-(\d+)(?:\((\d+)\))?", s, re.I)
    if m:
        return (0, int(m.group(1)), int(m.group(2)), int(m.group(3) or 0), s.upper())
    return (1, 0, 0, 0, s.upper())


def half_hour_bucket(dt: datetime) -> int:
    """0..47 index for 00:00, 00:30, ..."""
    return dt.hour * 2 + (1 if dt.minute >= 30 else 0)


def bucket_label(i: int) -> str:
    h = i // 2
    m = 30 if i % 2 else 0
    return f"{h:02d}:{m:02d}"


def analyze_admin_bursts(email_events: list[dict], near_sec: int = 60) -> str:
    """List chains of ≥2 emails with adjacent gaps ≤ near_sec (1 minute). No analysis prose."""
    rows = [e for e in email_events if e.get("ts") is not None]
    rows.sort(key=lambda e: e["ts"])
    lines = ["【連續寄出情況】"]
    # clusters: adjacent gaps ≤ near_sec, group size ≥ 2
    clusters = []
    i = 0
    while i < len(rows):
        j = i + 1
        while j < len(rows) and rows[j]["ts"] - rows[j - 1]["ts"] <= near_sec:
            j += 1
        if j - i >= 2:
            clusters.append(rows[i:j])
            i = j
        else:
            i += 1
    if not clusters:
        lines.append("無。")
    else:
        for c in clusters:
            span = c[-1]["ts"] - c[0]["ts"]
            lines.append(
                f"· {c[0].get('t')}–{c[-1].get('t')}（{len(c)} 封，跨 {span:.0f}s）："
                + "；".join(
                    f"{(e.get('pa') or '—')}「{(e.get('subject') or '')[:28]}」" for e in c[:4]
                )
                + ("…" if len(c) > 4 else "")
            )
    return "\n".join(lines)


def build_email_stats(email_events: list[dict]) -> dict:
    total = len(email_events)
    on_n = sum(1 for e in email_events if e.get("off_hours") is False)
    off_n = sum(1 for e in email_events if e.get("off_hours") is True)
    unk = total - on_n - off_n

    admin = [e for e in email_events if e.get("role") == "admin"]
    edu = [e for e in email_events if e.get("role") == "edu"]

    def on_off(rows):
        on = sum(1 for e in rows if e.get("off_hours") is False)
        off = sum(1 for e in rows if e.get("off_hours") is True)
        return {"on": on, "off": off, "total": len(rows)}

    by_stage = {}
    for e in admin:
        st = STAGE_LABEL_ZH.get(e.get("stage") or "", e.get("stage") or "未分類")
        if e.get("stage") == "不適用（無編號）":
            st = "無編號"
        elif not e.get("stage"):
            st = "未分類"
        else:
            st = e.get("stage")
        by_stage.setdefault(st, {"on": 0, "off": 0, "total": 0})
        by_stage[st]["total"] += 1
        if e.get("off_hours") is True:
            by_stage[st]["off"] += 1
        elif e.get("off_hours") is False:
            by_stage[st]["on"] += 1

    by_kind = {}
    for e in admin:
        k = e.get("kind") or "other"
        label = KIND_LABEL_ZH.get(k, k)
        by_kind.setdefault(label, {"on": 0, "off": 0, "total": 0, "kind": k})
        by_kind[label]["total"] += 1
        if e.get("off_hours") is True:
            by_kind[label]["off"] += 1
        elif e.get("off_hours") is False:
            by_kind[label]["on"] += 1

    # Half-hour buckets for ALL emails, stacked by stage (or kind if no stage)
    buckets = []
    for i in range(48):
        buckets.append({"i": i, "label": bucket_label(i), "total": 0, "by_type": {}})

    type_keys = set()
    for e in email_events:
        ts = e.get("ts")
        if ts is None:
            continue
        dt = datetime.fromtimestamp(ts, TZ)
        bi = half_hour_bucket(dt)
        st = e.get("stage") or ""
        if st == "不適用（無編號）":
            typ = "無編號"
        elif st:
            typ = st
        else:
            typ = KIND_LABEL_ZH.get(e.get("kind") or "", e.get("kind") or "其他")
        type_keys.add(typ)
        buckets[bi]["total"] += 1
        buckets[bi]["by_type"][typ] = buckets[bi]["by_type"].get(typ, 0) + 1

    # Peak half-hour
    peak = max(buckets, key=lambda b: b["total"]) if buckets else None

    # Analysis text (繁中, no 快/慢)
    def pct(n, d):
        return round(100.0 * n / d, 1) if d else 0.0

    lines = []
    lines.append(
        f"共收錄 {total} 封相關電郵。"
        f"辦公時間定義為平日 09:00–18:30（Asia/Macau）；平日此時段以外及週末計入非辦公時間。"
    )
    if total:
        lines.append(
            f"整體：辦公時間 {on_n} 封（{pct(on_n, total)}%）、"
            f"非辦公時間 {off_n} 封（{pct(off_n, total)}%）"
            + (f"、未能判定 {unk} 封。" if unk else "。")
        )
    if by_stage:
        parts = []
        for st, v in sorted(by_stage.items(), key=lambda x: -x[1]["total"]):
            parts.append(
                f"{st} {v['total']} 封（辦公時間 {pct(v['on'], v['total'])}%／非辦公時間 {pct(v['off'], v['total'])}%）"
            )
        if parts:
            lines.append("按文件類型：" + "；".join(parts) + "。")
    if peak and peak["total"]:
        lines.append(
            f"半小時時段高峰：{peak['label']} 起共 {peak['total']} 封。"
        )

    return {
        "total": total,
        "on_hours": on_n,
        "off_hours": off_n,
        "unknown": unk,
        "admin": on_off(admin),
        "edu": on_off(edu),
        "by_stage": by_stage,
        "by_kind": by_kind,
        "half_hour": buckets,
        "type_keys": sorted(type_keys),
        "peak": {"label": peak["label"], "total": peak["total"]} if peak else None,
        "analysis": "\n".join(lines),
        "work_hours": "09:00–18:30",
        "off_hours_def": "18:31–08:59（平日）及週末",
    }


def main() -> None:
    ds = json.loads((PROCURE / "dataset.json").read_text(encoding="utf-8"))
    generated_at = ds.get("generated_at") or ""
    today = ds.get("today") or datetime.now(TZ).strftime("%Y-%m-%d")
    today_dt = datetime.now(TZ)
    today_d = today_dt.date()

    docs_all = ds.get("documents") or []
    incomplete = [d for d in docs_all if (d.get("status") or "") != "完成"]
    completed = [d for d in docs_all if (d.get("status") or "") == "完成"]
    progress = ds.get("progress_inquiries") or []
    emails = ds.get("emails") or []

    def doc_sort(d):
        status = d.get("status") or ""
        try:
            si = STATUS_ORDER.index(status)
        except ValueError:
            si = 99
        # within status: longer days_in_status first
        return (si, d.get("key") or "")

    incomplete_sorted = sorted(incomplete, key=doc_sort)

    def build_doc_viz(d: dict, *, closed: bool = False) -> dict:
        fu = d.get("follow_up") or []
        first, _est = resolve_first_submit(d)
        anchor = status_anchor_date(d)
        completed_at = resolve_completed_at(d) if closed else ""
        dis = days_since(anchor, today_d)
        dsfs = days_since(first, today_d)
        # Process span for completed: first_submit → completed_at
        process_days = None
        if closed and first and completed_at:
            process_days = days_between(parse_dt(first), parse_dt(completed_at))
            if process_days is not None:
                process_days = int(process_days) if float(process_days).is_integer() else process_days
        timeline = build_timeline(d, progress, today_dt, closed=closed)
        time_share = compute_time_share(timeline.get("gaps") or [])
        # Completed: prefer first→completed_at; else gaps total / timeline span
        if closed and process_days is None:
            if time_share.get("total_days"):
                process_days = time_share["total_days"]
            else:
                span = timeline.get("span") or {}
                if span.get("min_ts") is not None and span.get("max_ts") is not None:
                    process_days = round(
                        max(0.0, (span["max_ts"] - span["min_ts"]) / 86400.0), 1
                    )
            if process_days is not None and float(process_days).is_integer():
                process_days = int(process_days)
        return {
            "id": d.get("key") or d.get("doc_id"),
            "stage": d.get("stage") or "",
            "title": d.get("title") or "",
            "status": d.get("status") or "",
            "status_group": (
                "completed" if closed else STATUS_GROUP.get(d.get("status") or "", "other")
            ),
            "attr_label": attr_label(d),
            "submitter": display_name(d.get("submitter")),
            "follow_up": [display_name(x) for x in fu]
            if isinstance(fu, list)
            else [display_name(fu)],
            "first_submit": first,
            "status_since": anchor,
            "completed_at": completed_at if closed else "",
            "days_in_status": dis,
            "days_since_first_submit": dsfs,
            "process_days": process_days,
            "current_round": d.get("current_round"),
            "last_reply": d.get("last_reply") or "",
            "last_reply_summary": (d.get("last_reply_summary") or "")[:240],
            "last_resubmit": d.get("last_resubmit") or "",
            "admin_clock_from": d.get("admin_clock_from") or "",
            "days_since_reply": d.get("days_since_reply"),
            "n_rounds": d.get("n_rounds"),
            "admin_total": d.get("admin_total"),
            "colleague_total": d.get("colleague_total"),
            "time_share": time_share,
            "timeline": timeline,
        }

    viz_docs = [build_doc_viz(d, closed=False) for d in incomplete_sorted]

    # Re-sort within each status by days_in_status desc
    viz_docs.sort(
        key=lambda d: (
            STATUS_ORDER.index(d["status"])
            if d["status"] in STATUS_ORDER
            else 99,
            -(d.get("days_in_status") if d.get("days_in_status") is not None else -1),
            d.get("id") or "",
        )
    )

    # Completed: newest completion first; then longer process span
    viz_completed = [build_doc_viz(d, closed=True) for d in completed]

    def completed_sort_key(d):
        ca = parse_dt(d.get("completed_at") or "")
        return (
            -(ca.timestamp() if ca else 0),
            -(d.get("process_days") if d.get("process_days") is not None else -1),
            d.get("id") or "",
        )

    viz_completed.sort(key=completed_sort_key)

    email_events = []
    for e in emails:
        raw = e.get("date") or ""
        dt = parse_dt(e.get("date_iso") or raw)
        off = is_off_hours(dt)
        role = role_of_email(e)
        # Display time to the second when available
        if dt:
            t_disp = dt.strftime("%Y-%m-%d %H:%M:%S")
        else:
            t_disp = raw
        email_events.append(
            {
                "t": t_disp,
                "ts": dt.timestamp() if dt else None,
                "iso": e.get("date_iso") or "",
                "role": role,
                "folder": e.get("folder") or "",
                "kind": e.get("kind") or "",
                "kind_label": KIND_LABEL_ZH.get(e.get("kind") or "", e.get("kind") or ""),
                "pa": e.get("pa") or "",
                "stage": e.get("stage") or "",
                "subject": (e.get("subject") or "")[:160],
                "from": display_name(e.get("from_name") or e.get("from_addr")),
                "from_addr": e.get("from_addr") or "",
                "off_hours": off,
                "weekday": dt.weekday() if dt else None,
            }
        )
    email_events.sort(key=lambda x: (x["ts"] is None, -(x["ts"] or 0)))

    # Oscar 2026-10-27: email tab / stats = 行政部 only (no EDU)
    email_events = [e for e in email_events if e.get("role") == "admin"]

    email_stats = build_email_stats(email_events)
    # Attach burst / near-simultaneous send notes
    email_stats["analysis"] = (
        email_stats.get("analysis") or ""
    ).rstrip() + "\n" + analyze_admin_bursts(email_events)

    progress_slim = []
    inc_keys = {d["id"] for d in viz_docs}
    for p in progress:
        if not p.get("linked") or p.get("pa") not in inc_keys:
            continue
        progress_slim.append(
            {
                "pa": p.get("pa"),
                "t": p.get("inquiry_date") or p.get("date"),
                "from": display_name(p.get("from")),
                "subject": (p.get("subject") or "")[:120],
                "closed": bool(p.get("closed")),
                "days": p.get("days"),
            }
        )

    status_counts = {s: 0 for s in STATUS_ORDER}
    for d in viz_docs:
        st = d["status"]
        if st in status_counts:
            status_counts[st] += 1
        else:
            status_counts[st] = status_counts.get(st, 0) + 1

    submitters = sorted(
        {
            (d.get("submitter") or "").strip()
            for d in (viz_docs + viz_completed)
            if (d.get("submitter") or "").strip()
        },
        key=lambda s: s.casefold(),
    )

    viz = {
        "meta": {
            "title": "教育部工作文件進程（不包括HR）",
            "subtitle": "",
            "generated_at": today_dt.strftime("%Y-%m-%d %H:%M"),
            "source_generated_at": generated_at,
            "today": today,
            "timezone": "Asia/Macau",
            "work_hours": "09:00–18:30",
            "incomplete_count": len(viz_docs),
            "completed_count": len(viz_completed),
            "overview_count": len(viz_docs) + len(viz_completed),
            "email_count": len(email_events),
            "email_on_hours": email_stats["on_hours"],
            "email_off_hours": email_stats["off_hours"],
            "progress_linked_count": len(progress_slim),
            "status_order": STATUS_ORDER,
            "status_counts": status_counts,
            "submitters": submitters,
            "notes": [
                "未完成＝目前狀態唔係「完成」；已完成見「已完成文件流程時間記錄」；總覽＝全部文件",
                "時間線由首次提交／紀錄起點起；節點之間色塊＝間隔天數（紅＝行政部、綠＝EDU、藍＝第三方）",
                "時間比例＝各角色間隔天數佔比（行政部／EDU／第三方；未完成含至今 open gap）",
                "已完成案時間線喺最後事件收束，唔再延伸至今日；文件總天數＝首次／起點→完成",
                "辦公時間＝平日 09:00–18:30 Asia/Macau；其餘平日時段及週末＝非辦公時間",
            ],
        },
        "documents": viz_docs,
        "completed_documents": viz_completed,
        "emails": email_events,
        "email_stats": email_stats,
        "progress": progress_slim,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = DATA_DIR / "viz.json"
    out.write_text(json.dumps(viz, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size} bytes)")
    print(
        f"incomplete={len(viz_docs)} completed={len(viz_completed)} "
        f"emails={len(email_events)} off={email_stats['off_hours']} status={status_counts}"
    )


if __name__ == "__main__":
    main()
