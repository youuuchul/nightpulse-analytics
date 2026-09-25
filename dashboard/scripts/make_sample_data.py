"""대시보드 개발용 합성 샘플 data.json 생성기.

마트가 완성되기 전 화면을 개발하기 위해 data.json 계약과 같은 모양의 작은 샘플을 만든다.
사람 단위로 방문을 모사한 뒤 같은 기록에서 모든 마트를 집계하므로 마트 간 합계가 서로 맞는다.
시드 고정이라 같은 인자면 같은 파일이 나온다. 실제 마트 추출은 extract.py 가 대신한다.

    uv run dashboard/scripts/make_sample_data.py --out dashboard/public/data.json
"""

from __future__ import annotations

import argparse
import json
import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAMES = json.loads((ROOT / "generator" / "seed" / "names.json").read_text(encoding="utf-8"))

PLATFORMS = [("ios", 0.46), ("android", 0.34), ("web", 0.20)]
NON_PAID = [
    (("direct", "direct"), 0.30),
    (("influencer", "instagram"), 0.22),
    (("organic_search", "naver"), 0.16),
    (("organic_social", "instagram"), 0.14),
    (("organic_search", "google"), 0.07),
    (("organic_social", "linktree"), 0.05),
    (("referral", "bitly"), 0.03),
    (("ai_referral", "chatgpt"), 0.03),
]
PRICE = {"free": 0, "standard": 20000, "premium": 50000}
FUNNEL_STEPS = ["landing", "detail", "signup", "apply_view", "payment"]
HOUR_WEIGHTS = [6, 4, 2, 1, 1, 1, 1, 1, 1, 2, 2, 3, 4, 4, 4, 4, 5, 6, 8, 10, 12, 13, 12, 9]
AUDIENCES = ["new", "returning", "paid_inflow", "past_payer", "apply_no_pay", "explorer_only"]
EXIT = "(이탈)"
OTHER = "(기타)"
LANDING = [("home", 0.46), ("event_detail", 0.24), ("map_main", 0.1), ("venue_detail", 0.1), ("search_main", 0.1)]
SCREEN_NEXT: dict[str, list[tuple[str, float]]] = {
    "home": [("event_detail", 0.35), ("map_main", 0.14), ("search_main", 0.12), ("venue_detail", 0.12), (OTHER, 0.06), (EXIT, 0.21)],
    "map_main": [("venue_detail", 0.35), ("event_detail", 0.2), ("home", 0.1), (EXIT, 0.35)],
    "search_main": [("search_result", 0.6), ("home", 0.05), (EXIT, 0.35)],
    "search_result": [("event_detail", 0.35), ("venue_detail", 0.3), (EXIT, 0.35)],
    "event_detail": [("event_apply", 0.12), ("login", 0.1), ("venue_detail", 0.1), ("home", 0.15), ("event_detail", 0.1), (EXIT, 0.43)],
    "venue_detail": [("event_detail", 0.3), ("venue_review", 0.2), ("home", 0.1), (EXIT, 0.4)],
    "venue_review": [("venue_detail", 0.3), ("event_detail", 0.2), (EXIT, 0.5)],
    "login": [("event_detail", 0.4), ("event_apply", 0.2), (OTHER, 0.1), (EXIT, 0.3)],
    "event_apply": [("payment_confirm", 0.55), ("event_detail", 0.1), (EXIT, 0.35)],
    "payment_confirm": [("payment_success", 0.6), ("event_apply", 0.05), (EXIT, 0.35)],
    "payment_success": [("home", 0.3), (EXIT, 0.7)],
    OTHER: [("home", 0.4), ("event_detail", 0.2), (EXIT, 0.4)],
}


# 시나리오 2.0: 상권·장르·유형은 생성기 시드(names.json)를 그대로 쓴다. 상호는 전부 가상 조합.
REGIONS: list[dict] = NAMES["regions"]
GENRES: list[str] = NAMES["genres"]
VENUE_TYPES: list[str] = NAMES["venue_types"]
PLANS = [("basic", 99000, 0.7), ("pro", 299000, 0.3)]
SUB_PRICE = 9900
SUB_LAUNCH = date(2025, 12, 1)
PD = {
    "visited": 1,
    "explored": 2,
    "event_detail": 4,
    "detail_any": 8,
    "signed_up": 16,
    "logged_in": 32,
    "apply_view": 64,
    "applied": 128,
    "paid": 256,
    "cancelled": 512,
    "searched": 1024,
    "banner": 2048,
    "shared": 4096,
    "multi_session": 8192,
    "first_visit": 16384,
    "subscribed": 32768,
}
SAMPLE_VENUES = 60


def venue_name(rng: random.Random, vtype: str) -> str:
    """가상 상호 한 개(한글 또는 영문 조합 + 유형 접미사)."""
    ko, en = NAMES["venue_type_suffix"][vtype]
    if rng.random() < NAMES["venue_name_en_share"]:
        return f"{rng.choice(NAMES['venue_name_en_a'])} {rng.choice(NAMES['venue_name_en_b'])} {en}"
    return f"{rng.choice(NAMES['venue_name_ko_a'])}{rng.choice(NAMES['venue_name_ko_b'])} {ko}"


def pick(rng: random.Random, pairs: list[tuple]) -> object:
    """가중치 목록에서 하나를 고른다.

    Args:
        rng: 난수 생성기.
        pairs: (값, 가중치) 목록.

    Returns:
        고른 값.
    """
    return rng.choices([p[0] for p in pairs], weights=[p[1] for p in pairs])[0]


def monday(d: date) -> date:
    """해당 날짜가 속한 주의 월요일."""
    return d - timedelta(days=d.weekday())


@dataclass
class Person:
    """샘플 사람 1명."""

    pid: int
    first_day: date
    channel1: str
    platform: str
    signup_day: date | None
    core: bool
    campaign: str | None
    visits: list[date] = field(default_factory=list)

    def seg(self, d: date) -> str:
        """그날의 회원 여부."""
        return "member" if self.signup_day is not None and self.signup_day <= d else "guest"


def build(seed: int, to_date: date, weeks: int, persons: int) -> dict:
    """샘플 마트 전체를 만든다.

    Args:
        seed: 난수 시드.
        to_date: 기준일(마지막 날짜).
        weeks: 기간 주 수.
        persons: 사람 수.

    Returns:
        data.json 계약 모양의 딕셔너리.
    """
    rng = random.Random(seed)
    from_date = to_date - timedelta(days=weeks * 7 - 1)
    days = [from_date + timedelta(days=i) for i in range((to_date - from_date).days + 1)]

    venues = []
    used: set[str] = set()
    for i in range(SAMPLE_VENUES):
        vtype = rng.choice(VENUE_TYPES)
        name = ""
        while not name or name in used:
            name = venue_name(rng, vtype)
        used.add(name)
        venues.append(
            {
                "venue_id": 101 + i,
                "venue_name": name,
                "venue_type": vtype,
                "region": pick(rng, [(r["name"], r["share"]) for r in REGIONS if not r.get("scatter")]),
                "genre": rng.choice(GENRES),
                "pop": rng.paretovariate(1.6),
            }
        )

    events = []
    for w in range(weeks):
        for _ in range(rng.randint(2, 5) + (2 if w >= 40 else 0)):
            v = rng.choice(venues)
            start = from_date + timedelta(days=w * 7 + rng.choice([3, 4, 4, 5, 5, 5]))
            tier = rng.choices(["free", "standard", "premium"], weights=[0.3, 0.5, 0.2])[0]
            etype = rng.choices(NAMES["event_types"], weights=NAMES["event_type_weights"])[0]
            season = NAMES["seasons"][str(start.month)]
            name = f"{v['venue_name']} {season} {rng.choice(NAMES['genres'])} {etype}"
            events.append(
                {
                    "event_id": 5001 + len(events),
                    "event_name": name,
                    "venue_id": v["venue_id"],
                    "venue_name": v["venue_name"],
                    "event_type": etype,
                    "price_tier": tier,
                    "open": start - timedelta(days=rng.randint(10, 24)),
                    "start": start,
                    "pop": rng.paretovariate(1.8) * v["pop"] ** 0.3,
                }
            )

    campaigns = []
    for c in NAMES["campaigns"]:
        if "start_date" in c:
            s, e = date.fromisoformat(c["start_date"]), date.fromisoformat(c["end_date"])
        else:
            s = from_date + timedelta(days=(c["start_week"] - 1) * 7)
            e = from_date + timedelta(days=c["end_week"] * 7 - 1)
        campaigns.append({**c, "start": s, "end": e})

    def campaign_on(d: date) -> dict | None:
        for c in campaigns:
            if c["start"] <= d <= c["end"]:
                return c
        return None

    day_weight = []
    for i, d in enumerate(days):
        growth = 0.35 + 0.65 * min(1.0, i / 120)
        season = 1.25 if 43 <= i // 7 < 52 else 1.0
        dow = [0.8, 0.8, 0.9, 1.0, 1.25, 1.35, 1.0][d.weekday()]
        camp = 1.9 if campaign_on(d) else 1.0
        day_weight.append(growth * season * dow * camp)

    people: list[Person] = []
    for pid in range(persons):
        i = rng.choices(range(len(days)), weights=day_weight)[0]
        d = days[i]
        camp = campaign_on(d)
        paid = camp is not None and rng.random() < 0.55
        core = rng.random() < 0.09
        signup_day = None
        if rng.random() < (0.2 if core else 0.1) * (0.7 if paid else 1.0):
            signup_day = d + timedelta(days=int(rng.expovariate(1 / 6)) if rng.random() < 0.6 else 0)
        people.append(
            Person(
                pid=pid,
                first_day=d,
                channel1="paid" if paid else "non_paid",
                platform=pick(rng, PLATFORMS),
                signup_day=signup_day,
                core=core,
                campaign=camp["campaign_id"] if paid else None,
            )
        )

    for p in people:
        p.visits.append(p.first_day)
        life = rng.expovariate(1 / (70 if p.core else 18))
        d = p.first_day + timedelta(days=1)
        while d <= to_date:
            age = (d - p.first_day).days
            if p.core:
                prob = 0.16 if age < life else 0.01
            else:
                prob = 0.010 + 0.06 * math.exp(-age / 4) + (0.02 if age < life else 0)
            if p.signup_day is not None and p.signup_day <= d:
                prob *= 1.5
            if d.weekday() in (4, 5):
                prob *= 1.3
            if p.channel1 == "paid":
                prob *= 0.7
            if rng.random() < prob:
                p.visits.append(d)
            d += timedelta(days=1)
        if p.signup_day is not None and p.signup_day not in p.visits:
            if p.signup_day <= to_date:
                p.visits.append(p.signup_day)
                p.visits.sort()
            else:
                p.signup_day = None

    dm: dict[tuple, dict] = defaultdict(lambda: defaultdict(int))
    hm: dict[tuple, dict] = defaultdict(lambda: defaultdict(int))
    dc: dict[tuple, dict] = defaultdict(lambda: defaultdict(int))
    fd: dict[tuple, int] = defaultdict(int)
    ad: dict[tuple, dict] = defaultdict(lambda: defaultdict(int))
    ev: dict[tuple, dict] = defaultdict(lambda: defaultdict(int))
    vn: dict[tuple, dict] = defaultdict(lambda: defaultdict(int))
    month_channel: dict[str, dict] = defaultdict(lambda: defaultdict(int))
    person_day: dict[tuple[int, date], tuple[list[bool], bool, bool]] = {}
    wp: dict[tuple, int] = defaultdict(int)
    prng = random.Random(seed + 1)
    pd_flags: dict[tuple[int, date], int] = {}
    payments: list[tuple[date, int, int, int]] = []

    for p in people:
        for d in p.visits:
            seg = p.seg(d)
            key = (d, p.channel1, p.platform, seg)
            row = dm[key]
            first = d == p.first_day
            signed_today = p.signup_day == d
            n_sess = 1 + (rng.random() < (0.45 if p.core else 0.22)) + (rng.random() < 0.08)
            camp = campaign_on(d) if p.channel1 == "paid" else None
            open_events = [e for e in events if e["open"] <= d <= e["start"]]

            row["persons"] += 1
            row["new_persons"] += int(first)
            row["sessions"] += n_sess
            engaged = sum(rng.random() < (0.62 if p.channel1 == "paid" else 0.86) for _ in range(n_sess))
            row["engaged_sessions"] += engaged

            explorer = rng.random() < 0.58
            detail = rng.random() < (0.46 if explorer else 0.2)
            logged = seg == "member" or signed_today
            gate = detail and logged
            apply_view = gate and rng.random() < 0.5
            applies = 0
            pay_count = 0
            pay_amount = 0
            cancels = 0
            viewed = []
            if detail and open_events:
                k = 1 + (rng.random() < 0.35)
                viewed = rng.choices(open_events, weights=[e["pop"] for e in open_events], k=k)
                for e in {x["event_id"]: x for x in viewed}.values():
                    ev[(d, e["event_id"])]["detail_viewers"] += 1
                    vn[(d, e["venue_id"])]["detail_viewers"] += 1
            if apply_view and viewed and rng.random() < 0.75:
                e = viewed[0]
                applies = 1
                ev[(d, e["event_id"])]["applies"] += 1
                vn[(d, e["venue_id"])]["applies"] += 1
                amount = PRICE[e["price_tier"]]
                paid_ok = amount == 0 or rng.random() < 0.66
                if amount > 0 and paid_ok:
                    pay_count = 1
                    pay_amount = amount + rng.choice([-2000, 0, 0, 3000])
                    payments.append((d, p.pid, e["venue_id"], pay_amount))
                    ev[(d, e["event_id"])]["pay_count"] += 1
                    ev[(d, e["event_id"])]["pay_amount"] += pay_amount
                    vn[(d, e["venue_id"])]["pay_count"] += 1
                if rng.random() < 0.085:
                    cancels = 1
                    ev[(d, e["event_id"])]["cancels"] += 1

            row["explorers"] += int(explorer)
            row["detail_viewers"] += int(detail)
            row["signups"] += int(signed_today)
            row["apply_viewers"] += int(apply_view)
            row["applies"] += applies
            row["payers"] += int(pay_count > 0)
            row["pay_count"] += pay_count
            row["pay_amount"] += pay_amount
            row["cancels"] += cancels

            for step, hit in zip(FUNNEL_STEPS, [True, detail, gate, apply_view, pay_count > 0], strict=True):
                if hit:
                    fd[(d, step, p.channel1, p.platform, seg)] += 1

            hw = [w * (1.4 if d.weekday() in (4, 5) and h >= 20 else 1.0) for h, w in enumerate(HOUR_WEIGHTS)]
            hours = rng.choices(range(24), weights=hw, k=n_sess)
            for idx, h in enumerate(hours):
                hrow = hm[(d, h, p.channel1, p.platform, seg)]
                hrow["sessions"] += 1
                if idx == 0:
                    hrow["persons"] += 1
                    hrow["applies"] += applies
                    hrow["pay_count"] += pay_count

            chans = []
            for s in range(n_sess):
                if camp is not None and (s == 0 or rng.random() < 0.4):
                    chans.append(("paid", "paid_social", camp["source"]))
                else:
                    c2, c3 = pick(rng, NON_PAID)
                    chans.append(("non_paid", c2, c3))
            hits = [True, detail, gate, apply_view, pay_count > 0]
            pd_flags[(p.pid, d)] = (
                PD["visited"]
                | (PD["explored"] if explorer else 0)
                | (PD["event_detail"] | PD["detail_any"] if detail else 0)
                | (PD["signed_up"] if signed_today else 0)
                | (PD["logged_in"] if logged else 0)
                | (PD["apply_view"] if apply_view else 0)
                | (PD["applied"] if applies else 0)
                | (PD["paid"] if pay_count else 0)
                | (PD["cancelled"] if cancels else 0)
                | (PD["multi_session"] if n_sess >= 2 else 0)
                | (PD["first_visit"] if first else 0)
            )
            person_day[(p.pid, d)] = (hits, any(c[0] == "paid" for c in chans), applies > 0)
            wk_seg = p.seg(monday(d))
            for _ in range(n_sess):
                land = pick(prng, LANDING)
                path = [land]
                while len(path) < 5 and path[-1] != EXIT:
                    path.append(pick(prng, SCREEN_NEXT[path[-1]]))
                for i in range(min(len(path) - 1, 4)):
                    wp[(monday(d), p.channel1, p.platform, wk_seg, i + 1, path[i], path[i + 1])] += 1
                if len(path) == 1:
                    wp[(monday(d), p.channel1, p.platform, wk_seg, 1, land, EXIT)] += 1

            for s, (c1, c2, c3) in enumerate(chans):
                crow = dc[(d, c1, c2, c3, p.platform, seg)]
                crow["sessions"] += 1
                month_channel[d.strftime("%Y-%m")][c2] += 1
                if s == 0:
                    crow["persons"] += 1
                    crow["new_persons"] += int(first)
                    crow["signups"] += int(signed_today)
                    crow["applies"] += applies
                    crow["payers"] += int(pay_count > 0)
                    crow["pay_amount"] += pay_amount

            if camp is not None:
                arow = ad[(d, camp["campaign_id"])]
                paid_sess = sum(1 for c in chans if c[0] == "paid")
                arow["sessions"] += paid_sess
                if paid_sess:
                    arow["persons"] += 1
                    arow["active_persons"] += int(engaged > 0)
                    arow["signups"] += int(signed_today)
                    arow["applies"] += applies
                    arow["payers"] += int(pay_count > 0)
                    arow["pay_amount"] += pay_amount

    for c in campaigns:
        d = c["start"]
        while d <= min(c["end"], to_date):
            arow = ad[(d, c["campaign_id"])]
            spend = int(c["daily_budget"] * rng.uniform(0.85, 1.1))
            imps = int(spend / rng.uniform(5500, 7500) * 1000)
            arow["spend"] = spend
            arow["impressions"] = imps
            arow["clicks"] = max(arow["sessions"], int(imps * rng.uniform(0.0035, 0.0055)))
            d += timedelta(days=1)

    ds = lambda d: d.isoformat()  # noqa: E731
    out: dict = {}
    out["daily_metrics"] = [
        {"kst_date": ds(k[0]), "channel1": k[1], "device_platform": k[2], "member_seg": k[3], **v}
        for k, v in sorted(dm.items())
    ]
    metric_cols = [
        "persons",
        "new_persons",
        "sessions",
        "engaged_sessions",
        "explorers",
        "detail_viewers",
        "signups",
        "apply_viewers",
        "applies",
        "payers",
        "pay_count",
        "pay_amount",
        "cancels",
    ]
    for r in out["daily_metrics"]:
        for c in metric_cols:
            r.setdefault(c, 0)
    out["hourly_metrics"] = [
        {
            "kst_date": ds(k[0]),
            "kst_hour": k[1],
            "channel1": k[2],
            "device_platform": k[3],
            "member_seg": k[4],
            "persons": v["persons"],
            "sessions": v["sessions"],
            "applies": v["applies"],
            "pay_count": v["pay_count"],
        }
        for k, v in sorted(hm.items())
    ]
    out["daily_channel"] = [
        {
            "kst_date": ds(k[0]),
            "channel1": k[1],
            "channel2": k[2],
            "channel3": k[3],
            "device_platform": k[4],
            "member_seg": k[5],
            **{c: v[c] for c in ["sessions", "persons", "new_persons", "signups", "applies", "payers", "pay_amount"]},
        }
        for k, v in sorted(dc.items())
    ]
    camp_names = {c["campaign_id"]: c["name"] for c in campaigns}
    out["daily_ad"] = [
        {
            "kst_date": ds(k[0]),
            "campaign_id": k[1],
            "campaign_name": camp_names[k[1]],
            **{
                c: v[c]
                for c in [
                    "spend",
                    "impressions",
                    "clicks",
                    "sessions",
                    "persons",
                    "active_persons",
                    "signups",
                    "applies",
                    "payers",
                    "pay_amount",
                ]
            },
        }
        for k, v in sorted(ad.items())
    ]
    ev_meta = {e["event_id"]: e for e in events}
    out["daily_event"] = [
        {
            "kst_date": ds(k[0]),
            "event_id": k[1],
            "event_name": ev_meta[k[1]]["event_name"],
            "venue_name": ev_meta[k[1]]["venue_name"],
            "event_type": ev_meta[k[1]]["event_type"],
            "price_tier": ev_meta[k[1]]["price_tier"],
            **{c: v[c] for c in ["detail_viewers", "applies", "pay_count", "pay_amount", "cancels"]},
        }
        for k, v in sorted(ev.items())
    ]
    vmeta = {v["venue_id"]: v for v in venues}
    out["daily_venue"] = [
        {
            "kst_date": ds(k[0]),
            "venue_id": k[1],
            "venue_name": vmeta[k[1]]["venue_name"],
            "region": vmeta[k[1]]["region"],
            "genre": vmeta[k[1]]["genre"],
            **{c: v[c] for c in ["detail_viewers", "applies", "pay_count"]},
        }
        for k, v in sorted(vn.items())
    ]
    out["funnel_daily"] = [
        {
            "kst_date": ds(k[0]),
            "step": k[1],
            "channel1": k[2],
            "device_platform": k[3],
            "member_seg": k[4],
            "persons": n,
        }
        for k, n in sorted(fd.items(), key=lambda kv: (kv[0][0], FUNNEL_STEPS.index(kv[0][1]), kv[0][2:]))
    ]

    last_monday = monday(to_date)
    wc: dict[tuple, list[int]] = defaultdict(lambda: [0, 0])
    wa: dict[tuple, dict] = defaultdict(lambda: defaultdict(int))
    mc: dict[tuple, list[int]] = defaultdict(lambda: [0, 0])
    for p in people:
        cw = monday(p.first_day)
        weeks_seen: dict[date, set[date]] = defaultdict(set)
        for d in p.visits:
            weeks_seen[monday(d)].add(d)
        seg_c = p.seg(cw + timedelta(days=6))
        base = (cw, p.channel1, p.platform, seg_c)
        for off in range(13):
            wk = cw + timedelta(weeks=off)
            if wk > last_monday:
                break
            wc[(*base, off)][0] += 1
            wc[(*base, off)][1] += int(wk in weeks_seen)
        for wk, ds_ in weeks_seen.items():
            seg_w = p.seg(wk + timedelta(days=6))
            r = wa[(wk, p.channel1, p.platform, seg_w)]
            r["wau"] += 1
            r["new_persons"] += int(wk == cw)
            r["returning_persons"] += int(wk != cw)
            r["two_plus_days"] += int(len(ds_) >= 2)
        cm = p.first_day.replace(day=1)
        months_seen = {d.replace(day=1) for d in p.visits}
        seg_m = p.seg(to_date)
        for off in range(7):
            m = (cm.month - 1 + off) % 12 + 1
            y = cm.year + (cm.month - 1 + off) // 12
            mk = date(y, m, 1)
            if mk > to_date.replace(day=1):
                break
            mc[(cm, seg_m, off)][0] += 1
            mc[(cm, seg_m, off)][1] += int(mk in months_seen)

    out["weekly_cohort"] = [
        {
            "cohort_week": ds(k[0]),
            "week_offset": k[4],
            "channel1": k[1],
            "device_platform": k[2],
            "member_seg": k[3],
            "cohort_size": v[0],
            "retained": v[1],
        }
        for k, v in sorted(wc.items())
    ]
    out["monthly_cohort"] = [
        {
            "cohort_month": k[0].strftime("%Y-%m"),
            "month_offset": k[2],
            "member_seg": k[1],
            "cohort_size": v[0],
            "retained": v[1],
        }
        for k, v in sorted(mc.items())
    ]
    out["weekly_activity"] = [
        {"week_start": ds(k[0]), "channel1": k[1], "device_platform": k[2], "member_seg": k[3], **v}
        for k, v in sorted(wa.items())
    ]

    wf: dict[tuple, int] = defaultdict(int)
    for p in people:
        paid_before = False
        applied_before = False
        weeks_order = sorted({monday(d) for d in p.visits})
        for wk in weeks_order:
            wdays = [d for d in p.visits if monday(d) == wk]
            recs = [person_day[(p.pid, d)] for d in wdays]
            reach = [any(r[0][i] for r in recs) for i in range(5)]
            weekly_paid = any(r[1] for r in recs)
            member = p.seg(wk)
            auds = ["new" if wk == monday(p.first_day) else "returning"]
            if weekly_paid:
                auds.append("paid_inflow")
            if paid_before:
                auds.append("past_payer")
            if applied_before and not paid_before:
                auds.append("apply_no_pay")
            if reach[1] and not reach[3]:
                auds.append("explorer_only")
            for a in auds:
                for i, step in enumerate(FUNNEL_STEPS):
                    if all(reach[: i + 1]):
                        wf[(wk, a, step, p.channel1, p.platform, member)] += 1
            paid_before = paid_before or reach[4]
            applied_before = applied_before or any(r[2] for r in recs)

    out["weekly_audience_funnel"] = [
        {
            "week_start": ds(k[0]),
            "audience_id": k[1],
            "step": k[2],
            "channel1": k[3],
            "device_platform": k[4],
            "member_seg": k[5],
            "persons": n,
        }
        for k, n in sorted(wf.items(), key=lambda kv: (kv[0][0], AUDIENCES.index(kv[0][1]), FUNNEL_STEPS.index(kv[0][2]), kv[0][3:]))
    ]
    out["weekly_path"] = [
        {
            "week_start": ds(k[0]),
            "channel1": k[1],
            "device_platform": k[2],
            "member_seg": k[3],
            "step": k[4],
            "from_screen": k[5],
            "to_screen": k[6],
            "sessions": n,
        }
        for k, n in sorted(wp.items())
    ]

    months = sorted({d.strftime("%Y-%m") for d in days})
    ms = []
    for m in months:
        in_m = [p for p in people if any(d.strftime("%Y-%m") == m for d in p.visits)]
        new = [p for p in people if p.first_day.strftime("%Y-%m") == m]
        rows = [r for k, r in dm.items() if k[0].strftime("%Y-%m") == m]
        w1_base = [p for p in new if monday(p.first_day) + timedelta(weeks=1) <= last_monday]
        w1_hit = [p for p in w1_base if any(monday(d) == monday(p.first_day) + timedelta(weeks=1) for d in p.visits)]
        ch = month_channel[m]
        ms.append(
            {
                "month": m,
                "persons": len(in_m),
                "new_persons": len(new),
                "signups": sum(r["signups"] for r in rows),
                "applies": sum(r["applies"] for r in rows),
                "pay_count": sum(r["pay_count"] for r in rows),
                "pay_amount": sum(r["pay_amount"] for r in rows),
                "cancels": sum(r["cancels"] for r in rows),
                "w1_retention": round(len(w1_hit) / len(w1_base), 4) if w1_base else None,
                "top_channel": max(ch, key=ch.get) if ch else None,
            }
        )
    out["monthly_summary"] = ms
    build_v2(seed, out, people, days, venues, events, payments, pd_flags)

    tables = {k: len(v["rows"]) if isinstance(v, dict) else len(v) for k, v in out.items()}
    meta = {
        "to_date": ds(to_date),
        "from_date": ds(from_date),
        "built_at": datetime(to_date.year, to_date.month, to_date.day, 1, 0, tzinfo=UTC).isoformat(),
        "source": "sample",
        "tables": tables,
    }
    return {"meta": meta, **out}


def jitter(rng: random.Random, lat: float, lng: float, meters: float) -> tuple[float, float]:
    """중심에서 정규 분포로 흩뿌린 좌표(미터 단위 표준편차)."""
    return (
        round(lat + rng.gauss(0, meters) / 111_000, 6),
        round(lng + rng.gauss(0, meters) / 88_000, 6),
    )


def build_v2(
    seed: int,
    out: dict,
    people: list[Person],
    days: list[date],
    venues: list[dict],
    events: list[dict],
    payments: list[tuple[date, int, int, int]],
    pd_flags: dict[tuple[int, date], int],
) -> None:
    """시나리오 2.0 마트(공간 원장·계약·구독·매출)와 person_day 를 샘플로 만든다.

    Args:
        seed: 난수 시드.
        out: 결과 사전. 새 키를 추가하고 monthly_summary 행에 열을 더한다.
        people: 샘플 사람 목록.
        days: 기간 날짜 목록.
        venues: 행사를 여는 공간(샘플 이벤트용).
        events: 행사 목록.
        payments: (날짜, 사람, 공간, 금액) 티켓 결제.
        pd_flags: (사람, 날짜) → 행동 비트.
    """
    rng = random.Random(seed + 2)
    from_date = days[0]
    n_days = len(days)
    total = 1800

    subcenters = {
        r["name"]: [jitter(rng, *rng.choice(r["centers"]), 420) for _ in range(rng.randint(2, 4))]
        for r in REGIONS
        if not r.get("scatter")
    }
    event_ids = {v["venue_id"] for v in venues}
    names: set[str] = {v["venue_name"] for v in venues}
    reg: list[dict] = []
    for i in range(total):
        ev = venues[i] if i < len(venues) else None
        if ev:
            rdef = next(r for r in REGIONS if r["name"] == ev["region"])
        else:
            rdef = pick(rng, [(r, r["share"]) for r in REGIONS])
        ci = rng.choices(range(len(rdef["centers"])), weights=rdef.get("center_weights"))[0]
        district = rdef["center_districts"][ci] if "center_districts" in rdef else rdef["district"]
        if rdef.get("scatter"):
            lat, lng = jitter(rng, *rdef["centers"][ci], 700)
        else:
            lat, lng = jitter(rng, *rng.choice(subcenters[rdef["name"]]), 230)
        genre = ev["genre"] if ev else rng.choices(GENRES, weights=rdef["genre_w"])[0]
        vtype = ev["venue_type"] if ev else rng.choices(VENUE_TYPES, weights=rdef["type_w"])[0]
        if ev:
            name = ev["venue_name"]
        else:
            name = ""
            while not name or name in names:
                name = venue_name(rng, vtype)
        names.add(name)
        if i < 300:
            reg_day = 0
        else:
            u = rng.random()
            reg_day = int((n_days - 1) * math.acos(1 - 2 * u) / math.pi)
        band = rng.choices(NAMES["capacity_bands"], weights=NAMES["type_capacity_weights"][vtype])[0]
        reg.append(
            {
                "venue_id": ev["venue_id"] if ev else 1001 + i,
                "name": name,
                "region": rdef["name"],
                "district": district,
                "lat": lat,
                "lng": lng,
                "genre": genre,
                "venue_type": vtype,
                "capacity_band": band,
                "registered_day": reg_day,
                "pop": rng.paretovariate(1.4) * rdef["share"] * 5,
            }
        )

    contracts: list[dict] = []
    for v in reg:
        is_event = v["venue_id"] in event_ids
        if not (rng.random() < (0.8 if is_event else 0.093)):
            continue
        start = v["registered_day"] + (int(rng.expovariate(1 / 20)) if is_event else int(rng.expovariate(1 / 60)))
        if start >= n_days:
            continue
        plan, fee, _ = pick(rng, [((a, b, c), c) for a, b, c in PLANS])
        end = None
        m = start + 30
        while m < n_days:
            if rng.random() < 0.02:
                end = m
                break
            m += 30
        contracts.append({"venue_id": v["venue_id"], "plan": plan, "fee": fee, "start": start, "end": end})
    by_venue = {c["venue_id"]: c for c in contracts}

    def partner_on(vid: int, di: int) -> bool:
        c = by_venue.get(vid)
        return c is not None and c["start"] <= di and (c["end"] is None or di < c["end"])

    # 구독: 회원만, 12/01 출시, 월 이탈 6%
    subs: dict[int, tuple[int, int | None]] = {}
    launch = (SUB_LAUNCH - from_date).days
    for p in people:
        if p.signup_day is None or rng.random() > (0.55 if p.core else 0.3):
            continue
        s0 = max((p.signup_day - from_date).days, launch) + int(rng.expovariate(1 / 25))
        if s0 >= n_days:
            continue
        end = None
        m = s0 + 30
        while m < n_days:
            if rng.random() < 0.06:
                end = m
                break
            m += 30
        subs[p.pid] = (s0, end)

    def sub_on(pid: int, di: int) -> bool:
        x = subs.get(pid)
        return x is not None and x[0] <= di and (x[1] is None or di < x[1])

    by_pid = {p.pid: p for p in people}
    dm_index = {(r["kst_date"], r["channel1"], r["device_platform"], r["member_seg"]): r for r in out["daily_metrics"]}
    for r in out["daily_metrics"]:
        r["subscribers"] = 0
        r["sub_payers"] = 0
    for (pid, d), f in list(pd_flags.items()):
        di = (d - from_date).days
        if sub_on(pid, di):
            pd_flags[(pid, d)] = f | PD["subscribed"]
            p = by_pid[pid]
            row = dm_index[(d.isoformat(), p.channel1, p.platform, p.seg(d))]
            row["subscribers"] += 1
            s0 = subs[pid][0]
            if (di - s0) % 30 == 0:
                row["sub_payers"] += 1

    # 매출(일 × 종류)
    rev: dict[tuple, dict] = defaultdict(lambda: defaultdict(int))
    payers_t: dict[tuple, set[int]] = defaultdict(set)
    sub_pay: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0])
    sub_payers: dict[int, set[int]] = defaultdict(set)
    v_events: dict[int, int] = defaultdict(int)
    v_amount: dict[int, int] = defaultdict(int)
    for d, pid, vid, amount in payments:
        di = (d - from_date).days
        partner = partner_on(vid, di)
        sub = sub_on(pid, di)
        disc = round(amount * 0.15) if (partner and sub) else 0
        refund = amount - disc if rng.random() < 0.03 else 0
        r = rev[(di, "ticket", partner)]
        r["pay_count"] += 1
        r["gross_amount"] += amount
        r["discount_amount"] += disc
        r["refund_amount"] += refund
        r["net_amount"] += amount - disc - refund
        payers_t[(di, partner)].add(pid)
        v_amount[vid] += amount - disc
        if sub:
            sub_pay[di][0] += amount - disc
            sub_payers[di].add(pid)
    for e in events:
        v_events[e["venue_id"]] += 1
    for (di, partner), ps in payers_t.items():
        rev[(di, "ticket", partner)]["payers"] = len(ps)

    ds = lambda i: (from_date + timedelta(days=i)).isoformat()  # noqa: E731
    subs_rows = []
    for di in range(n_days):
        active = sum(1 for s0, e in subs.values() if s0 <= di and (e is None or di < e))
        new = sum(1 for s0, _ in subs.values() if s0 == di)
        churned = sum(1 for _, e in subs.values() if e == di)
        billed = [pid for pid, (s0, e) in subs.items() if di >= s0 and (di - s0) % 30 == 0 and (e is None or di < e)]
        if billed:
            r = rev[(di, "subscription", None)]
            r["pay_count"] = r["payers"] = len(billed)
            r["gross_amount"] = r["net_amount"] = len(billed) * SUB_PRICE
        d = from_date + timedelta(days=di)
        dim = (date(d.year + d.month // 12, d.month % 12 + 1, 1) - d.replace(day=1)).days
        act = [c for c in contracts if c["start"] <= di and (c["end"] is None or di < c["end"])]
        if act:
            r = rev[(di, "b2b", None)]
            r["pay_count"] = r["payers"] = len(act)
            r["gross_amount"] = r["net_amount"] = round(sum(c["fee"] for c in act) / dim)
        subs_rows.append(
            {
                "kst_date": ds(di),
                "active_subscribers": active,
                "new_subscribers": new,
                "churned_subscribers": churned,
                "mrr": active * SUB_PRICE,
                "subscriber_ticket_payers": len(sub_payers[di]),
                "subscriber_ticket_amount": sub_pay[di][0],
            }
        )
    kinds = ["ticket", "subscription", "b2b"]
    out["daily_revenue"] = [
        {
            "kst_date": ds(k[0]),
            "kind": k[1],
            "partner_flag": k[2],
            **{
                c: v.get(c, 0)
                for c in ["pay_count", "gross_amount", "discount_amount", "refund_amount", "net_amount", "payers"]
            },
        }
        for k, v in sorted(rev.items(), key=lambda kv: (kv[0][0], kinds.index(kv[0][1]), not kv[0][2]))
    ]
    out["daily_subscription"] = subs_rows

    regions = [r["name"] for r in REGIONS]
    dvr = []
    for di in range(n_days):
        for rg in regions:
            vs = [v for v in reg if v["region"] == rg]
            ids = {v["venue_id"] for v in vs}
            cs = [c for c in contracts if c["venue_id"] in ids]
            act = [c for c in cs if c["start"] <= di and (c["end"] is None or di < c["end"])]
            dvr.append(
                {
                    "kst_date": ds(di),
                    "region": rg,
                    "registered_total": sum(1 for v in vs if v["registered_day"] <= di),
                    "partner_total": len(act),
                    "new_registered": sum(1 for v in vs if v["registered_day"] == di),
                    "new_contracts": sum(1 for c in cs if c["start"] == di),
                    "churned_contracts": sum(1 for c in cs if c["end"] == di),
                    "mrr_basic": sum(c["fee"] for c in act if c["plan"] == "basic"),
                    "mrr_pro": sum(c["fee"] for c in act if c["plan"] == "pro"),
                }
            )
    out["daily_venue_registry"] = dvr

    last = n_days - 1
    views28: dict[int, int] = defaultdict(int)
    for r in out["daily_venue"]:
        if r["kst_date"] > ds(last - 28):
            views28[r["venue_id"]] += r["detail_viewers"]
    out["venue_registry"] = []
    for v in reg:
        if v["registered_day"] > last:
            continue
        c = by_venue.get(v["venue_id"])
        partner = partner_on(v["venue_id"], last)
        base = views28.get(v["venue_id"], 0)
        synth = int(v["pop"] * (2.2 if partner else 1.0) * 4)
        out["venue_registry"].append(
            {
                "venue_id": v["venue_id"],
                "name": v["name"],
                "region": v["region"],
                "district": v["district"],
                "lat": v["lat"],
                "lng": v["lng"],
                "genre": v["genre"],
                "venue_type": v["venue_type"],
                "capacity_band": v["capacity_band"],
                "registered_at": ds(v["registered_day"]),
                "is_partner": partner,
                "plan": c["plan"] if c else None,
                "contract_started_at": ds(c["start"]) if c else None,
                "contract_ended_at": ds(c["end"]) if c and c["end"] is not None else None,
                "events_365d": v_events.get(v["venue_id"], 0),
                "ticket_amount_365d": v_amount.get(v["venue_id"], 0),
                "detail_viewers_28d": base * 6 + synth,
                "status": "closed" if rng.random() < 0.02 else "active",
                "as_of_date": ds(last),
            }
        )

    by_month: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r in out["daily_revenue"]:
        by_month[r["kst_date"][:7]][r["kind"]] += r["net_amount"]
    eom: dict[str, int] = {}
    for i in range(n_days):
        eom[ds(i)[:7]] = i
    for row in out["monthly_summary"]:
        m = row["month"]
        i = eom[m]
        row["ticket_amount"] = by_month[m]["ticket"]
        row["subscription_amount"] = by_month[m]["subscription"]
        row["b2b_amount"] = by_month[m]["b2b"]
        row["active_subscribers_eom"] = subs_rows[i]["active_subscribers"]
        day_rows = [r for r in dvr if r["kst_date"] == ds(i)]
        row["partner_total_eom"] = sum(r["partner_total"] for r in day_rows)
        row["registered_total_eom"] = sum(r["registered_total"] for r in day_rows)

    codes = {"c": ["non_paid", "paid"], "p": ["android", "ios", "web"], "m": ["guest", "member"]}
    rows = []
    for (pid, d), f in sorted(pd_flags.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        p = by_pid[pid]
        rows.append(
            [
                pid,
                (d - from_date).days,
                codes["c"].index(p.channel1),
                codes["p"].index(p.platform),
                codes["m"].index(p.seg(d)),
                f,
            ]
        )
    out["person_day"] = {
        "base_date": from_date.isoformat(),
        "cols": ["pk", "d", "c", "p", "m", "f"],
        "codes": codes,
        "rows": rows,
    }


def main() -> None:
    """CLI 진입점."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, default=20260923)
    ap.add_argument("--to-date", default="2026-09-20")
    ap.add_argument("--weeks", type=int, default=52)
    ap.add_argument("--persons", type=int, default=3500)
    ap.add_argument("--out", default="/tmp/placewave_sample_data.json")
    a = ap.parse_args()
    data = build(a.seed, date.fromisoformat(a.to_date), a.weeks, a.persons)
    path = Path(a.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{path} {path.stat().st_size / 1e6:.1f}MB")
    for k, v in data["meta"]["tables"].items():
        print(f"  {k:16s} {v:>7,d}")


if __name__ == "__main__":
    main()
