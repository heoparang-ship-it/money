"""
시스템 테스트 스크립트
====================
Flask 앱과 실제 DB 모델을 사용하여 핵심 로직을 검증한다.

테스트 항목:
  1. 광고주 신규 등록 시 중복 방지
  2. 광고주 이름 변경 시 업데이트
  3. DailySpend upsert (동일 조건이면 update, 다르면 insert)
  4. 다른 사용자가 같은 광고주를 사용해도 충돌 없음
  5. _build_chart_data 헬퍼가 올바른 구조를 반환
"""

import sys
import os
import traceback
from datetime import date

# 앱 임포트
from app import app, db, _build_chart_data
from models import User, Advertiser, Upload, DailySpend

# ── 테스트용 상수 ─────────────────────────────────────────────────
TEST_PREFIX = "__TEST__"  # 테스트 데이터 식별용 접두어


def _test_user(username, display_name):
    """테스트용 User 객체를 생성한다."""
    u = User(username=username, display_name=display_name, is_admin=False)
    u.set_password("testpass")
    return u


def _test_upload(user_id, filename="test.xlsx", records_count=0):
    """테스트용 Upload 객체를 생성한다."""
    return Upload(user_id=user_id, filename=filename, records_count=records_count)


# ── 클린업 ─────────────────────────────────────────────────────────

def cleanup():
    """TEST_PREFIX로 시작하는 모든 테스트 데이터를 삭제한다."""
    # 테스트 사용자 ID 목록
    test_users = User.query.filter(User.username.like(f"{TEST_PREFIX}%")).all()
    test_user_ids = [u.id for u in test_users]

    # 테스트 광고주 ID 목록
    test_advertisers = Advertiser.query.filter(
        Advertiser.advertiser_id.like(f"{TEST_PREFIX}%")
    ).all()
    test_adv_ids = [a.advertiser_id for a in test_advertisers]

    # DailySpend 삭제 (테스트 사용자 또는 테스트 광고주 관련)
    if test_user_ids:
        DailySpend.query.filter(DailySpend.user_id.in_(test_user_ids)).delete(
            synchronize_session=False
        )
    if test_adv_ids:
        DailySpend.query.filter(DailySpend.advertiser_id.in_(test_adv_ids)).delete(
            synchronize_session=False
        )

    # Upload 삭제
    if test_user_ids:
        Upload.query.filter(Upload.user_id.in_(test_user_ids)).delete(
            synchronize_session=False
        )

    # Advertiser 삭제
    for a in test_advertisers:
        db.session.delete(a)

    # User 삭제
    for u in test_users:
        db.session.delete(u)

    db.session.commit()


# ── 테스트 함수 ────────────────────────────────────────────────────

def test_advertiser_no_duplicates():
    """
    테스트 1: 동일한 advertiser_id로 두 번 등록해도 중복이 생기지 않는다.
    업로드 로직과 동일하게 '먼저 조회 -> 없으면 생성' 패턴을 재현한다.
    """
    adv_id = f"{TEST_PREFIX}ADV_DUP_001"

    # 첫 번째 등록
    adv = Advertiser.query.filter_by(advertiser_id=adv_id).first()
    if not adv:
        adv = Advertiser(advertiser_id=adv_id, account_id="A100", name="광고주A")
        db.session.add(adv)
        db.session.flush()

    # 두 번째 등록 시도 (같은 패턴)
    adv2 = Advertiser.query.filter_by(advertiser_id=adv_id).first()
    if not adv2:
        adv2 = Advertiser(advertiser_id=adv_id, account_id="A100", name="광고주A")
        db.session.add(adv2)
        db.session.flush()

    db.session.commit()

    # 검증: 해당 advertiser_id로 조회하면 정확히 1건
    count = Advertiser.query.filter_by(advertiser_id=adv_id).count()
    assert count == 1, f"Expected 1 advertiser, got {count}"

    return True


def test_advertiser_name_update():
    """
    테스트 2: 광고주 이름이 변경된 경우 기존 레코드가 업데이트된다.
    """
    adv_id = f"{TEST_PREFIX}ADV_NAME_001"

    # 초기 등록
    adv = Advertiser(advertiser_id=adv_id, account_id="A200", name="원래이름")
    db.session.add(adv)
    db.session.commit()

    # 업로드 로직 재현: 이미 존재하면 이름 업데이트
    existing = Advertiser.query.filter_by(advertiser_id=adv_id).first()
    assert existing is not None, "Advertiser should exist"

    new_name = "변경된이름"
    if existing.name != new_name:
        existing.name = new_name
    db.session.commit()

    # 검증
    updated = Advertiser.query.filter_by(advertiser_id=adv_id).first()
    assert updated.name == new_name, f"Expected '{new_name}', got '{updated.name}'"

    # account_id 업데이트도 확인
    new_account = "A201"
    if updated.account_id != new_account:
        updated.account_id = new_account
    db.session.commit()

    refreshed = Advertiser.query.filter_by(advertiser_id=adv_id).first()
    assert refreshed.account_id == new_account, (
        f"Expected account_id '{new_account}', got '{refreshed.account_id}'"
    )

    return True


def test_daily_spend_upsert():
    """
    테스트 3: 동일한 (user_id, advertiser_id, date, media) 조합이면
    기존 레코드를 업데이트하고, 다른 조합이면 새 레코드를 생성한다.
    """
    # 준비: 사용자, 광고주, 업로드
    user = _test_user(f"{TEST_PREFIX}USR_UPSERT", "테스터_UPSERT")
    db.session.add(user)
    db.session.flush()

    adv_id = f"{TEST_PREFIX}ADV_UPSERT_001"
    adv = Advertiser(advertiser_id=adv_id, account_id="A300", name="Upsert광고주")
    db.session.add(adv)
    db.session.flush()

    upload1 = _test_upload(user.id, "upload1.xlsx", 1)
    db.session.add(upload1)
    db.session.flush()

    # 첫 번째 소진액 등록
    spend_date = date(2026, 3, 1)
    media = "네이버"
    spend = DailySpend(
        user_id=user.id,
        advertiser_id=adv_id,
        date=spend_date,
        media=media,
        amount=10000,
        upload_id=upload1.id,
    )
    db.session.add(spend)
    db.session.commit()

    initial_count = DailySpend.query.filter_by(
        user_id=user.id, advertiser_id=adv_id, date=spend_date, media=media
    ).count()
    assert initial_count == 1, f"Expected 1 spend record, got {initial_count}"

    # 동일 조건으로 재업로드 (upsert 로직 재현)
    upload2 = _test_upload(user.id, "upload2.xlsx", 1)
    db.session.add(upload2)
    db.session.flush()

    existing = DailySpend.query.filter_by(
        user_id=user.id,
        advertiser_id=adv_id,
        date=spend_date,
        media=media,
    ).first()

    if existing:
        existing.amount = 20000  # 금액 업데이트
        existing.upload_id = upload2.id
    else:
        new_spend = DailySpend(
            user_id=user.id,
            advertiser_id=adv_id,
            date=spend_date,
            media=media,
            amount=20000,
            upload_id=upload2.id,
        )
        db.session.add(new_spend)

    db.session.commit()

    # 검증: 여전히 1건, 금액은 20000
    after_count = DailySpend.query.filter_by(
        user_id=user.id, advertiser_id=adv_id, date=spend_date, media=media
    ).count()
    assert after_count == 1, f"Expected 1 spend record after upsert, got {after_count}"

    updated = DailySpend.query.filter_by(
        user_id=user.id, advertiser_id=adv_id, date=spend_date, media=media
    ).first()
    assert updated.amount == 20000, f"Expected amount 20000, got {updated.amount}"

    # 다른 매체는 별도 레코드
    spend_gfa = DailySpend(
        user_id=user.id,
        advertiser_id=adv_id,
        date=spend_date,
        media="GFA",
        amount=5000,
        upload_id=upload2.id,
    )
    db.session.add(spend_gfa)
    db.session.commit()

    total_for_user = DailySpend.query.filter_by(
        user_id=user.id, advertiser_id=adv_id, date=spend_date
    ).count()
    assert total_for_user == 2, f"Expected 2 records (2 media types), got {total_for_user}"

    return True


def test_multi_user_same_advertiser():
    """
    테스트 4: 서로 다른 사용자가 같은 광고주에 대해 소진액을 등록해도
    충돌 없이 각자의 레코드가 유지된다.
    """
    # 두 명의 사용자 생성
    user_a = _test_user(f"{TEST_PREFIX}USR_MULTI_A", "담당자A")
    user_b = _test_user(f"{TEST_PREFIX}USR_MULTI_B", "담당자B")
    db.session.add_all([user_a, user_b])
    db.session.flush()

    # 공통 광고주
    adv_id = f"{TEST_PREFIX}ADV_SHARED_001"
    adv = Advertiser(advertiser_id=adv_id, account_id="A400", name="공유광고주")
    db.session.add(adv)
    db.session.flush()

    # 각 사용자별 업로드 + 소진액
    upload_a = _test_upload(user_a.id, "a.xlsx", 1)
    upload_b = _test_upload(user_b.id, "b.xlsx", 1)
    db.session.add_all([upload_a, upload_b])
    db.session.flush()

    spend_date = date(2026, 3, 1)
    media = "네이버"

    spend_a = DailySpend(
        user_id=user_a.id, advertiser_id=adv_id,
        date=spend_date, media=media, amount=30000, upload_id=upload_a.id,
    )
    spend_b = DailySpend(
        user_id=user_b.id, advertiser_id=adv_id,
        date=spend_date, media=media, amount=50000, upload_id=upload_b.id,
    )
    db.session.add_all([spend_a, spend_b])
    db.session.commit()

    # 검증: 같은 advertiser_id, 같은 날짜/매체이지만 user_id가 다르므로 2건
    total = DailySpend.query.filter_by(
        advertiser_id=adv_id, date=spend_date, media=media
    ).count()
    assert total == 2, f"Expected 2 records (2 users), got {total}"

    # 각 사용자의 금액이 정확한지 확인
    a_spend = DailySpend.query.filter_by(
        user_id=user_a.id, advertiser_id=adv_id, date=spend_date, media=media
    ).first()
    b_spend = DailySpend.query.filter_by(
        user_id=user_b.id, advertiser_id=adv_id, date=spend_date, media=media
    ).first()

    assert a_spend.amount == 30000, f"User A: expected 30000, got {a_spend.amount}"
    assert b_spend.amount == 50000, f"User B: expected 50000, got {b_spend.amount}"

    # Advertiser 테이블에는 여전히 1건만 존재
    adv_count = Advertiser.query.filter_by(advertiser_id=adv_id).count()
    assert adv_count == 1, f"Expected 1 advertiser record, got {adv_count}"

    return True


def test_chart_data_builder():
    """
    테스트 5: _build_chart_data 헬퍼가 여러 날짜와 매체에 대해
    올바른 구조의 차트 데이터를 반환하는지 확인한다.
    """
    # 준비: 사용자, 광고주, 소진액 데이터
    user = _test_user(f"{TEST_PREFIX}USR_CHART", "차트테스터")
    db.session.add(user)
    db.session.flush()

    adv_id = f"{TEST_PREFIX}ADV_CHART_001"
    adv = Advertiser(advertiser_id=adv_id, account_id="A500", name="차트광고주")
    db.session.add(adv)
    db.session.flush()

    upload = _test_upload(user.id, "chart.xlsx", 5)
    db.session.add(upload)
    db.session.flush()

    d1 = date(2026, 3, 1)
    d2 = date(2026, 3, 2)
    d3 = date(2026, 3, 3)

    spends_data = [
        DailySpend(user_id=user.id, advertiser_id=adv_id, date=d1, media="네이버", amount=10000, upload_id=upload.id),
        DailySpend(user_id=user.id, advertiser_id=adv_id, date=d1, media="GFA",   amount=5000,  upload_id=upload.id),
        DailySpend(user_id=user.id, advertiser_id=adv_id, date=d2, media="네이버", amount=15000, upload_id=upload.id),
        DailySpend(user_id=user.id, advertiser_id=adv_id, date=d2, media="GFA",   amount=8000,  upload_id=upload.id),
        DailySpend(user_id=user.id, advertiser_id=adv_id, date=d3, media="네이버", amount=12000, upload_id=upload.id),
    ]
    db.session.add_all(spends_data)
    db.session.commit()

    # _build_chart_data 호출
    dates = [d1, d2, d3]
    spends = DailySpend.query.filter(
        DailySpend.user_id == user.id,
        DailySpend.advertiser_id == adv_id,
    ).order_by(DailySpend.date).all()

    result = _build_chart_data(spends, dates)

    # 검증: 반환값이 None이 아님
    assert result is not None, "chart_data should not be None"

    # labels 검증
    expected_labels = ["3/1", "3/2", "3/3"]
    assert result["labels"] == expected_labels, (
        f"Expected labels {expected_labels}, got {result['labels']}"
    )

    # daily_totals 검증
    # d1: 10000 + 5000 = 15000
    # d2: 15000 + 8000 = 23000
    # d3: 12000 + 0    = 12000
    expected_daily = [15000, 23000, 12000]
    assert result["daily_totals"] == expected_daily, (
        f"Expected daily_totals {expected_daily}, got {result['daily_totals']}"
    )

    # cumulative 검증
    # 15000, 15000+23000=38000, 38000+12000=50000
    expected_cum = [15000, 38000, 50000]
    assert result["cumulative"] == expected_cum, (
        f"Expected cumulative {expected_cum}, got {result['cumulative']}"
    )

    # media_series 검증
    assert "네이버" in result["media_series"], "media_series should contain '네이버'"
    assert "GFA" in result["media_series"], "media_series should contain 'GFA'"

    expected_naver = [10000, 15000, 12000]
    expected_gfa = [5000, 8000, 0]  # d3에는 GFA 없음 -> 0
    assert result["media_series"]["네이버"] == expected_naver, (
        f"Expected naver series {expected_naver}, got {result['media_series']['네이버']}"
    )
    assert result["media_series"]["GFA"] == expected_gfa, (
        f"Expected GFA series {expected_gfa}, got {result['media_series']['GFA']}"
    )

    # 빈 dates 입력 시 None 반환 확인
    assert _build_chart_data(spends, []) is None, (
        "_build_chart_data with empty dates should return None"
    )

    return True


# ── 메인 실행 ──────────────────────────────────────────────────────

TESTS = [
    ("1. Advertiser 중복 방지",              test_advertiser_no_duplicates),
    ("2. Advertiser 이름 변경 시 업데이트",   test_advertiser_name_update),
    ("3. DailySpend upsert 로직",           test_daily_spend_upsert),
    ("4. 다중 사용자 동일 광고주 비충돌",      test_multi_user_same_advertiser),
    ("5. _build_chart_data 헬퍼 검증",       test_chart_data_builder),
]


def main():
    all_passed = True

    with app.app_context():
        # 사전 정리 (이전 실행에서 남은 데이터)
        cleanup()

        print("=" * 60)
        print("  시스템 테스트 실행")
        print("=" * 60)
        print()

        for name, test_fn in TESTS:
            try:
                test_fn()
                print(f"  [PASS] {name}")
            except Exception as e:
                all_passed = False
                print(f"  [FAIL] {name}")
                print(f"         -> {e}")
                traceback.print_exc()
                # 실패 시에도 DB 세션을 정리하여 다음 테스트 진행
                db.session.rollback()

        print()
        print("-" * 60)

        # 최종 정리
        cleanup()
        print("  테스트 데이터 정리 완료")

        if all_passed:
            print("  결과: 모든 테스트 통과 (ALL PASS)")
        else:
            print("  결과: 일부 테스트 실패 (SOME FAILED)")

        print("=" * 60)

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
