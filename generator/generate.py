"""NightPulse 합성 데이터 생성기.

가상 서비스 NightPulse 의 GA4 export 형태 이벤트 로그와 서비스 원장(회원·공간·행사·신청·결제·광고비)을
한 루프에서 함께 만든다. 입력은 `generator/seed/` 의 분포 파일(비율·분위수·전이 확률)뿐이며,
절대 규모는 CLI 인자로 새로 정한다. 실제 서비스 데이터가 아니다.

실행:
    uv run generator/generate.py --seed 20260923 --weeks 52 --persons 80000 \
        --end-date 2026-09-20 --out data/
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import logging
import math
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger("nightpulse.generate")

SEED_DIR = Path(__file__).resolve().parent / "seed"
KST = timezone(timedelta(hours=9))

CHAIN_SCREENS = [
    "home",
    "map_main",
    "search_main",
    "search_result",
    "venue_detail",
    "venue_review",
    "event_detail",
    "event_apply",
]
END = "(end)"
KEY_EVENTS = {"sign_up", "apply_event", "purchase", "share", "cancel_apply"}

# 시나리오 4구간: (시작 주, 끝 주, 신규 유입 가중, 재방문 배수, 신청 전환 배수, 주당 행사 수)
PHASES = [
    ("launch", 1, 10, None, 0.85, 0.9, 3),
    ("ads", 11, 24, 0.85, 0.8, 0.9, 4),
    ("stable", 25, 40, 0.9, 1.15, 1.0, 5),
    ("peak", 41, 52, 1.2, 1.25, 1.3, 7),
]
# 월별 계절 계수 (KST 월)
SEASON = {1: 0.85, 2: 0.85, 3: 0.95, 4: 1.0, 5: 1.05, 6: 1.05, 7: 1.15, 8: 1.2, 9: 1.0, 10: 1.05, 11: 0.95, 12: 1.2}

RETURN_BASE = 0.025  # 일반층 재방문 일 확률 척도
CASUAL_SIGMA = 0.5  # 일반층 재방문 성향의 개인차 (로그정규 sigma). 클수록 생존 편향으로 긴 꼬리가 두꺼워진다
CASUAL_TAIL = (0.5, 0.3, 0.2, 0.1)  # seed 곡선 W2·W4·8주·이후 바닥에 곱하는 보정 (개인차 생존 편향 상쇄)
CORE_SHARE = (0.15, 0.08)  # 단골층 비중 (비광고, 광고 유입). W4 이후 리텐션의 바닥을 만든다
CORE_DAILY = 0.55  # 단골층 일 방문 확률 척도. 전체 규모 보정용 손잡이
CORE_LIFE_WEEKS = 35.0  # 단골 유지 기간 평균(지수분포). 이후는 일반층 곡선의 바닥값을 따른다
CORE_SESSIONS_PER_DAY = ([1, 2, 3, 4], [0.4, 0.3, 0.2, 0.1])  # 단골층 방문일의 세션 수
POPULARITY_TEMPER = 0.6  # seed 조회 집중도 지수 완화 (1위 행사 쏠림이 주 단위 지표를 흔들지 않게)
DOW_OUTLIER = 1.5  # 요일 합이 중앙값의 이 배수를 넘으면 seed 이상치로 본다
PAID_NEW_SHARE = 0.45  # 광고 유입 세션 중 신규 사람 비중
AD_SESSION_RATIO = 0.8  # 광고 유입 세션 / 클릭 기본값. 캠페인별로 0.6~0.9 에서 흔든다 (랜딩 이탈·추적 누락)
AD_BUDGET_SCALE = 70.0  # names.json 캠페인 일 예산 배수. 집행 구간 광고 세션 비중 보정용 (persons 규모에 비례)
SIGNUP_INTENT = (0.5, 0.09)  # 가입 의향 비중 (단골층, 일반층). 실현 가입률은 방문 횟수에 따라 더 낮다
SECOND_DEVICE = 0.5  # 가입 의향자 중 2번째 기기 보유 비중 (실현 비중은 가입 후 재방문에 달림)
DEVICE2_USE = 0.5  # 가입 이후 방문에서 2번째 기기를 쓸 확률
CANCEL_PER_SESSION = 0.012  # 보유 신청 1건당 이후 세션에서 취소할 확률
PAY_SUCCESS = 0.66  # 유료 행사 신청 후 결제 완료 비율
APPLY_MULT = 2.2  # 신청 화면 도달 후 신청 확률 = seed 단계 비율 x 구간 배수 x 이 값
PROMO_SELECT = 0.3  # 배너 노출 대비 선택 비율
SESSIONS_PER_DAY = ([1, 2, 3], [0.93, 0.05, 0.02])


# ---------------------------------------------------------------- seed 로드


def _read_csv(name: str) -> list[dict[str, str]]:
    with open(SEED_DIR / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


@dataclass
class Seed:
    """seed 분포 묶음."""

    hour_cdf: np.ndarray  # [7, 24] 요일별 시(KST) 누적분포
    dow_weight: np.ndarray  # [7] 요일 가중 (평균 1)
    quantiles: dict[str, tuple[np.ndarray, np.ndarray]]
    shares: dict[str, float]
    device_platform: dict[str, float]
    organic_channels: list[tuple[str, str, str]]  # (source, medium, campaign)
    organic_weights: np.ndarray
    ad_ratio: dict[str, float]
    retention_shape: dict[int, float]  # 주 오프셋 -> W1 대비 비율
    event_reach: dict[str, tuple[float, float]]  # seed 이벤트명 -> (session_reach, per_session)
    screen_seed_share: dict[str, float]  # 출력 화면 -> seed 화면 비중 합
    funnel: dict[str, float]
    event_popularity: np.ndarray
    venue_popularity: np.ndarray
    region_share: np.ndarray
    genre_share: np.ndarray
    free_share: float
    chain: dict[str, tuple[list[str], np.ndarray]]
    names: dict[str, Any]


def _collapse_chain() -> dict[str, tuple[list[str], np.ndarray]]:
    """seed 전이 확률을 출력 화면 사이의 전이로 접는다.

    비화면 이벤트와 범위 밖 화면(`(other_screen)`)·결제 화면은 통과 노드로 두고, 흡수 마르코프 연쇄로
    '다음에 처음 닿는 출력 화면 또는 종료' 확률을 푼다. 상위 전이만 있는 행은 행 합으로 재정규화한다.

    Returns:
        출력 화면(및 `(start)`) -> (다음 상태 목록, 확률).
    """
    rows = _read_csv("transitions.csv")
    nodes = sorted({r["from_node"] for r in rows} | {r["to_node"] for r in rows} | {END})
    idx = {n: i for i, n in enumerate(nodes)}
    n = len(nodes)
    p = np.zeros((n, n))
    mass = np.zeros(n)
    for r in rows:
        p[idx[r["from_node"]], idx[r["to_node"]]] += float(r["prob"])
        mass[idx[r["from_node"]]] = float(r["from_share"])
    for i in range(n):
        s = p[i].sum()
        if s == 0:
            p[i, idx[END]] = 1.0
        else:
            p[i] /= s

    def target(node: str) -> str | None:
        if node == END:
            return END
        if node.startswith("screen_view:"):
            out = node.split(":", 1)[1]
            if out in CHAIN_SCREENS:
                return out
        return None

    targets = CHAIN_SCREENS + [END]
    tpos = {t: k for k, t in enumerate(targets)}
    absorbing = {i: tpos[t] for i, node in enumerate(nodes) if (t := target(node)) is not None}
    trans = [i for i in range(n) if i not in absorbing]
    q = p[np.ix_(trans, trans)]
    r = np.zeros((len(trans), len(targets)))
    for a, k in absorbing.items():
        r[:, k] += p[trans, a]
    h_trans = np.linalg.solve(np.eye(len(trans)) - q, r)
    hit = np.zeros((n, len(targets)))
    for pos, i in enumerate(trans):
        hit[i] = h_trans[pos]
    for a, k in absorbing.items():
        hit[a, k] = 1.0

    chain: dict[str, tuple[list[str], np.ndarray]] = {}
    sources: dict[str, list[int]] = {s: [] for s in CHAIN_SCREENS}
    for i, node in enumerate(nodes):
        t = target(node)
        if t in sources:
            sources[t].append(i)
    for s, members in sources.items():
        w = np.array([max(mass[i], 1e-9) for i in members])
        dist = (w[:, None] * (p[members] @ hit)).sum(axis=0) / w.sum()
        chain[s] = (targets, dist / dist.sum())
    start = p[idx["(start)"]] @ hit
    start[tpos[END]] = 0.0  # 랜딩은 항상 화면이 있다. 화면 없는 세션은 자동 로드로 따로 만든다
    chain["(start)"] = (targets, start / start.sum())
    return chain


def load_seed() -> Seed:
    """seed 디렉터리의 분포 파일을 읽어 생성기 입력으로 변환한다.

    Returns:
        Seed 묶음.
    """
    names = json.loads((SEED_DIR / "names.json").read_text(encoding="utf-8"))

    tp = np.zeros((7, 24))
    for r in _read_csv("time_pattern.csv"):
        tp[int(r["dow_iso"]) - 1, int(r["hour_kst"])] = float(r["session_share"])
    dow_total = tp.sum(axis=1)
    # seed 창(8주)의 단발 급증 요일은 매주 반복되지 않게 정상 요일 평균으로 바꾼다
    med = float(np.median(dow_total))
    outlier = dow_total > med * DOW_OUTLIER
    if outlier.any():
        normal = tp[~outlier] / dow_total[~outlier, None]
        tp[outlier] = normal.mean(axis=0) * med
        dow_total = tp.sum(axis=1)
    hour_cdf = np.cumsum(tp / dow_total[:, None], axis=1)

    quantiles: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    shares: dict[str, float] = {}
    device_platform: dict[str, float] = {}
    qp = {"p10": 0.10, "p25": 0.25, "p50": 0.50, "p75": 0.75, "p90": 0.90, "p99": 0.99}
    tmp: dict[str, list[tuple[float, float]]] = {}
    for r in _read_csv("session_shape.csv"):
        if r["key"] in qp:
            tmp.setdefault(r["metric"], []).append((qp[r["key"]], float(r["value"])))
        elif r["metric"] == "share_device_platform":
            device_platform[r["key"]] = float(r["value"])
        else:
            shares[r["metric"]] = float(r["value"])
    for m, pts in tmp.items():
        pts.sort()
        quantiles[m] = (np.array([p for p, _ in pts]), np.array([v for _, v in pts]))
    device_platform.pop("unknown", None)

    medium_of = {
        "social": "social",
        "influencer": "influencer",
        "search": "organic",
        "referral": "referral",
        "store": "referral",
        "ai": "referral",
    }
    organic: dict[tuple[str, str, str], float] = {}
    ad_ratio: dict[str, float] = {}
    for r in _read_csv("channel_mix.csv"):
        if r["kind"] == "ad_ratio":
            ad_ratio[r["metric"]] = float(r["value"])
            continue
        if r["metric"] != "session_share" or r["channel1"] != "non_paid":
            continue
        c2, c3 = r["channel2"], r["channel3"]
        if c2 == "internal" or c3 in ("unknown", "other"):
            continue
        if c2 == "direct":
            key = ("(direct)", "(none)", "(direct)")
        else:
            med = medium_of[c2]
            camp = {"organic": "(organic)", "referral": "(referral)"}.get(med, "(not set)")
            key = (c3, med, camp)
        organic[key] = organic.get(key, 0.0) + float(r["value"])
    organic_channels = sorted(organic)
    ow = np.array([organic[k] for k in organic_channels])

    ret = {}
    for r in _read_csv("retention.csv"):
        if r["scope"] == "overall" and r["basis"] == "member":
            ret[int(r["week_offset"])] = float(r["retention_rate"])
    retention_shape = {k: v / ret[1] for k, v in ret.items()}

    event_reach = {
        r["event_name"]: (float(r["session_reach"]), float(r["per_session_when_present"]))
        for r in _read_csv("event_mix.csv")
    }

    screen_seed_share = {r["screen_name"]: float(r["screen_view_share"]) for r in _read_csv("screen_mix.csv")}

    funnel = {r["step_key"]: float(r["rate_of_prev"] or r["rate_of_landing"]) for r in _read_csv("funnel_steps.csv")}

    pop_e = np.array([float(r["view_share"]) for r in _read_csv("popularity.csv") if r["entity"] == "event"])
    pop_v = np.array([float(r["view_share"]) for r in _read_csv("popularity.csv") if r["entity"] == "venue"])

    nm = _read_csv("name_map.csv")
    regions = sorted(
        (float(r["share"]) for r in nm if r["kind"] == "venue_region" and r["value"] != "(기타)"), reverse=True
    )
    region_share = np.array(regions[: len(names["regions"])])
    genres = sorted(
        (float(r["share"]) for r in nm if r["kind"] == "venue_genre_ga" and r["value"] not in ("MIX", "(unset)")),
        reverse=True,
    )
    genre_share = np.array(genres[: len(names["genres"])])
    free_share = next(float(r["share"]) for r in nm if r["kind"] == "event_pay_type" and r["value"] == "free")

    return Seed(
        hour_cdf=hour_cdf,
        dow_weight=dow_total / dow_total.mean(),
        quantiles=quantiles,
        shares=shares,
        device_platform=device_platform,
        organic_channels=organic_channels,
        organic_weights=ow / ow.sum(),
        ad_ratio=ad_ratio,
        retention_shape=retention_shape,
        event_reach=event_reach,
        screen_seed_share=screen_seed_share,
        funnel=funnel,
        event_popularity=pop_e**POPULARITY_TEMPER / (pop_e**POPULARITY_TEMPER).sum(),
        venue_popularity=pop_v[:60] / pop_v[:60].sum(),
        region_share=region_share / region_share.sum(),
        genre_share=genre_share / genre_share.sum(),
        free_share=free_share,
        chain=_collapse_chain(),
        names=names,
    )


# ---------------------------------------------------------------- 도메인 객체


@dataclass
class Venue:
    """공간 원장 1행."""

    venue_id: int
    name: str
    region: int
    genre: int
    capacity_band: str
    weight: float


@dataclass
class EventItem:
    """행사 원장 1행."""

    event_id: int
    venue_id: int
    name: str
    event_type: str
    starts_at: int  # UTC epoch 초
    publish_at: int
    genre: int
    price_tier: str
    price: int
    weight: float


@dataclass
class Device:
    """기기(client_id) 상태."""

    client_id: str
    category: str
    os: str
    platform: str
    session_number: int = 0
    user_id: str | None = None


@dataclass
class Person:
    """사람 상태. 생성기 안에서만 존재하고 출력에는 client_id·user_id 로만 드러난다."""

    pid: int
    first_day: int
    first_channel: tuple[str, str, str, str]  # source, medium, campaign, content
    region: int
    genres: list[int]
    will_signup: bool
    signup_visit: int
    has_dev2: bool
    devices: list[Device] = field(default_factory=list)
    member_id: str | None = None
    marketing_opt_in: bool = False
    applied_events: set[int] = field(default_factory=set)
    open_apps: list[dict[str, Any]] = field(default_factory=list)


# ---------------------------------------------------------------- 생성기


class Generator:
    """합성 세계 전체를 만드는 상태 기계."""

    def __init__(self, seed: Seed, rng_seed: int, weeks: int, persons: int, end_date: date) -> None:
        """생성기를 초기화한다.

        Args:
            seed: seed 분포 묶음.
            rng_seed: 난수 시드.
            weeks: 기간(주). 마지막 날은 end_date.
            persons: 사람 수.
            end_date: 마지막 날(KST).
        """
        self.s = seed
        self.rng = np.random.default_rng(rng_seed)
        self.weeks = weeks
        self.n_days = weeks * 7
        self.n_persons = persons
        self.start_date = end_date - timedelta(days=self.n_days - 1)
        self.end_date = end_date
        self.day0 = int(
            datetime(self.start_date.year, self.start_date.month, self.start_date.day, tzinfo=KST).timestamp()
        )
        self.range_end = self.day0 + self.n_days * 86400
        self.host = seed.names["service"]["host"]
        self.phase_of_day = [self._phase(d // 7 + 1) for d in range(self.n_days)]
        self.ledger: dict[str, list[dict[str, Any]]] = {
            k: [] for k in ("members", "venues", "events_master", "applications", "payments", "ad_spend")
        }
        self.order_seq = 0
        self.member_seq = 0
        self.rows = 0
        self.venue_by_id: dict[int, Venue] = {}

    # ---- 공통 도우미

    def _phase(self, week: int) -> tuple[str, float | None, float, float, int]:
        for name, a, b, arrive, ret, conv, per_week in PHASES:
            if a <= week <= b:
                return name, arrive, ret, conv, per_week
        return PHASES[-1][0], PHASES[-1][3], PHASES[-1][4], PHASES[-1][5], PHASES[-1][6]

    def _day_date(self, d: int) -> date:
        return self.start_date + timedelta(days=d)

    def _season(self, d: int) -> float:
        return SEASON[self._day_date(d).month]

    def _dow(self, d: int) -> int:
        return self._day_date(d).isoweekday() - 1

    def _quantile(self, metric: str, u: float) -> float:
        probs, vals = self.s.quantiles[metric]
        xp = np.concatenate([[0.0], probs, [1.0]])
        fp = np.concatenate([[max(0.0, vals[0] * 0.5)], vals, [vals[-1] * 1.5]])
        return float(np.interp(u, xp, fp))

    def _choice(self, weights: np.ndarray) -> int:
        return int(self.rng.choice(len(weights), p=weights / weights.sum()))

    # ---- 카탈로그

    def build_catalog(self) -> None:
        """공간 60곳과 행사 목록을 만든다."""
        nm = self.s.names
        rng = self.rng
        self.venues: list[Venue] = []
        pop = rng.permutation(self.s.venue_popularity)
        for i, name in enumerate(nm["venues"]):
            v = Venue(
                venue_id=101 + i,
                name=name,
                region=self._choice(self.s.region_share),
                genre=self._choice(self.s.genre_share),
                capacity_band=str(rng.choice(nm["capacity_bands"], p=nm["capacity_band_weights"])),
                weight=float(pop[i]),
            )
            self.venues.append(v)
            self.venue_by_id[v.venue_id] = v
            self.ledger["venues"].append(
                {
                    "venue_id": v.venue_id,
                    "name": v.name,
                    "region": nm["regions"][v.region],
                    "genre": nm["genres"][v.genre],
                    "capacity_band": v.capacity_band,
                }
            )
        vw = np.array([v.weight for v in self.venues])

        dow_start = np.array([0.03, 0.03, 0.05, 0.12, 0.33, 0.37, 0.07])
        self.events: list[EventItem] = []
        venue_count: dict[int, int] = {}
        eid = 5001
        for w in range(1, self.weeks + 1):
            per_week = self._phase(w)[4]
            k = int(rng.integers(per_week - 1, per_week + 2))
            for j in range(k):
                if w == self.weeks and j == 0:
                    d = self.n_days - 1  # 관측 마지막 날에도 신청 가능한 행사를 보장한다
                else:
                    d = (w - 1) * 7 + self._choice(dow_start)
                d_date = self._day_date(d)
                hour = int(rng.choice([20, 21, 22, 23], p=[0.25, 0.3, 0.3, 0.15]))
                starts = self.day0 + d * 86400 + hour * 3600
                venue = self.venues[self._choice(vw)]
                genre = venue.genre if rng.random() < 0.7 else self._choice(self.s.genre_share)
                etype = str(rng.choice(nm["event_types"], p=nm["event_type_weights"]))
                venue_count[venue.venue_id] = venue_count.get(venue.venue_id, 0) + 1
                name = str(rng.choice(nm["event_name_templates"])).format(
                    venue=venue.name,
                    genre=nm["genres"][genre],
                    n=venue_count[venue.venue_id],
                    season=nm["seasons"][str(d_date.month)],
                    etype=etype,
                    region=nm["regions"][venue.region],
                )
                r = rng.random()
                paid_share = 1 - self.s.free_share
                if r < self.s.free_share:
                    tier, price = "free", 0
                elif r < self.s.free_share + paid_share * 0.7:
                    tier, price = "standard", int(rng.integers(15, 26)) * 1000
                else:
                    tier, price = "premium", int(rng.integers(8, 13)) * 5000
                lead = int(rng.integers(10, 29))
                ev = EventItem(
                    eid,
                    venue.venue_id,
                    name,
                    etype,
                    starts,
                    starts - lead * 86400,
                    genre,
                    tier,
                    price,
                    float(rng.choice(self.s.event_popularity)) * (1.6 if self._phase(w)[0] == "peak" else 1),
                )
                self.events.append(ev)
                self.ledger["events_master"].append(
                    {
                        "event_id": ev.event_id,
                        "venue_id": ev.venue_id,
                        "name": ev.name,
                        "event_type": etype,
                        "starts_at": _ts(ev.starts_at),
                        "price_tier": tier,
                        "price": price,
                    }
                )
                eid += 1
        # 날짜별 노출 중인 행사 목록 (공개 ~ 시작 시각)
        self.listed: list[np.ndarray] = []
        starts_arr = np.array([e.starts_at for e in self.events])
        pub_arr = np.array([e.publish_at for e in self.events])
        for d in range(self.n_days):
            t = self.day0 + d * 86400 + 43200
            ids = np.nonzero((pub_arr <= t) & (starts_arr > t - 43200))[0]
            if len(ids) == 0:
                ids = np.argsort(np.abs(starts_arr - t))[:3]
            self.listed.append(ids)
        self.venue_weights = vw / vw.sum()

    # ---- 광고 계획

    def build_ads(self) -> None:
        """캠페인별 일 집행(노출·클릭·광고비)과 기대 유입 세션 수를 만든다."""
        rng = self.rng
        ar = self.s.ad_ratio
        self.ad_sessions = np.zeros(self.n_days)
        self.ad_campaign_of_day: list[list[tuple[int, float]]] = [[] for _ in range(self.n_days)]
        for ci, c in enumerate(self.s.names["campaigns"]):
            cpm = float(rng.uniform(5500, 8500))
            session_ratio = float(np.clip(rng.normal(AD_SESSION_RATIO, 0.08), 0.6, 0.9))
            for d in range((c["start_week"] - 1) * 7, min(c["end_week"] * 7, self.n_days)):
                dow_mult = 1.15 if self._dow(d) >= 4 else 0.95
                budget = c["daily_budget"] * AD_BUDGET_SCALE * float(rng.uniform(0.85, 1.15)) * dow_mult
                imp = int(budget / cpm * 1000)
                link = int(rng.binomial(imp, ar["link_click_rate_per_impression"]))
                other = int(
                    rng.binomial(imp, max(ar["ctr_clicks_per_impression"] - ar["link_click_rate_per_impression"], 0))
                )
                spend = int(round(budget))
                exp_sessions = (link + other) * session_ratio
                self.ad_sessions[d] += exp_sessions
                self.ad_campaign_of_day[d].append((ci, exp_sessions))
                self.ledger["ad_spend"].append(
                    {
                        "date": self._day_date(d).isoformat(),
                        "campaign_id": c["campaign_id"],
                        "campaign_name": c["name"],
                        "spend": spend,
                        "impressions": imp,
                        "clicks": link + other,
                    }
                )

    def _paid_channel(self, d: int) -> tuple[str, str, str, str]:
        camps = self.ad_campaign_of_day[d]
        w = np.array([x[1] for x in camps]) + 1e-9
        c = self.s.names["campaigns"][camps[self._choice(w)][0]]
        src = c["source"] if self.rng.random() < 0.92 else ("facebook" if c["source"] == "instagram" else "instagram")
        return src, "paid_social", c["campaign_id"], str(self.rng.choice(self.s.names["creatives"]))

    def _organic_channel(self) -> tuple[str, str, str, str]:
        src, med, camp = self.s.organic_channels[self._choice(self.s.organic_weights)]
        return src, med, camp, "(not set)"

    # ---- 사람과 방문 일정

    def build_people(self) -> None:
        """사람 목록·첫 방문일·방문 일정을 만든다 (날짜 단위 벡터 연산)."""
        rng = self.rng
        n_days = self.n_days
        # 광고 신규 유입
        paid_new = rng.poisson(self.ad_sessions * PAID_NEW_SHARE)
        n_paid = int(paid_new.sum())
        n_org = self.n_persons - n_paid
        if n_org <= 0:
            raise ValueError("광고 유입이 사람 수를 넘는다")
        arrive = np.zeros(n_days)
        for d in range(n_days):
            name, a, *_ = self.phase_of_day[d]
            week = d // 7 + 1
            base = 0.35 + 0.45 * (week - 1) / 9 if name == "launch" else a
            arrive[d] = base * self._season(d) * self.s.dow_weight[self._dow(d)]
        # 매일 최소 1명은 첫 방문하게 하고 나머지를 가중 추첨 (런칭 초기 빈 날 방지)
        org_days = np.concatenate([np.arange(n_days), rng.choice(n_days, size=n_org - n_days, p=arrive / arrive.sum())])
        firsts: list[tuple[int, bool]] = [(int(d), False) for d in org_days]
        for d in range(n_days):
            firsts.extend([(d, True)] * int(paid_new[d]))
        firsts.sort()

        platforms = list(self.s.device_platform)
        pw = np.array([self.s.device_platform[k] for k in platforms])
        self.people: list[Person] = []
        core = np.array([rng.random() < CORE_SHARE[1 if is_paid else 0] for _, is_paid in firsts])
        for pid, (d, is_paid) in enumerate(firsts):
            ch = self._paid_channel(d) if is_paid else self._organic_channel()
            will = rng.random() < SIGNUP_INTENT[0 if core[pid] else 1]
            k = int(rng.geometric(0.45))
            genres = sorted({self._choice(self.s.genre_share) for _ in range(int(rng.integers(1, 4)))})
            p = Person(
                pid, d, ch, self._choice(self.s.region_share), genres, will, k, will and rng.random() < SECOND_DEVICE
            )
            plat = platforms[self._choice(pw)]
            p.devices.append(self._new_device(plat, d))
            if p.has_dev2:
                plat2 = (
                    "desktop"
                    if plat != "desktop" and rng.random() < 0.5
                    else (
                        "ios" if plat == "android" else "android" if plat == "ios" else platforms[self._choice(pw[:2])]
                    )
                )
                p.devices.append(self._new_device(plat2, d))
            self.people.append(p)

        # 방문 일정: 날짜 루프, 사람 벡터
        n = len(self.people)
        first = np.array([p.first_day for p in self.people])
        paid_person = np.array([p.first_channel[1] == "paid_social" for p in self.people])
        prop = rng.lognormal(mean=-(CASUAL_SIGMA**2) / 2, sigma=CASUAL_SIGMA, size=n)
        prop[paid_person] *= 0.6
        core_prop = rng.lognormal(mean=-0.045, sigma=0.3, size=n)
        core_until = first + rng.exponential(CORE_LIFE_WEEKS * 7, size=n)
        k_signup = np.array([p.signup_visit if p.will_signup else 10**6 for p in self.people])
        visits = np.zeros(n, dtype=int)
        member_from = np.full(n, 10**6)
        shape = self.s.retention_shape
        wk = np.array([0, 1, 2, 4, 8, 60])
        tail = CASUAL_TAIL
        hv = np.array([1.6, 1.0, shape[2] * tail[0], shape[4] * tail[1], shape[4] * tail[2], shape[4] * tail[3]])
        self.visit_days: list[list[int]] = [[] for _ in range(n)]
        self.core = core
        self.core_until = core_until
        for d in range(n_days):
            _, _, ret_mult, _, _ = self.phase_of_day[d]
            t_weeks = (d - first) / 7.0
            h = np.interp(t_weeks, wk, hv)
            boost = np.where(member_from < d, 1.8, 1.0)
            day_mult = ret_mult * self._season(d) * self.s.dow_weight[self._dow(d)]
            is_core = core & (d < core_until)
            prob = np.where(is_core, CORE_DAILY * core_prop, RETURN_BASE * prop * h * boost) * day_mult
            prob = np.clip(prob, 0, 0.9)
            draw = rng.random(n) < prob
            draw &= first < d
            draw |= first == d
            idx = np.nonzero(draw)[0]
            visits[idx] += 1
            newly = idx[visits[idx] == k_signup[idx]]
            member_from[newly] = d
            for i in idx:
                self.visit_days[i].append(d)

        # 기존 방문자 세션 중 광고 재유입 비중 (날짜별)
        returning = np.zeros(n_days)
        for days in self.visit_days:
            for d in days[1:]:
                returning[d] += 1
        target = self.ad_sessions * (1 - PAID_NEW_SHARE)
        self.paid_return_p = np.minimum(0.5, target / np.maximum(returning, 1))

    def _new_device(self, platform: str, d: int) -> Device:
        cat = "desktop" if platform == "desktop" else "mobile"
        os_name = {"ios": "iOS", "android": "Android"}.get(platform) or str(
            self.rng.choice(["Windows", "Macintosh"], p=[0.55, 0.45])
        )
        first_ts = self.day0 + d * 86400 + int(self.rng.integers(0, 86400))
        cid = f"{int(self.rng.integers(10**9, 10**10))}.{first_ts}"
        return Device(cid, cat, os_name, platform)

    # ---- 세션·이벤트

    def run(self, out_events: Path) -> None:
        """사람별로 시간순 세션을 만들고 이벤트를 gzip NDJSON 으로 쓴다.

        Args:
            out_events: 출력 경로(.ndjson.gz).
        """
        out_events.parent.mkdir(parents=True, exist_ok=True)
        auto_share = self.s.shares["share_auto_load"]
        with open(out_events, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz:
            for p in self.people:
                sessions = self._plan_sessions(p, auto_share)
                for kind, start, dev_i, channel in sessions:
                    rows = (
                        self._auto_session(p, dev_i, start)
                        if kind == "auto"
                        else self._session(p, dev_i, start, channel)
                    )
                    buf = "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows)
                    gz.write(buf.encode("utf-8"))
                    self.rows += len(rows)

    def _plan_sessions(self, p: Person, auto_share: float) -> list[tuple[str, int, int, tuple | None]]:
        """사람의 전체 세션 일정(종류·시작 시각·기기·채널)을 시간순으로 만든다."""
        rng = self.rng
        plan: list[tuple[str, int, int, tuple | None]] = []
        days = self.visit_days[p.pid]
        for vi, d in enumerate(days):
            spd = CORE_SESSIONS_PER_DAY if self.core[p.pid] and d < self.core_until[p.pid] else SESSIONS_PER_DAY
            n_sess = int(rng.choice(spd[0], p=spd[1]))
            dow = self._dow(d)
            starts = sorted(
                int(
                    self.day0
                    + d * 86400
                    + np.searchsorted(self.s.hour_cdf[dow], rng.random()) * 3600
                    + rng.integers(0, 3600)
                )
                for _ in range(n_sess)
            )
            for si, st in enumerate(starts):
                if vi == 0 and si == 0:
                    ch = p.first_channel
                elif si == 0 and rng.random() < self.paid_return_p[d] and self.ad_campaign_of_day[d]:
                    ch = self._paid_channel(d)
                elif rng.random() < 0.55:
                    ch = ("(direct)", "(none)", "(direct)", "(not set)")
                else:
                    ch = self._organic_channel()
                plan.append(("visit", st, 0, ch))
        # 자동 로드 세션: 첫 방문 이후 임의 날짜
        n_auto = int(rng.poisson(len(plan) * auto_share / (1 - auto_share)))
        for _ in range(n_auto):
            d = int(rng.integers(p.first_day, self.n_days))
            st = self.day0 + d * 86400 + int(rng.integers(0, 86400))
            plan.append(("auto", st, 0, None))
        plan.sort(key=lambda x: x[1])
        # 첫 세션은 항상 방문 세션 (자동 로드는 기존 기기에서만)
        while plan and plan[0][0] == "auto":
            plan.pop(0)
        # 시각 겹침 정리 (세션 사이 최소 31분)
        out: list[tuple[str, int, int, tuple | None]] = []
        last = -(10**12)
        for kind, st, dev_i, ch in plan:
            st = max(st, last + 1860)
            if st >= self.range_end:
                continue
            out.append((kind, st, dev_i, ch))
            last = st + 600
        return out

    def _pick_event(self, t: int, p: Person) -> EventItem:
        d = min(max((t - self.day0) // 86400, 0), self.n_days - 1)
        ids = self.listed[d]
        w = np.array(
            [
                self.events[i].weight
                * (2.0 if self.events[i].genre in p.genres else 1.0)
                * (1.0 + 2.0 * math.exp(-max(self.events[i].starts_at - t, 0) / (5 * 86400)))
                for i in ids
            ]
        )
        return self.events[int(ids[self._choice(w)])]

    def _pick_venue(self) -> Venue:
        return self.venues[self._choice(self.venue_weights)]

    def _session(self, p: Person, dev_i: int, start: int, channel: tuple) -> list[dict[str, Any]]:
        """방문 세션 1개의 이벤트 행을 만든다. 신청·결제·취소·가입 원장도 여기서 함께 쓴다."""
        rng = self.rng
        s = self.s
        d = (start - self.day0) // 86400
        conv = self.phase_of_day[d][3]
        is_paid = channel[1] == "paid_social"
        # 기기 선택: 가입 후 2번째 기기 사용
        if p.member_id and len(p.devices) > 1 and rng.random() < DEVICE2_USE:
            dev_i = 1
        dev = p.devices[dev_i]
        dev.session_number += 1
        start_user = dev.user_id
        first_session = dev.session_number == 1
        visit_no = len([x for x in self.visit_days[p.pid] if x <= d])
        signup_now = p.will_signup and p.member_id is None and visit_no >= p.signup_visit

        steps: list[tuple[str, dict[str, Any]]] = []  # (이벤트명, 속성)
        ctx: dict[str, Any] = {"event": None, "venue": None}
        user_id = dev.user_id

        def screen(name: str, **kw: Any) -> None:
            steps.append(("screen_view", {"screen": name, **kw}))
            if name in ("event_detail", "venue_detail") and rng.random() < 0.012:
                steps.append(("share", {"screen": name, **kw}))
            if rng.random() < ue_p:
                steps.append(("user_engagement", {"screen": name, **kw}))

        ue_p = min(0.9, s.event_reach["user_engagement"][0] * 0.55)

        def view_event(ev: EventItem | None = None) -> None:
            ev = ev or self._pick_event(start, p)
            ctx["event"] = ev
            ctx["venue"] = self.venue_by_id[ev.venue_id]
            screen("event_detail", event=ev)

        def view_venue() -> None:
            ev = ctx["event"]
            if ev is not None and rng.random() < 0.7:
                v = self.venue_by_id[ev.venue_id]
            else:
                v = self._pick_venue()
            ctx["venue"] = v
            screen("venue_detail", venue=v)

        def do_signup() -> None:
            nonlocal user_id
            screen("login")
            screen("taste_setup")
            self.member_seq += 1
            p.member_id = f"m{self.member_seq:06d}"
            p.marketing_opt_in = bool(rng.random() < 0.55)
            for dv in p.devices[:1]:
                dv.user_id = p.member_id
            dev.user_id = p.member_id
            user_id = p.member_id
            steps.append(
                (
                    "sign_up",
                    {
                        "screen": "taste_setup",
                        "set_user": p.member_id,
                        "method": str(rng.choice(s.names["signup_methods"], p=s.names["signup_method_weights"])),
                    },
                )
            )

        def do_login() -> None:
            nonlocal user_id
            screen("login")
            dev.user_id = p.member_id
            user_id = p.member_id
            steps.append(
                (
                    "login",
                    {
                        "screen": "login",
                        "set_user": p.member_id,
                        "method": str(rng.choice(s.names["signup_methods"], p=s.names["signup_method_weights"])),
                    },
                )
            )

        # 세션 시작
        if first_session:
            steps.append(("first_visit", {}))
        steps.append(("session_start", {}))
        land_targets, land_p = s.chain["(start)"]
        landing = "event_detail" if is_paid else land_targets[self._choice(land_p)]
        if rng.random() < s.event_reach["page_view"][0]:
            steps.append(("page_view", {"landing": landing}))
        cur = landing
        if landing == "event_detail":
            view_event()
        elif landing == "venue_detail":
            view_venue()
        elif landing == "search_result":
            steps.append(("search", {"term": self._search_term()}))
            screen("search_result")
        elif landing == "event_apply":
            ctx["event"] = self._pick_event(start, p)
            screen("event_apply", event=ctx["event"])
        elif landing == "venue_review":
            ctx["venue"] = self._pick_venue()
            screen("venue_review", venue=ctx["venue"])
        else:
            screen(landing)
        if p.member_id and user_id is None:
            land_step = next(a for e, a in steps if e == "screen_view")
            do_login()
            steps.append(("screen_view", dict(land_step)))

        def promotion(p_view: float) -> bool:
            if rng.random() >= p_view:
                return False
            promo = self._pick_event(start, p)
            steps.append(("view_promotion", {"screen": cur, "event": promo}))
            if rng.random() < PROMO_SELECT:
                steps.append(("select_promotion", {"screen": cur, "event": promo}))
                view_event(promo)
                return True
            return False

        if promotion(s.event_reach["view_promotion"][0]):
            cur = "event_detail"

        # 신청 보유 회원의 취소
        if p.member_id and user_id and p.open_apps:
            for app in list(p.open_apps):
                if app["starts_at"] > start and rng.random() < CANCEL_PER_SESSION:
                    view_event(app["ev"])
                    self._cancel(app, start)
                    p.open_apps.remove(app)
                    steps.append(
                        (
                            "cancel_apply",
                            {
                                "screen": "event_detail",
                                "event": app["ev"],
                                "order_id": app["order_id"],
                                "value": app["refund"],
                            },
                        )
                    )
                    cur = "event_detail"
                    break
                if app["starts_at"] <= start:
                    p.open_apps.remove(app)

        bounce = 0.45 if is_paid else 0.0
        applied_in_session = False
        max_steps = 60
        while max_steps > 0:
            max_steps -= 1
            if bounce and rng.random() < bounce:
                break
            bounce = 0.0
            targets, probs = s.chain[cur]
            nxt = targets[self._choice(probs)]
            if nxt == END:
                break
            if nxt == "event_detail":
                ev_keep = ctx["event"] if ctx["event"] is not None and rng.random() < 0.3 else None
                if cur == "venue_detail" and ctx["venue"] is not None and rng.random() < 0.5:
                    vid = ctx["venue"].venue_id
                    at_venue = [e for e in (self.events[i] for i in self.listed[d]) if e.venue_id == vid]
                    if at_venue:
                        ev_keep = at_venue[int(rng.integers(len(at_venue)))]
                view_event(ev_keep)
            elif nxt == "venue_detail":
                view_venue()
            elif nxt == "venue_review":
                if ctx["venue"] is None:
                    ctx["venue"] = self._pick_venue()
                screen("venue_review", venue=ctx["venue"])
            elif nxt == "search_result":
                steps.append(("search", {"term": self._search_term()}))
                screen("search_result")
            elif nxt == "event_apply":
                ev = ctx["event"] or self._pick_event(start, p)
                ctx["event"] = ev
                if user_id is None:
                    if p.member_id:
                        do_login()
                    elif signup_now:
                        do_signup()
                        signup_now = False
                    else:
                        screen("login")
                        if rng.random() < 0.8:
                            cur = "login"
                            break
                        view_event(ev)
                        cur = "event_detail"
                        continue
                screen("event_apply", event=ev)
                if (
                    not applied_in_session
                    and ev.event_id not in p.applied_events
                    and ev.starts_at > start
                    and rng.random() < min(0.95, s.funnel["applied"] * conv * APPLY_MULT)
                ):
                    self._apply(p, ev, steps, start)
                    applied_in_session = True
                    if rng.random() < 0.6:
                        cur = "payment_success"
                        break
                    view_event(ev)
                    nxt = "event_detail"
            else:
                screen(nxt)
                if nxt == "home" and promotion(0.5):
                    nxt = "event_detail"
            cur = nxt
        if signup_now:
            do_signup()
            screen("home")

        return self._emit(p, dev, start, channel, steps, is_paid, start_user)

    def _search_term(self) -> str:
        nm = self.s.names
        r = self.rng.random()
        if r < 0.4:
            return str(self.rng.choice(nm["genres"], p=self.s.genre_share))
        if r < 0.65:
            return str(self.rng.choice(nm["regions"], p=self.s.region_share))
        if r < 0.8:
            return str(self.rng.choice(nm["event_types"]))
        return self._pick_venue().name.split(" ")[0]

    def _apply(self, p: Person, ev: EventItem, steps: list, start: int) -> None:
        """신청(+결제) 단계를 steps 에 넣는다. 원장 행은 _emit 에서 시각이 정해진 뒤 쓴다."""
        rng = self.rng
        self.order_seq += 1
        oid = f"o{self.order_seq:07d}"
        p.applied_events.add(ev.event_id)
        app = {"order_id": oid, "ev": ev, "starts_at": ev.starts_at, "refund": 0, "status": "applied"}
        steps.append(
            (
                "apply_event",
                {"screen": "event_apply", "event": ev, "order_id": oid, "value": ev.price, "ledger_app": app},
            )
        )
        if ev.price > 0:
            steps.append(("screen_view", {"screen": "payment_confirm", "event": ev}))
            if rng.random() < PAY_SUCCESS:
                method = str(rng.choice(self.s.names["payment_methods"], p=self.s.names["payment_method_weights"]))
                app["status"] = "paid"
                app["refund"] = ev.price
                steps.append(
                    (
                        "purchase",
                        {
                            "screen": "payment_confirm",
                            "event": ev,
                            "order_id": oid,
                            "value": ev.price,
                            "method": method,
                            "ledger_pay": app,
                        },
                    )
                )
                steps.append(("screen_view", {"screen": "payment_success", "event": ev}))
            else:
                app["status"] = "payment_pending"
        if app["status"] != "payment_pending":
            p.open_apps.append(app)

    def _cancel(self, app: dict[str, Any], t: int) -> None:
        app["cancel_pending"] = t

    def _auto_session(self, p: Person, dev_i: int, start: int) -> list[dict[str, Any]]:
        dev = p.devices[dev_i]
        dev.session_number += 1
        steps = [("session_start", {}), ("screen_view", {"screen": "home"})]
        return self._emit(
            p, dev, start, ("(direct)", "(none)", "(direct)", "(not set)"), steps, False, dev.user_id, auto=True
        )

    # ---- 행 직렬화

    def _page(self, screen: str, kw: dict[str, Any]) -> tuple[str, str]:
        ev: EventItem | None = kw.get("event")
        v: Venue | None = kw.get("venue")
        h = f"https://{self.host}"
        paths = {
            "home": ("/", "NightPulse"),
            "map_main": ("/map", "지도 | NightPulse"),
            "search_main": ("/search", "검색 | NightPulse"),
            "search_result": ("/search/results", "검색 결과 | NightPulse"),
            "login": ("/login", "로그인 | NightPulse"),
            "taste_setup": ("/taste", "취향 설정 | NightPulse"),
        }
        if screen in paths:
            path, title = paths[screen]
        elif screen in ("venue_detail", "venue_review") and v is not None:
            path = f"/venue/{v.venue_id}" + ("/reviews" if screen == "venue_review" else "")
            title = f"{v.name} | NightPulse"
        elif ev is not None:
            suffix = {
                "event_detail": "",
                "event_apply": "/apply",
                "payment_confirm": "/payment",
                "payment_success": "/payment/success",
            }.get(screen, "")
            path = f"/event/{ev.event_id}{suffix}"
            title = f"{ev.name} | NightPulse"
        else:
            path, title = "/", "NightPulse"
        return h + path, title

    def _emit(
        self,
        p: Person,
        dev: Device,
        start: int,
        channel: tuple,
        steps: list,
        is_paid: bool,
        start_user: str | None,
        auto: bool = False,
    ) -> list[dict[str, Any]]:
        """steps 를 시각·체류·세션 속성이 붙은 이벤트 행으로 바꾸고 원장 행을 쓴다."""
        rng = self.rng
        n = len(steps)
        n_screens = sum(1 for e, _ in steps if e == "screen_view")
        if auto:
            span_s, eng_ms = float(rng.uniform(0, 1.5)), 0
        else:
            lo, hi = _band(n_screens, *self.s.quantiles["screen_views_per_session"])
            u = float(rng.uniform(lo, hi))
            span_s = max(1.0, self._quantile("span_sec_per_session", u) * float(rng.lognormal(0, 0.3)))
            eng_ms = int(
                min(self._quantile("engagement_ms_per_session", u) * float(rng.lognormal(0, 0.3)), span_s * 1000)
            )
            if is_paid:
                eng_ms = int(eng_ms * 0.6)
        if start + span_s >= self.range_end:
            # 세션 시작 시각(따라서 시(hour))은 유지하고 길이만 줄여 관측 마지막 날 경계 밖으로 새지 않게 한다
            span_s = max(1.0, self.range_end - start - 2)
            eng_ms = min(eng_ms, int(span_s * 1000))
        # 시각: 랜딩까지는 거의 동시, 이후는 구간 안 정렬 균등
        head = 0
        for e, _ in steps:
            head += 1
            if e == "screen_view":
                break
        offsets = (
            np.concatenate([np.arange(head) * 0.001, np.sort(rng.uniform(0.002, span_s, size=n - head))])
            if n > head
            else np.arange(n) * 0.001
        )
        base_us = start * 1_000_000
        ts = [base_us + int(o * 1_000_000) + i for i, o in enumerate(offsets)]
        # 체류: screen_view(랜딩 이후)·user_engagement 에 배분
        elig = [i for i, (e, a) in enumerate(steps) if e == "user_engagement" or (e == "screen_view" and i >= head)]
        eng = [0] * n
        if eng_ms > 0:
            if not elig:
                elig = [head - 1]
            parts = rng.dirichlet(np.ones(len(elig))) * eng_ms
            for i, v in zip(elig, parts, strict=True):
                eng[i] = int(v)
        key = any(e in KEY_EVENTS for e, _ in steps)
        engaged = "1" if (not auto and (eng_ms >= 10000 or n_screens >= 2 or key)) else "0"

        sid = start
        snum = dev.session_number
        src, med, camp, content = channel
        first_ch = "paid" if p.first_channel[1] == "paid_social" else "non_paid"
        uprops = [
            {"key": "first_channel", "string_value": first_ch},
            {"key": "device_platform", "string_value": dev.platform},
        ]
        rows: list[dict[str, Any]] = []
        user_id = start_user
        cur_screen = "home"
        cur_kw: dict[str, Any] = {}
        for i, (e, a) in enumerate(steps):
            if "set_user" in a:
                user_id = a["set_user"]
            if e == "screen_view":
                cur_screen = a["screen"]
                cur_kw = a
            elif e in ("session_start", "first_visit", "page_view") and i < head:
                land = next((x for x in steps if x[0] == "screen_view"), ("", {"screen": "home"}))[1]
                cur_screen, cur_kw = land["screen"], land
            loc, title = self._page(cur_screen, cur_kw)
            params: list[dict[str, Any]] = []
            if e == "screen_view":
                params.append(_sp("screen_name", cur_screen))
            ev: EventItem | None = a.get("event")
            if ev is not None and e != "page_view":
                params.append(_ip("event_id", ev.event_id))
            vn: Venue | None = a.get("venue")
            if vn is not None and e != "page_view":
                params.append(_ip("venue_id", vn.venue_id))
            if e == "search":
                params.append(_sp("search_term", a["term"]))
            if e in ("view_promotion", "select_promotion"):
                params.append(_sp("promotion_id", f"home_banner_{ev.event_id}"))
            if e == "share":
                params.append(_sp("content_type", "event" if ev is not None else "venue"))
                params.append(_sp("method", str(rng.choice(["link", "sns"], p=[0.6, 0.4]))))
            if e in ("sign_up", "login"):
                params.append(_sp("method", a["method"]))
            if e in ("apply_event", "purchase", "cancel_apply"):
                params.append(_sp("order_id", a["order_id"]))
                params.append(_ip("value", int(a["value"])))
                params.append(_sp("currency", "KRW"))
                params.append(_sp("price_tier", ev.price_tier))
            if e == "purchase":
                params.append(_sp("payment_method", a["method"]))
            t_us = ts[i]
            rows.append(
                {
                    "event_date": datetime.fromtimestamp(t_us // 1_000_000, KST).strftime("%Y-%m-%d"),
                    "event_timestamp": t_us,
                    "event_name": e,
                    "user_pseudo_id": dev.client_id,
                    "user_id": user_id,
                    "ga_session_id": sid,
                    "ga_session_number": snum,
                    "engagement_time_msec": eng[i],
                    "page_location": loc,
                    "page_title": title,
                    "session_engaged": engaged,
                    "device_category": dev.category,
                    "operating_system": dev.os,
                    "traffic_source": {"source": src, "medium": med, "campaign": camp, "content": content},
                    "user_properties": uprops,
                    "event_params": params,
                }
            )
            # 원장
            if e == "apply_event":
                app = a["ledger_app"]
                app["applied_ts"] = t_us // 1_000_000
                app["member_id"] = user_id
                self.ledger["applications"].append(app)
            elif e == "purchase":
                self.ledger["payments"].append(
                    {
                        "order_id": a["order_id"],
                        "amount": int(a["value"]),
                        "paid_at": _ts(t_us // 1_000_000),
                        "status": "paid",
                        "method": a["method"],
                        "_app": a["ledger_pay"],
                    }
                )
            elif e == "cancel_apply":
                app = next(x for x in self.ledger["applications"] if x["order_id"] == a["order_id"])
                app["canceled_ts"] = t_us // 1_000_000
            elif e == "sign_up":
                self.ledger["members"].append(
                    {
                        "member_id": user_id,
                        "signed_up_at": _ts(t_us // 1_000_000),
                        "region": self.s.names["regions"][p.region],
                        "genre_tags": "|".join(self.s.names["genres"][g] for g in p.genres),
                        "marketing_opt_in": str(p.marketing_opt_in).lower(),
                    }
                )
        return rows

    # ---- 원장 마감

    def finalize_ledgers(self) -> None:
        """신청·결제 원장의 최종 상태(취소 반영)를 확정한다."""
        apps = []
        for app in self.ledger["applications"]:
            canceled = "canceled_ts" in app
            apps.append(
                {
                    "order_id": app["order_id"],
                    "event_id": app["ev"].event_id,
                    "member_id": app["member_id"],
                    "applied_at": _ts(app["applied_ts"]),
                    "status": "canceled" if canceled else app["status"],
                    "cancel_at": _ts(app["canceled_ts"]) if canceled else "",
                    "cancel_amount": app["refund"] if canceled else 0,
                }
            )
        self.ledger["applications"] = apps
        pays = []
        for pay in self.ledger["payments"]:
            app = pay.pop("_app")
            if "canceled_ts" in app:
                pay["status"] = "refunded"
            pays.append(pay)
        self.ledger["payments"] = pays


# ---------------------------------------------------------------- 유틸


def _ts(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sp(key: str, value: str) -> dict[str, Any]:
    return {"key": key, "string_value": value, "int_value": None}


def _ip(key: str, value: int) -> dict[str, Any]:
    return {"key": key, "string_value": None, "int_value": int(value)}


def _band(n: int, probs: np.ndarray, vals: np.ndarray) -> tuple[float, float]:
    """관측값 n 이 seed 분위수 표에서 차지하는 누적확률 구간을 돌려준다."""
    lo = max([0.0] + [float(p) for p, v in zip(probs, vals, strict=True) if v < n])
    hi = min([1.0] + [float(p) for p, v in zip(probs, vals, strict=True) if v > n])
    return lo, max(hi, lo + 1e-3)


OUTPUT_FILES = {
    "members": "db_members",
    "venues": "db_venues",
    "events_master": "db_events",
    "applications": "db_applications",
    "payments": "db_payments",
    "ad_spend": "ads_spend",
}
EVENTS_FILE = "ga4_events.ndjson.gz"

LEDGER_COLUMNS = {
    "members": ["member_id", "signed_up_at", "region", "genre_tags", "marketing_opt_in"],
    "venues": ["venue_id", "name", "region", "genre", "capacity_band"],
    "events_master": ["event_id", "venue_id", "name", "event_type", "starts_at", "price_tier", "price"],
    "applications": ["order_id", "event_id", "member_id", "applied_at", "status", "cancel_at", "cancel_amount"],
    "payments": ["order_id", "amount", "paid_at", "status", "method"],
    "ad_spend": ["date", "campaign_id", "campaign_name", "spend", "impressions", "clicks"],
}


def write_ledgers(g: Generator, raw_dir: Path) -> None:
    """원장 6종을 CSV 로 쓴다. 서비스 RDB 스냅샷(db_*)에는 snapshot_date 열을 붙인다.

    Args:
        g: 실행이 끝난 생성기.
        raw_dir: 출력 디렉터리.
    """
    snapshot = g.end_date.isoformat()
    for name, cols in LEDGER_COLUMNS.items():
        rows = g.ledger[name]
        if name in ("members", "applications", "payments"):
            rows = sorted(rows, key=lambda r: r[cols[0]])
        out_name = OUTPUT_FILES[name]
        is_db = out_name.startswith("db_")
        fields = cols + ["snapshot_date"] if is_db else cols
        with open(raw_dir / f"{out_name}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
            w.writeheader()
            for r in rows:
                row = {c: r[c] for c in cols}
                if is_db:
                    row["snapshot_date"] = snapshot
                w.writerow(row)


def write_manifest(out: Path, seed: int, args: argparse.Namespace, elapsed: float) -> None:
    """data/MANIFEST.txt 에 파일별 행 수·SHA256·seed·생성 시각을 쓴다.

    Args:
        out: 출력 루트(data/).
        seed: 난수 시드.
        args: CLI 인자.
        elapsed: 생성 소요 초.
    """
    lines = [
        "# NightPulse 합성 데이터 MANIFEST (실제 서비스 데이터 아님)",
        f"seed: {seed}",
        f"args: weeks={args.weeks} persons={args.persons} end_date={args.end_date}",
        f"generated_at_utc: {datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')}",
        f"elapsed_sec: {elapsed:.1f}",
        "",
        "file\trows\tsha256",
    ]
    for f in sorted((out / "raw").iterdir()):
        h = hashlib.sha256(f.read_bytes()).hexdigest()
        if f.suffix == ".gz":
            with gzip.open(f, "rt", encoding="utf-8") as fh:
                rows = sum(1 for _ in fh)
        else:
            with open(f, encoding="utf-8") as fh:
                rows = sum(1 for _ in fh) - 1
        lines.append(f"raw/{f.name}\t{rows}\t{h}")
    (out / "MANIFEST.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    """CLI 진입점."""
    ap = argparse.ArgumentParser(description="NightPulse 합성 데이터 생성기")
    ap.add_argument("--seed", type=int, default=20260923)
    ap.add_argument("--weeks", type=int, default=52)
    ap.add_argument("--persons", type=int, default=8000)
    ap.add_argument("--end-date", type=date.fromisoformat, default=date(2026, 9, 20))
    ap.add_argument("--out", type=Path, default=Path("data"))
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    t0 = time.time()
    seed = load_seed()
    g = Generator(seed, args.seed, args.weeks, args.persons, args.end_date)
    g.build_catalog()
    g.build_ads()
    g.build_people()
    logger.info("사람 %d명, 행사 %d건, 방문일 %d", len(g.people), len(g.events), sum(map(len, g.visit_days)))
    raw_dir = args.out / "raw"
    g.run(raw_dir / EVENTS_FILE)
    g.finalize_ledgers()
    write_ledgers(g, raw_dir)
    elapsed = time.time() - t0
    write_manifest(args.out, args.seed, args, elapsed)
    logger.info("이벤트 %d행, %.1f초", g.rows, elapsed)


if __name__ == "__main__":
    main()
