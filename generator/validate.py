"""NightPulse 합성 데이터 검증기.

생성 직후 이벤트 로그와 원장이 서로 맞는지 단언하고, 요약 통계를 `data/summary.md` 로 쓴다.
단언이 하나라도 어긋나면 exit 1.

실행:
    uv run generator/validate.py --data data/ --weeks 52 --end-date 2026-09-20
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import logging
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

logger = logging.getLogger("nightpulse.validate")

KST = timezone(timedelta(hours=9))
KEY_EVENTS = {"sign_up", "apply_event", "purchase", "share", "cancel_apply"}
DETAIL_SCREENS = {"venue_detail", "venue_review", "event_detail"}
APPLY_SCREENS = {"event_apply", "payment_confirm"}
ROW_RANGE = (7_000_000, 15_000_000)
AD_SESSION_PER_CLICK = (0.55, 0.95)
RET_OFFSETS = (1, 2, 4, 8, 12)
# 지표 일반 범위 (docs/architecture.md §6). 벗어나면 실패
RANGES = {
    "신규 방문자 W1 리텐션": (0.15, 0.30),
    "W4 리텐션": (0.08, 0.18),
    "방문 -> 가입 전환 (기간 누적 사람)": (0.06, 0.12),
    "회원 중 2기기 비율": (0.30, 0.40),
    "행사 상세 조회 -> 신청 (기간 누적 사람)": (0.03, 0.08),
    "신청 -> 결제 완료 (유료 행사)": (0.55, 0.75),
    "취소율 (신청 대비)": (0.05, 0.12),
    "광고 세션 비중 (집행일)": (0.10, 0.30),
    "자동 로드 세션 비중": (0.05, 0.10),
}
SEED_DIR = Path(__file__).resolve().parent / "seed"


@dataclass
class Sess:
    """세션 1개의 집계."""

    client: str
    date: str
    ts_min: int
    ts_max: int = 0
    screens: int = 0
    eng: int = 0
    key: bool = False
    users: set[str] = field(default_factory=set)
    medium: str = ""
    campaign: str = ""
    source: str = ""
    detail: bool = False
    event_detail: bool = False
    identified: bool = False
    apply_form: bool = False
    applied: bool = False
    engaged: bool = False


def _param(row: dict, key: str) -> str | int | None:
    for p in row["event_params"]:
        if p["key"] == key:
            return p["string_value"] if p["string_value"] is not None else p["int_value"]
    return None


def _read_csv(path: Path) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def validate(data: Path, weeks: int, end_date: date) -> tuple[list[tuple[str, bool, str]], str]:
    """단언을 실행하고 요약 마크다운을 만든다.

    Args:
        data: 데이터 루트(data/).
        weeks: 기대 기간(주).
        end_date: 기대 마지막 날(KST).

    Returns:
        (단언 결과 목록 [(이름, 통과 여부, 상세)], 요약 마크다운).
    """
    raw = data / "raw"
    sessions: dict[tuple[str, int], Sess] = {}
    names: Counter[str] = Counter()
    purchase_orders: dict[str, int] = {}
    apply_orders: dict[str, str | None] = {}
    cancel_orders: dict[str, int] = {}
    signups: set[str] = set()
    client_users: dict[str, set[str]] = defaultdict(set)
    dates: set[str] = set()
    n_rows = 0

    with gzip.open(raw / "ga4_events.ndjson.gz", "rt", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            n_rows += 1
            e = r["event_name"]
            names[e] += 1
            dates.add(r["event_date"])
            k = (r["user_pseudo_id"], r["ga_session_id"])
            s = sessions.get(k)
            if s is None:
                s = sessions[k] = Sess(r["user_pseudo_id"], r["event_date"], r["event_timestamp"])
                s.medium = r["traffic_source"]["medium"]
                s.campaign = r["traffic_source"]["campaign"]
                s.source = r["traffic_source"]["source"]
            s.ts_min = min(s.ts_min, r["event_timestamp"])
            s.ts_max = max(s.ts_max, r["event_timestamp"])
            s.eng += r["engagement_time_msec"]
            s.engaged = r["session_engaged"] == "1"
            if r["user_id"]:
                s.users.add(r["user_id"])
                client_users[r["user_pseudo_id"]].add(r["user_id"])
                s.identified = True
            if e in KEY_EVENTS:
                s.key = True
            if e == "screen_view":
                s.screens += 1
                sn = _param(r, "screen_name")
                s.detail |= sn in DETAIL_SCREENS
                s.event_detail |= sn == "event_detail"
                s.apply_form |= sn in APPLY_SCREENS
            elif e == "sign_up":
                s.identified = True
                signups.add(r["user_id"])
            elif e == "apply_event":
                s.applied = True
                apply_orders[str(_param(r, "order_id"))] = r["user_id"]
            elif e == "purchase":
                purchase_orders[str(_param(r, "order_id"))] = int(_param(r, "value") or 0)
            elif e == "cancel_apply":
                cancel_orders[str(_param(r, "order_id"))] = int(_param(r, "value") or 0)

    apps = _read_csv(raw / "db_applications.csv")
    pays = _read_csv(raw / "db_payments.csv")
    members = _read_csv(raw / "db_members.csv")
    events_master = _read_csv(raw / "db_events.csv")
    ads = _read_csv(raw / "ads_spend.csv")

    checks: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str) -> None:
        checks.append((name, ok, detail))

    check("결제 이벤트 수 = payments 행 수", names["purchase"] == len(pays), f"{names['purchase']} vs {len(pays)}")
    check(
        "결제 order_id 집합 일치", set(purchase_orders) == {p["order_id"] for p in pays}, f"{len(purchase_orders)} 건"
    )
    pay_sum = sum(int(p["amount"]) for p in pays)
    check(
        "결제 금액 합 일치",
        sum(purchase_orders.values()) == pay_sum,
        f"{sum(purchase_orders.values()):,} vs {pay_sum:,}",
    )
    check(
        "신청 이벤트 수 = applications 행 수",
        names["apply_event"] == len(apps),
        f"{names['apply_event']} vs {len(apps)}",
    )
    check(
        "신청 order_id·회원 일치",
        apply_orders == {a["order_id"]: a["member_id"] for a in apps},
        f"{len(apply_orders)} 건",
    )
    canceled = {a["order_id"]: int(a["cancel_amount"]) for a in apps if a["status"] == "canceled"}
    check(
        "취소 이벤트 = canceled 행, 금액 합 일치",
        cancel_orders == canceled,
        f"{len(cancel_orders)} 건, {sum(cancel_orders.values()):,} 원",
    )
    refunded = {p["order_id"] for p in pays if p["status"] == "refunded"}
    check("환불 결제 = 취소된 유료 신청", refunded == {o for o, v in canceled.items() if v > 0}, f"{len(refunded)} 건")
    check(
        "가입 이벤트 수 = members 행 수",
        len(signups) == names["sign_up"] == len(members),
        f"{names['sign_up']} vs {len(members)}",
    )
    event_ids = {e["event_id"] for e in events_master}
    check("신청 event_id 가 행사 원장에 존재", all(a["event_id"] in event_ids for a in apps), "")
    multi_sess = sum(1 for s in sessions.values() if len(s.users) > 1)
    check("세션 내 user_id 단일", multi_sess == 0, f"위반 세션 {multi_sess}")
    multi_client = sum(1 for u in client_users.values() if len(u) > 1)
    check("기기당 user_id 단일", multi_client == 0, f"위반 기기 {multi_client}")

    person_of = {c: next(iter(u)) for c, u in client_users.items()}
    clients = {s.client for s in sessions.values()}
    persons = {person_of.get(c, c) for c in clients}
    check("기기 수 > 사람 수", len(clients) > len(persons), f"기기 {len(clients):,} / 사람 {len(persons):,}")

    start_date = end_date - timedelta(days=weeks * 7 - 1)
    exp_dates = {(start_date + timedelta(days=i)).isoformat() for i in range(weeks * 7)}
    check(
        f"날짜 범위 {weeks}주 ({start_date} ~ {end_date})",
        dates == exp_dates,
        f"{min(dates)} ~ {max(dates)}, {len(dates)}일",
    )
    check(f"이벤트 행 수 {ROW_RANGE[0]:,}~{ROW_RANGE[1]:,}", ROW_RANGE[0] <= n_rows <= ROW_RANGE[1], f"{n_rows:,}")

    clicks: Counter[str] = Counter()
    for a in ads:
        clicks[a["campaign_id"]] += int(a["clicks"])
    ad_sess = Counter(s.campaign for s in sessions.values() if s.medium == "paid_social")
    lo, hi = AD_SESSION_PER_CLICK
    ratios = {c: ad_sess[c] / clicks[c] for c in sorted(clicks)}
    check(
        f"캠페인별 광고 세션 / 클릭 {lo}~{hi}",
        all(lo <= r <= hi for r in ratios.values()),
        ", ".join(f"{c} {ad_sess[c]}/{clicks[c]}={r:.2f}" for c, r in ratios.items()),
    )

    snap = {r["snapshot_date"] for rows in (apps, pays, members, events_master) for r in rows}
    check("RDB 스냅샷 snapshot_date = 종료일", snap == {end_date.isoformat()}, ", ".join(sorted(snap)))

    summary, ret = _summary(
        sessions, names, person_of, apps, pays, members, ads, start_date, weeks, n_rows, len(clients), len(persons)
    )
    seq = [ret[o] for o in RET_OFFSETS]
    check(
        "리텐션 감쇠 W1 > W2 > W4 > W8 > W12",
        all(a > b for a, b in zip(seq, seq[1:], strict=False)),
        " / ".join(f"W{o} {ret[o]:.3f}" for o in RET_OFFSETS),
    )

    visit = [s for s in sessions.values() if not _is_auto(s)]
    detail_persons = {person_of.get(s.client, s.client) for s in visit if s.event_detail}
    apply_persons = {person_of.get(s.client, s.client) for s in visit if s.applied}
    price = {e["event_id"]: int(e["price"]) for e in events_master}
    paid_apps = [a for a in apps if price[a["event_id"]] > 0]
    ad_days = {a["date"] for a in ads}
    ad_window = [s for s in visit if s.date in ad_days]
    values = {
        "신규 방문자 W1 리텐션": ret[1],
        "W4 리텐션": ret[4],
        "방문 -> 가입 전환 (기간 누적 사람)": len(members) / len(persons),
        "회원 중 2기기 비율": sum(1 for c in Counter(person_of.values()).values() if c > 1) / len(members),
        "행사 상세 조회 -> 신청 (기간 누적 사람)": len(apply_persons & detail_persons) / len(detail_persons),
        "신청 -> 결제 완료 (유료 행사)": sum(a["order_id"] in purchase_orders for a in paid_apps) / len(paid_apps),
        "취소율 (신청 대비)": sum(a["status"] == "canceled" for a in apps) / len(apps),
        "광고 세션 비중 (집행일)": sum(s.medium == "paid_social" for s in ad_window) / len(ad_window),
        "자동 로드 세션 비중": 1 - len(visit) / len(sessions),
    }
    for name, (lo, hi) in RANGES.items():
        v = values[name]
        check(f"범위 {name} {lo:.0%}~{hi:.0%}", lo <= v <= hi, f"{v:.3f}")
    return checks, summary


def _is_auto(s: Sess) -> bool:
    return s.eng == 0 and s.screens <= 1 and not s.key and (s.ts_max - s.ts_min) <= 2_000_000


def _summary(
    sessions: dict,
    names: Counter,
    person_of: dict,
    apps: list,
    pays: list,
    members: list,
    ads: list,
    start_date: date,
    weeks: int,
    n_rows: int,
    n_clients: int,
    n_persons: int,
) -> tuple[str, dict[int, float]]:
    def week_of(d: str) -> int:
        return (date.fromisoformat(d) - start_date).days // 7

    wk_persons: dict[int, set[str]] = defaultdict(set)
    wk_sessions: Counter[int] = Counter()
    person_days: dict[str, set[date]] = defaultdict(set)
    day_persons: dict[str, set[str]] = defaultdict(set)
    medium: Counter[str] = Counter()
    source_medium: Counter[str] = Counter()
    dow_hour: Counter[tuple[int, int]] = Counter()
    funnel = Counter()
    n_auto = 0
    member_sessions = 0
    engaged = 0
    for s in sessions.values():
        if _is_auto(s):
            n_auto += 1
            continue
        p = person_of.get(s.client, s.client)
        w = week_of(s.date)
        wk_persons[w].add(p)
        wk_sessions[w] += 1
        person_days[p].add(date.fromisoformat(s.date))
        day_persons[s.date].add(p)
        medium[s.medium] += 1
        source_medium[f"{s.source} / {s.medium}"] += 1
        t = datetime.fromtimestamp(s.ts_min // 1_000_000, KST)
        dow_hour[(t.isoweekday(), t.hour)] += 1
        member_sessions += bool(s.users)
        engaged += s.engaged
        funnel["landing"] += 1
        if s.detail:
            funnel["detail_view"] += 1
            if s.identified:
                funnel["identified"] += 1
                if s.apply_form:
                    funnel["apply_form"] += 1
                    if s.applied:
                        funnel["applied"] += 1
    visit_sessions = len(sessions) - n_auto

    wk_signup: Counter[int] = Counter(week_of(m["signed_up_at"][:10]) for m in members)
    wk_apply: Counter[int] = Counter(week_of(a["applied_at"][:10]) for a in apps)
    wk_pay: Counter[int] = Counter()
    wk_amount: Counter[int] = Counter()
    for p in pays:
        w = week_of(p["paid_at"][:10])
        wk_pay[w] += 1
        wk_amount[w] += int(p["amount"])
    wk_spend: Counter[int] = Counter()
    for a in ads:
        wk_spend[week_of(a["date"])] += int(a["spend"])

    # 첫 방문 주 코호트 리텐션 (사람 단위, 완결 코호트만)
    first_week: dict[str, int] = {}
    visit_weeks: dict[str, set[int]] = {}
    for p, days in person_days.items():
        ws = {(d - start_date).days // 7 for d in days}
        first_week[p] = min(ws)
        visit_weeks[p] = ws
    ret = {}
    for off in RET_OFFSETS:
        num = den = 0
        for p, fw in first_week.items():
            if fw + off < weeks:
                den += 1
                num += (fw + off) in visit_weeks[p]
        ret[off] = num / den if den else 0.0

    daily = sorted(len(v) for v in day_persons.values())
    out: list[str] = [
        "# NightPulse 합성 데이터 요약",
        "",
        "합성 데이터 · 실제 서비스 데이터 아님. `generator/validate.py` 생성물.",
        "",
        "## 규모",
        "",
        "| 항목 | 값 |",
        "|---|---|",
        f"| 이벤트 행 | {n_rows:,} |",
        f"| 세션 (자동 로드 포함) | {len(sessions):,} |",
        f"| 자동 로드 세션 비중 | {n_auto / len(sessions):.3f} |",
        f"| 기기 / 사람 | {n_clients:,} / {n_persons:,} |",
        f"| 회원 (가입) | {len(members):,} ({len(members) / n_persons:.1%}) |",
        f"| 신청 / 결제 / 취소 | {len(apps):,} / {len(pays):,} / {sum(a['status'] == 'canceled' for a in apps):,} |",
        f"| 결제 금액 합 (원) | {sum(int(p['amount']) for p in pays):,} |",
        f"| 일 방문 사람 p10 / p50 / p90 | {daily[len(daily) // 10]} / {daily[len(daily) // 2]} / "
        f"{daily[len(daily) * 9 // 10]} |",
        f"| 방문 세션 중 회원 세션 | {member_sessions / visit_sessions:.3f} |",
        f"| 방문 세션 중 engaged | {engaged / visit_sessions:.3f} |",
        "",
        "## 주별 추이",
        "",
        "| 주 | 시작일 | 방문 사람 | 방문 세션 | 가입 | 신청 | 결제 | 결제 금액 | 광고비 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for w in range(weeks):
        out.append(
            f"| {w + 1} | {start_date + timedelta(days=7 * w)} | {len(wk_persons[w]):,} | {wk_sessions[w]:,} "
            f"| {wk_signup[w]} | {wk_apply[w]} | {wk_pay[w]} | {wk_amount[w]:,} | {wk_spend[w]:,} |"
        )
    out += ["", "## 세션 채널 비중 (방문 세션, medium)", "", "| medium | 비중 |", "|---|---|"]
    out += [f"| {k} | {v / visit_sessions:.3f} |" for k, v in medium.most_common()]
    out += ["", "상위 source / medium", "", "| source / medium | 비중 |", "|---|---|"]
    out += [f"| {k} | {v / visit_sessions:.3f} |" for k, v in source_medium.most_common(10)]
    dows = "월화수목금토일"
    out += ["", "## 요일 × 시(KST) 상위 10 (방문 세션 시작)", "", "| 요일 | 시 | 비중 |", "|---|---|---|"]
    out += [f"| {dows[d - 1]} | {h:02d} | {v / visit_sessions:.4f} |" for (d, h), v in dow_hour.most_common(10)]
    seed_funnel = {r["step_key"]: float(r["rate_of_landing"]) for r in _read_csv(SEED_DIR / "funnel_steps.csv")}
    out += ["", "## 세션 퍼널 (랜딩 대비, 누적 조건)", "", "| 단계 | 합성 | seed |", "|---|---|---|"]
    for k in ("landing", "detail_view", "identified", "apply_form", "applied"):
        out.append(f"| {k} | {funnel[k] / funnel['landing']:.3f} | {seed_funnel[k]:.3f} |")
    out += [
        "",
        "## 첫 방문 주 코호트 리텐션 (사람, 완결 코호트)",
        "",
        "| 오프셋 | 리텐션 |",
        "|---|---|",
    ]
    out += [f"| W{o} | {ret[o]:.3f} |" for o in RET_OFFSETS]
    out += ["", "## 이벤트명별 행 수", "", "| event_name | 행 수 | 비중 |", "|---|---|---|"]
    out += [f"| {k} | {v:,} | {v / n_rows:.4f} |" for k, v in names.most_common()]
    return "\n".join(out) + "\n", ret


def main() -> None:
    """CLI 진입점."""
    ap = argparse.ArgumentParser(description="NightPulse 합성 데이터 검증")
    ap.add_argument("--data", type=Path, default=Path("data"))
    ap.add_argument("--weeks", type=int, default=52)
    ap.add_argument("--end-date", type=date.fromisoformat, default=date(2026, 9, 20))
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    checks, summary = validate(args.data, args.weeks, args.end_date)
    lines = [f"| {'통과' if ok else '실패'} | {name} | {detail} |" for name, ok, detail in checks]
    summary = summary.replace(
        "## 규모", "## 단언\n\n| 결과 | 항목 | 상세 |\n|---|---|---|\n" + "\n".join(lines) + "\n\n## 규모", 1
    )
    (args.data / "summary.md").write_text(summary, encoding="utf-8")
    for name, ok, detail in checks:
        (logger.info if ok else logger.error)("%s %s %s", "PASS" if ok else "FAIL", name, detail)
    if not all(ok for _, ok, _ in checks):
        sys.exit(1)
    logger.info("전부 통과 -> %s", args.data / "summary.md")


if __name__ == "__main__":
    main()
