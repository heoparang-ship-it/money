#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Railway → AWS 데이터 마이그레이션 스크립트
# Railway PostgreSQL → AWS Lightsail SQLite 변환
# ═══════════════════════════════════════════════════════════════
set -e

echo "══════════════════════════════════════════"
echo "  Railway → AWS 데이터 마이그레이션"
echo "══════════════════════════════════════════"

# ── 사용법 ────────────────────────────────────────────────
if [ -z "$1" ]; then
    echo ""
    echo "사용법:"
    echo "  ./migrate-from-railway.sh <RAILWAY_DATABASE_URL>"
    echo ""
    echo "예시:"
    echo "  ./migrate-from-railway.sh 'postgresql://postgres:xxx@xxx.railway.app:5432/railway'"
    echo ""
    echo "Railway DATABASE_URL 확인 방법:"
    echo "  1. Railway 대시보드 → PostgreSQL 서비스 → Variables 탭"
    echo "  2. DATABASE_URL 복사"
    echo ""
    exit 1
fi

RAILWAY_DB_URL="$1"
BACKUP_DIR="./backup_$(date +%Y%m%d_%H%M%S)"
SQLITE_DB="./webapp/instance/db.sqlite"

mkdir -p "$BACKUP_DIR"

echo ""
echo "[1/4] Railway PostgreSQL 데이터 덤프 중..."
# 각 테이블을 CSV로 내보내기
PGPASSWORD=$(echo "$RAILWAY_DB_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
PGHOST=$(echo "$RAILWAY_DB_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
PGPORT=$(echo "$RAILWAY_DB_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
PGDATABASE=$(echo "$RAILWAY_DB_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')
PGUSER=$(echo "$RAILWAY_DB_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')

export PGPASSWORD

for TABLE in users advertisers uploads daily_spend; do
    echo "  - $TABLE 테이블 덤프..."
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
        -c "\COPY $TABLE TO '$BACKUP_DIR/$TABLE.csv' WITH CSV HEADER"
done

echo ""
echo "[2/4] 기존 SQLite DB 백업..."
if [ -f "$SQLITE_DB" ]; then
    cp "$SQLITE_DB" "$BACKUP_DIR/db_backup.sqlite"
    echo "  - 백업 완료: $BACKUP_DIR/db_backup.sqlite"
fi

echo ""
echo "[3/4] SQLite에 데이터 임포트..."
# 기존 DB 삭제 후 새로 생성 (앱 시작 시 init_db가 테이블 생성)
rm -f "$SQLITE_DB"

python3 << 'PYEOF'
import csv
import os
import sys
sys.path.insert(0, 'webapp')

from flask import Flask
from models import db, User, Advertiser, Upload, DailySpend
from datetime import datetime, date

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.abspath('webapp/instance/db.sqlite')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

backup_dir = [d for d in os.listdir('.') if d.startswith('backup_')][-1]

with app.app_context():
    db.create_all()

    # users
    with open(f'{backup_dir}/users.csv') as f:
        reader = csv.DictReader(f)
        for row in reader:
            u = User(
                id=int(row['id']),
                username=row['username'],
                password_hash=row['password_hash'],
                display_name=row['display_name'],
                is_admin=row['is_admin'].lower() in ('true', 't', '1'),
                created_at=datetime.fromisoformat(row['created_at']) if row.get('created_at') else datetime.now()
            )
            db.session.add(u)
        db.session.commit()
        print(f'  - users: {reader.line_num - 1}건 임포트')

    # advertisers
    with open(f'{backup_dir}/advertisers.csv') as f:
        reader = csv.DictReader(f)
        for row in reader:
            a = Advertiser(
                id=int(row['id']),
                advertiser_id=row['advertiser_id'],
                account_id=row.get('account_id', ''),
                name=row['name'],
                created_at=datetime.fromisoformat(row['created_at']) if row.get('created_at') else datetime.now()
            )
            db.session.add(a)
        db.session.commit()
        print(f'  - advertisers: {reader.line_num - 1}건 임포트')

    # uploads
    with open(f'{backup_dir}/uploads.csv') as f:
        reader = csv.DictReader(f)
        for row in reader:
            u = Upload(
                id=int(row['id']),
                user_id=int(row['user_id']),
                filename=row['filename'],
                uploaded_at=datetime.fromisoformat(row['uploaded_at']) if row.get('uploaded_at') else datetime.now(),
                records_count=int(row.get('records_count', 0))
            )
            db.session.add(u)
        db.session.commit()
        print(f'  - uploads: {reader.line_num - 1}건 임포트')

    # daily_spend
    with open(f'{backup_dir}/daily_spend.csv') as f:
        reader = csv.DictReader(f)
        count = 0
        for row in reader:
            ds = DailySpend(
                id=int(row['id']),
                user_id=int(row['user_id']),
                advertiser_id=int(row['advertiser_id']),
                date=date.fromisoformat(row['date']) if isinstance(row['date'], str) and len(row['date']) == 10 else datetime.fromisoformat(row['date']).date(),
                media=row['media'],
                amount=float(row['amount']),
                upload_id=int(row['upload_id']) if row.get('upload_id') else None
            )
            db.session.add(ds)
            count += 1
            if count % 500 == 0:
                db.session.commit()
        db.session.commit()
        print(f'  - daily_spend: {count}건 임포트')

print('\n마이그레이션 완료!')
PYEOF

echo ""
echo "[4/4] 데이터 검증..."
python3 << 'PYEOF'
import sqlite3
conn = sqlite3.connect('webapp/instance/db.sqlite')
cur = conn.cursor()
for table in ['users', 'advertisers', 'uploads', 'daily_spend']:
    count = cur.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
    print(f'  - {table}: {count}건')
conn.close()
PYEOF

echo ""
echo "══════════════════════════════════════════"
echo "  마이그레이션 완료!"
echo "  백업 위치: $BACKUP_DIR/"
echo "  SQLite DB: $SQLITE_DB"
echo "══════════════════════════════════════════"
