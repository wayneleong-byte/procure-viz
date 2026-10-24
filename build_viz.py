#!/usr/bin/env python3
"""Build slim viz.json + static dashboard for 採購文件可視化.

Read-only on /workspace/procure/{dataset,sheet_rows}.json.
Writes /workspace/procure-viz/data/viz.json (and optionally refreshes nothing else).
Timezone: Asia/Macau. No secrets written.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PROCURE = Path("/workspace/procure")
OUT_DIR = Path("/workspace/procure-viz")
DATA_DIR = OUT_DIR / "data"
TZ = ZoneInfo("Asia/Macau")

# Work hours Asia/Macau: 09:00–18:30 inclusive
WORK_START = 9 * 60
WORK_END = 18 * 60 + 30

ADMIN_FOLDERS = {"04 Procure"}
EDU_FOLDERS = {"000[提交至行政採購文件]", "000 文件進度查詢"}
ADMIN_ADDR_HINT = re.compile(r"procure@|admin@", re.I)

STATUS_GROUP = {
    "行政部已回覆待同事重交": "pending_resubmit",
    "已提交待回覆": "awaiting_admin",
    "報價進行中": "quotation",
    "待對方補充資料後交行政": "followup",
    "行政部與甲方跟進中": "followup",
}


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    s = str(s).strip()
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ):
        try:
            if fmt.endswith("%z") and s.endswith("+08:00"):
                s2 = s
            elif "T" in s and "+" in s[10:]:
                # normalize +08:00
                dt = datetime.fromisoformat(s)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=TZ)
                else:
                    dt = dt.astimezone(TZ)
                return dt
            dt = datetime.strptime(s[: len(fmt) + 8] if "T" in fmt else s[:19], fmt.replace("%z", ""))
            return dt.replace(tzinfo=TZ)
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=TZ)
        else:
            dt = dt.astimezone(TZ)
        return dt
    except Exception:
        return None


def fmt_dt(dt: datetime | None, date_only_hint: str | None = None) -> str:
    if dt is None:
        return date_only_hint or ""
    if dt.hour == 0 and dt.minute == 0 and date_only_hint and " " not in (date_only_hint or ""):
        return dt.strftime("%Y-%m-%d")
    if dt.hour == 0 and dt.minute == 0 and (not date_only_hint or " " not in str(date_only_hint)):
        # keep as date if original lacked time
        return dt.strftime("%Y-%m-%d")
    return dt.strftime("%Y-%m-%d %H:%M")


def is_off_hours(dt: datetime | None) -> bool | None:
    if dt is None:
        return None
    mins = dt.hour * 60 + dt.minute
    # weekends always off-hours for badge purposes? Spec says 09:00–18:30 = normal; mark non-work clearly.
    # Also treat Sat/Sun as off-hours.
    if dt.weekday() >= 5:
        return True
    return not (WORK_START <= mins <= WORK_END)


def display_name(person) -> str:
    if not person:
        return ""
    if isinstance(person, list):
        return ", ".join(display_name(p) for p in person if p)
    s = str(person)
    # "Name <email>" → Name
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


def build_timeline(doc: dict, progress: list[dict]) -> list[dict]:
    """Build ordered timeline events + colored segments for one document."""
    events: list[dict] = []
    segments: list[dict] = []

    rounds = doc.get("rounds") or []
    for r in rounds:
        rn = r.get("round")
        sub_raw = r.get("submission_date") or ""
        reply_raw = r.get("reply_date") or ""
        resub_raw = r.get("resub_date") or ""
        # Extra admin reply dates on same round
        reply_dates = r.get("reply_dates") or ([] if not reply_raw else [reply_raw])

        sub_dt = parse_dt(sub_raw)
        if sub_raw:
            events.append(
                {
                    "t": sub_raw,
                    "ts": sub_dt.timestamp() if sub_dt else None,
                    "kind": "submission",
                    "role": "edu",
                    "label": f"R{rn} 提交",
                    "detail": r.get("submission_subject") or r.get("label") or "",
                    "who": display_name(r.get("submitter") or doc.get("submitter")),
                    "round": rn,
                }
            )

        # All admin replies in this round
        seen = set()
        for rd in reply_dates:
            if not rd or rd in seen:
                continue
            seen.add(rd)
            rdt = parse_dt(rd)
            is_main = rd == reply_raw
            events.append(
                {
                    "t": rd,
                    "ts": rdt.timestamp() if rdt else None,
                    "kind": "admin_reply",
                    "role": "admin",
                    "label": f"R{rn} 行政回覆" + ("" if is_main else "（追加）"),
                    "detail": (r.get("reply_summary") or "") if is_main else "",
                    "who": display_name(r.get("replier") or "行政部"),
                    "round": rn,
                }
            )

        # Segment: admin processing = submission → first reply
        if sub_raw and reply_raw:
            segments.append(
                {
                    "role": "admin",
                    "start": sub_raw,
                    "end": reply_raw,
                    "days": r.get("admin_days") or None,
                    "round": rn,
                    "label": f"R{rn} 行政部處理",
                }
            )
        # Segment: EDU processing = reply answered → resubmit
        ans = r.get("answers_reply_date") or reply_raw
        # For this round's resub: the resub closes this round's open reply
        if resub_raw and (ans or reply_raw):
            start = ans or reply_raw
            segments.append(
                {
                    "role": "edu",
                    "start": start,
                    "end": resub_raw,
                    "days": r.get("resub_days") or None,
                    "round": rn,
                    "label": f"R{rn} EDU 重交",
                }
            )

    # Open ball segment to "today"
    status = doc.get("status") or ""
    last_reply = doc.get("last_reply") or ""
    last_resub = doc.get("last_resubmit") or ""
    first = doc.get("first_submit") or ""
    today = datetime.now(TZ).strftime("%Y-%m-%d")

    if status == "行政部已回覆待同事重交" and last_reply:
        # open EDU segment
        segments.append(
            {
                "role": "edu",
                "start": last_reply,
                "end": today,
                "days": doc.get("days_since_reply"),
                "round": doc.get("current_round"),
                "label": "進行中：待 EDU 重交",
                "open": True,
            }
        )
    elif status == "已提交待回覆":
        start = last_resub or first
        if start:
            segments.append(
                {
                    "role": "admin",
                    "start": start,
                    "end": today,
                    "days": None,
                    "round": doc.get("current_round"),
                    "label": "進行中：待行政回覆",
                    "open": True,
                }
            )
    elif status in ("報價進行中", "行政部與甲方跟進中", "待對方補充資料後交行政"):
        start = last_reply or last_resub or first
        if start:
            segments.append(
                {
                    "role": "admin",
                    "start": start,
                    "end": today,
                    "days": None,
                    "round": doc.get("current_round"),
                    "label": f"進行中：{status}",
                    "open": True,
                }
            )

    # Progress inquiry markers linked to this PA
    for p in progress:
        if not p.get("linked"):
            continue
        if p.get("pa") != doc.get("key"):
            continue
        raw = p.get("inquiry_date") or p.get("date") or ""
        pdt = parse_dt(raw)
        events.append(
            {
                "t": raw,
                "ts": pdt.timestamp() if pdt else None,
                "kind": "progress_inquiry",
                "role": "edu",
                "label": "進度查詢",
                "detail": p.get("subject") or p.get("summary") or "",
                "who": display_name(p.get("from")),
                "closed": bool(p.get("closed")),
            }
        )

    # Sort events
    def sort_key(ev):
        if ev.get("ts") is not None:
            return (0, ev["ts"])
        return (1, ev.get("t") or "")

    events.sort(key=sort_key)

    # Compute span
    times = []
    for ev in events:
        if ev.get("ts") is not None:
            times.append(ev["ts"])
    for seg in segments:
        for k in ("start", "end"):
            dt = parse_dt(seg.get(k))
            if dt:
                times.append(dt.timestamp())

    span = None
    if times:
        span = {"min_ts": min(times), "max_ts": max(times)}

    return {"events": events, "segments": segments, "span": span}


def main() -> None:
    ds = json.loads((PROCURE / "dataset.json").read_text(encoding="utf-8"))
    # sheet_rows available but dataset is richer for rounds/emails
    generated_at = ds.get("generated_at") or ""
    today = ds.get("today") or datetime.now(TZ).strftime("%Y-%m-%d")

    docs_all = ds.get("documents") or []
    incomplete = [d for d in docs_all if (d.get("status") or "") != "完成"]
    progress = ds.get("progress_inquiries") or []
    emails = ds.get("emails") or []

    # Sort incomplete: pending_resubmit first, then awaiting, then quotation/followup
    order = {"pending_resubmit": 0, "awaiting_admin": 1, "quotation": 2, "followup": 3}

    def doc_sort(d):
        g = STATUS_GROUP.get(d.get("status") or "", 9)
        reply = d.get("last_reply") or ""
        return (order.get(g, 9), reply or "9999")

    incomplete_sorted = sorted(incomplete, key=doc_sort)

    viz_docs = []
    for d in incomplete_sorted:
        fu = d.get("follow_up") or []
        timeline = build_timeline(d, progress)
        viz_docs.append(
            {
                "id": d.get("key") or d.get("doc_id"),
                "stage": d.get("stage") or "",
                "title": d.get("title") or "",
                "status": d.get("status") or "",
                "status_group": STATUS_GROUP.get(d.get("status") or "", "other"),
                "submitter": display_name(d.get("submitter")),
                "follow_up": [display_name(x) for x in fu] if isinstance(fu, list) else [display_name(fu)],
                "first_submit": d.get("first_submit") or "",
                "current_round": d.get("current_round"),
                "last_reply": d.get("last_reply") or "",
                "last_reply_summary": (d.get("last_reply_summary") or "")[:240],
                "last_resubmit": d.get("last_resubmit") or "",
                "days_since_reply": d.get("days_since_reply"),
                "n_rounds": d.get("n_rounds"),
                "admin_total": d.get("admin_total"),
                "colleague_total": d.get("colleague_total"),
                "timeline": timeline,
            }
        )

    # Email events for TAG 2 — slim, no bodies
    email_events = []
    for e in emails:
        raw = e.get("date") or ""
        dt = parse_dt(e.get("date_iso") or raw)
        off = is_off_hours(dt)
        role = role_of_email(e)
        folder = e.get("folder") or ""
        # Skip ancient progress noise? Keep all but flag year
        email_events.append(
            {
                "t": raw,
                "ts": dt.timestamp() if dt else None,
                "iso": e.get("date_iso") or "",
                "role": role,  # admin | edu
                "folder": folder,
                "kind": e.get("kind") or "",
                "pa": e.get("pa") or "",
                "stage": e.get("stage") or "",
                "subject": (e.get("subject") or "")[:160],
                "from": display_name(e.get("from_name") or e.get("from_addr")),
                "from_addr": e.get("from_addr") or "",
                "off_hours": off,
                "weekday": dt.weekday() if dt else None,
            }
        )

    email_events.sort(key=lambda x: (x["ts"] is None, x["ts"] or 0), reverse=True)

    # Progress slim for reference
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

    # Status counts
    status_counts = {}
    for d in viz_docs:
        status_counts[d["status"]] = status_counts.get(d["status"], 0) + 1

    off_n = sum(1 for e in email_events if e.get("off_hours") is True)
    on_n = sum(1 for e in email_events if e.get("off_hours") is False)

    viz = {
        "meta": {
            "title": "採購文件可視化",
            "generated_at": datetime.now(TZ).strftime("%Y-%m-%d %H:%M"),
            "source_generated_at": generated_at,
            "today": today,
            "timezone": "Asia/Macau",
            "work_hours": "09:00–18:30",
            "incomplete_count": len(viz_docs),
            "email_count": len(email_events),
            "email_on_hours": on_n,
            "email_off_hours": off_n,
            "progress_linked_count": len(progress_slim),
            "completed_hidden": sum(1 for d in docs_all if d.get("status") == "完成"),
            "status_counts": status_counts,
            "notes": [
                "未完成＝目前狀態唔係「完成」",
                "時間線：行政部處理段（提交→行政回覆）vs EDU 處理段（行政回覆→重交／進行中）",
                "進度查詢標記來自 dataset progress_inquiries（已配對到該 PA）",
                "非上班時間＝平日 09:00–18:30 以外，或週末",
            ],
        },
        "documents": viz_docs,
        "emails": email_events,
        "progress": progress_slim,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = DATA_DIR / "viz.json"
    out.write_text(json.dumps(viz, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size} bytes)")
    print(f"incomplete={len(viz_docs)} emails={len(email_events)} off_hours={off_n} progress_linked={len(progress_slim)}")


if __name__ == "__main__":
    main()
