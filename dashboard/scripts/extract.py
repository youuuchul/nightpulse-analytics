"""BigQuery 마트 → dashboard/public/data.json 추출기.

marts 데이터셋의 표 14개를 개인 GCP 래퍼(scripts/bq.sh)로 읽어 data.json 계약 모양으로 쓴다.
조회는 SELECT 뿐이며 표를 만들거나 바꾸지 않는다. 마트가 적재된 뒤에 실행한다.

    uv run dashboard/scripts/extract.py --out dashboard/public/data.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import UTC, date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BQ = ROOT / "scripts" / "bq.sh"
DATASET = "marts"

SEG = ["channel1", "device_platform", "member_seg"]

# 표 이름 → (열 목록, 정렬 열). 열 이름은 docs/architecture.md §2 marts 와 docs/dashboard.md 계약을 따른다.
TABLES: dict[str, tuple[list[str], list[str]]] = {
    "daily_metrics": (
        [
            "kst_date",
            *SEG,
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
        ],
        ["kst_date"],
    ),
    "hourly_metrics": (
        ["kst_date", "kst_hour", *SEG, "persons", "sessions", "applies", "pay_count"],
        ["kst_date", "kst_hour"],
    ),
    "daily_channel": (
        [
            "kst_date",
            "channel1",
            "channel2",
            "channel3",
            "device_platform",
            "member_seg",
            "sessions",
            "persons",
            "new_persons",
            "signups",
            "applies",
            "payers",
            "pay_amount",
        ],
        ["kst_date"],
    ),
    "daily_ad": (
        [
            "kst_date",
            "campaign_id",
            "campaign_name",
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
        ],
        ["kst_date", "campaign_id"],
    ),
    "daily_event": (
        [
            "kst_date",
            "event_id",
            "event_name",
            "venue_name",
            "event_type",
            "price_tier",
            "detail_viewers",
            "applies",
            "pay_count",
            "pay_amount",
            "cancels",
        ],
        ["kst_date", "event_id"],
    ),
    "daily_venue": (
        ["kst_date", "venue_id", "venue_name", "region", "genre", "detail_viewers", "applies", "pay_count"],
        ["kst_date", "venue_id"],
    ),
    "funnel_daily": (["kst_date", "step", *SEG, "persons"], ["kst_date"]),
    "weekly_cohort": (
        ["cohort_week", "week_offset", *SEG, "cohort_size", "retained"],
        ["cohort_week", "week_offset"],
    ),
    "monthly_cohort": (
        ["cohort_month", "month_offset", "member_seg", "cohort_size", "retained"],
        ["cohort_month", "month_offset"],
    ),
    "weekly_activity": (
        ["week_start", *SEG, "wau", "new_persons", "returning_persons", "two_plus_days"],
        ["week_start"],
    ),
    "weekly_audience_funnel": (
        ["week_start", "audience_id", "step", *SEG, "persons"],
        ["week_start", "audience_id"],
    ),
    "weekly_path": (
        ["week_start", *SEG, "step", "from_screen", "to_screen", "sessions"],
        ["week_start", "step"],
    ),
    "monthly_summary": (
        [
            "month",
            "persons",
            "new_persons",
            "signups",
            "applies",
            "pay_count",
            "pay_amount",
            "cancels",
            "w1_retention",
            "top_channel",
        ],
        ["month"],
    ),
}

STRING_COLS = {
    "kst_date",
    "cohort_week",
    "week_start",
    "cohort_month",
    "month",
    "step",
    "channel1",
    "channel2",
    "channel3",
    "device_platform",
    "member_seg",
    "campaign_id",
    "campaign_name",
    "event_name",
    "venue_name",
    "event_type",
    "price_tier",
    "region",
    "genre",
    "top_channel",
    "audience_id",
    "from_screen",
    "to_screen",
}
FLOAT_COLS = {"w1_retention"}
MONTH_COLS = {"cohort_month", "month"}
# 표마다 타입이 다른 열: weekly_path.step 은 정수 1~4 (funnel_daily.step 은 문자열)
INT_OVERRIDE: dict[str, set[str]] = {"weekly_path": {"step"}}


def query(sql: str) -> list[dict]:
    """bq.sh 래퍼로 SELECT 를 실행하고 JSON 행을 돌려준다.

    Args:
        sql: 표준 SQL SELECT 문.

    Returns:
        행 목록. bq JSON 출력은 모든 값을 문자열로 준다.
    """
    res = subprocess.run(
        [str(BQ), "query", "--format=json", "--max_rows=2000000", "--quiet", sql],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(res.stdout or "[]")


def coerce(col: str, value: str | None, table: str = "") -> object:
    """bq 문자열 값을 계약 타입으로 바꾼다.

    Args:
        col: 열 이름.
        value: bq 가 준 값.
        table: 표 이름. INT_OVERRIDE 판정에 쓴다.

    Returns:
        문자열·정수·실수 또는 None.
    """
    if value is None:
        return None
    if col in INT_OVERRIDE.get(table, set()):
        return int(value)
    if col in MONTH_COLS:
        return str(value)[:7]
    if col in STRING_COLS:
        return str(value)
    if col in FLOAT_COLS:
        return float(value)
    return int(value)


def person_day() -> dict:
    """marts.person_day 를 열 배열 형식으로 압축한다.

    d 는 base_date 로부터의 일수, c·p·m 은 codes 의 인덱스, f 는 플래그 비트 정수다.

    Returns:
        {"base_date", "cols", "codes", "rows"} 사전.
    """
    rows = query(
        "SELECT CAST(kst_date AS STRING) AS kst_date, person_key, channel1, device_platform, member_seg, flags "
        f"FROM {DATASET}.person_day ORDER BY kst_date, person_key"
    )
    if not rows:
        raise SystemExit("person_day 가 비어 있다 — 마트 적재를 먼저 확인")
    codes = {
        "c": sorted({r["channel1"] for r in rows}),
        "p": sorted({r["device_platform"] for r in rows}),
        "m": sorted({r["member_seg"] for r in rows}),
    }
    idx = {k: {v: i for i, v in enumerate(vs)} for k, vs in codes.items()}
    base = date.fromisoformat(rows[0]["kst_date"])
    packed = [
        [
            int(r["person_key"]),
            (date.fromisoformat(r["kst_date"]) - base).days,
            idx["c"][r["channel1"]],
            idx["p"][r["device_platform"]],
            idx["m"][r["member_seg"]],
            int(r["flags"]),
        ]
        for r in rows
    ]
    return {"base_date": base.isoformat(), "cols": ["pk", "d", "c", "p", "m", "f"], "codes": codes, "rows": packed}


def main() -> None:
    """마트를 읽어 data.json 을 쓴다."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(ROOT / "dashboard" / "public" / "data.json"))
    a = ap.parse_args()

    out: dict[str, object] = {}
    for table, (cols, order) in TABLES.items():
        ints = INT_OVERRIDE.get(table, set())
        select = ", ".join(f"CAST({c} AS STRING) AS {c}" if c in STRING_COLS and c not in ints else c for c in cols)
        sql = f"SELECT {select} FROM {DATASET}.{table} ORDER BY {', '.join(order)}"
        rows = query(sql)
        out[table] = [{c: coerce(c, r.get(c), table) for c in cols} for r in rows]
        print(f"{table:22s} {len(out[table]):>8,d}")

    out["person_day"] = person_day()
    pd_bytes = len(json.dumps(out["person_day"], separators=(",", ":")))
    print(f"{'person_day':22s} {len(out['person_day']['rows']):>8,d}  {pd_bytes / 1e6:.2f}MB")

    dates = [r["kst_date"] for r in out["daily_metrics"]]
    if not dates:
        raise SystemExit("daily_metrics 가 비어 있다 — 마트 적재를 먼저 확인")
    meta = {
        "to_date": max(dates),
        "from_date": min(dates),
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": "bigquery",
        "tables": {k: len(v["rows"]) if isinstance(v, dict) else len(v) for k, v in out.items()},
    }
    path = Path(a.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"meta": meta, **out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{path} {path.stat().st_size / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
