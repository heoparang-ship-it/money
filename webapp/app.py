import os
import json
import shutil
from datetime import date, datetime, timedelta
from collections import defaultdict

from flask import (Flask, render_template, request, redirect, url_for,
                   flash, session, jsonify)
from flask_login import (LoginManager, login_user, logout_user,
                         login_required, current_user)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename
from sqlalchemy import func

from models import db, User, Advertiser, Upload, DailySpend
from excel_parser import preview_parse, preview_parse_csv

# ── 앱 초기화 ──────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
ALLOWED_EXTENSIONS = {'xlsx', 'xls', 'csv'}

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'xcom-sojin-secret-2026')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
    'DATABASE_URL',
    'sqlite:///' + os.path.join(BASE_DIR, 'instance', 'db.sqlite')
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB

db.init_app(app)

login_manager = LoginManager(app)
login_manager.login_view = 'login'
login_manager.login_message = '로그인이 필요합니다.'
login_manager.login_message_category = 'warning'


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


# ── 차트 데이터 헬퍼 ──────────────────────────────────────────────

def _build_chart_data(spends, dates):
    """일별 소진액 차트 데이터를 생성한다 (매체별 스택 + 누적 성장선)."""
    if not dates:
        return None

    daily_totals = defaultdict(int)
    media_daily = defaultdict(lambda: defaultdict(int))
    for s in spends:
        daily_totals[s.date] += s.amount
        media_daily[s.media][s.date] += s.amount

    labels = [f'{d.month}/{d.day}' for d in dates]

    # 누적 성장선
    cumulative = []
    cum = 0
    for d in dates:
        cum += daily_totals[d]
        cumulative.append(cum)

    # 매체별 일별 데이터
    media_series = {}
    for media in sorted(media_daily.keys()):
        media_series[media] = [media_daily[media].get(d, 0) for d in dates]

    return {
        'labels': labels,
        'cumulative': cumulative,
        'media_series': media_series,
        'daily_totals': [daily_totals[d] for d in dates],
    }


# ── Jinja2 필터 ───────────────────────────────────────────────────
@app.template_filter('comma')
def comma_filter(value):
    if value is None:
        return '0'
    try:
        return f'{int(value):,}'
    except (ValueError, TypeError):
        return str(value)


@app.template_filter('date_kr')
def date_kr_filter(d):
    if d is None:
        return ''
    return f'{d.month}월 {d.day}일'


# ── 라우터 ────────────────────────────────────────────────────────

@app.route('/')
def index():
    if current_user.is_authenticated:
        if current_user.is_admin:
            return redirect(url_for('admin'))
        return redirect(url_for('dashboard'))
    return redirect(url_for('login'))


# ── 인증 ──────────────────────────────────────────────────────────

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user, remember=True)
            next_page = request.args.get('next')
            return redirect(next_page or url_for('index'))
        flash('아이디 또는 비밀번호가 올바르지 않습니다.', 'danger')
    return render_template('login.html')


@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))


# ── 담당자 대시보드 ───────────────────────────────────────────────

@app.route('/dashboard')
@login_required
def dashboard():
    # 날짜 필터 파라미터
    today = date.today()
    year = int(request.args.get('year', today.year))
    month = int(request.args.get('month', today.month))
    media_filter = request.args.get('media', 'all')
    view_mode = request.args.get('view', 'daily')

    # 해당 월의 시작/끝
    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(year, month + 1, 1) - timedelta(days=1)

    # 현재 사용자의 소진액 쿼리
    query = DailySpend.query.filter(
        DailySpend.user_id == current_user.id,
        DailySpend.date >= start_date,
        DailySpend.date <= end_date,
    )
    if media_filter != 'all':
        query = query.filter(DailySpend.media == media_filter)

    spends = query.order_by(DailySpend.date, DailySpend.advertiser_id).all()

    # 데이터 구조화: {advertiser_id: {media: {date: amount}}}
    dates = sorted(set(s.date for s in spends))
    adv_map = {}  # advertiser_id -> advertiser_name
    table = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))

    for s in spends:
        adv = Advertiser.query.filter_by(advertiser_id=s.advertiser_id).first()
        adv_name = adv.name if adv else s.advertiser_id
        adv_map[s.advertiser_id] = adv_name
        table[s.advertiser_id][s.media][s.date] = s.amount

    # 매체 목록
    medias = sorted(set(s.media for s in spends))

    # 월간 합계
    monthly_total = sum(s.amount for s in spends)

    # 이전/다음 월 링크용
    prev_month = (month - 1) or 12
    prev_year = year if month > 1 else year - 1
    next_month = (month % 12) + 1
    next_year = year if month < 12 else year + 1

    # 차트 데이터
    chart_data = _build_chart_data(spends, dates)

    return render_template('dashboard.html',
        dates=dates,
        adv_map=adv_map,
        table=table,
        medias=medias,
        monthly_total=monthly_total,
        year=year, month=month,
        prev_year=prev_year, prev_month=prev_month,
        next_year=next_year, next_month=next_month,
        media_filter=media_filter,
        view_mode=view_mode,
        today=today,
        chart_data_json=json.dumps(chart_data) if chart_data else 'null',
    )


# ── 엑셀 업로드 ───────────────────────────────────────────────────

@app.route('/upload', methods=['GET', 'POST'])
@login_required
def upload():
    if request.method == 'POST':
        action = request.form.get('action')

        if action == 'preview':
            # 파일 파싱 미리보기
            if 'file' not in request.files:
                flash('파일을 선택해주세요.', 'danger')
                return redirect(request.url)
            f = request.files['file']
            if not f.filename or not allowed_file(f.filename):
                flash('xlsx, xls 또는 csv 파일만 업로드 가능합니다.', 'danger')
                return redirect(request.url)

            filename = secure_filename(f.filename)
            ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
            tmp_path = os.path.join(app.config['UPLOAD_FOLDER'], f'tmp_{current_user.id}_{filename}')
            f.save(tmp_path)

            try:
                if ext == 'csv':
                    # CSV: 날짜 입력 필수
                    date_str = request.form.get('target_date', '').strip()
                    if not date_str:
                        os.remove(tmp_path)
                        flash('CSV 파일은 날짜를 선택해야 합니다.', 'danger')
                        return redirect(request.url)
                    target_date = date.fromisoformat(date_str)
                    preview = preview_parse_csv(tmp_path, target_date)
                    file_type = 'csv'
                else:
                    preview = preview_parse(tmp_path)
                    file_type = 'excel'

                # 기존 데이터와 비교
                comparison = []
                existing_total = 0
                new_total = 0
                for r in preview['records']:
                    existing = DailySpend.query.filter_by(
                        user_id=current_user.id,
                        advertiser_id=r['advertiser_id'],
                        date=r['date'],
                        media=r['media'],
                    ).first()
                    old_amt = existing.amount if existing else 0
                    new_amt = r['amount']
                    comparison.append({
                        'advertiser_name': r['advertiser_name'],
                        'date': r['date'],
                        'media': r['media'],
                        'old_amount': old_amt,
                        'new_amount': new_amt,
                        'diff': old_amt - new_amt,
                    })
                    existing_total += old_amt
                    new_total += new_amt

                preview['comparison'] = comparison
                preview['existing_total'] = existing_total
                preview['new_total'] = new_total
                preview['diff_total'] = existing_total - new_total

                session['pending_upload'] = {
                    'tmp_path': tmp_path,
                    'filename': filename,
                    'file_type': file_type,
                    'target_date': date_str if ext == 'csv' else None,
                    'dates': [str(d) for d in preview['dates']],
                    'advertisers': preview['advertisers'],
                    'total_amount': preview['total_amount'],
                    'record_count': preview['record_count'],
                }
                return render_template('upload.html',
                    preview=preview,
                    upload_history=_get_upload_history(),
                )
            except Exception as e:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
                flash(f'파일 파싱 오류: {str(e)}', 'danger')
                return redirect(request.url)

        elif action == 'save':
            # DB에 저장
            pending = session.get('pending_upload')
            if not pending:
                flash('먼저 파일을 미리보기 하세요.', 'warning')
                return redirect(url_for('upload'))

            tmp_path = pending['tmp_path']
            if not os.path.exists(tmp_path):
                flash('임시 파일이 만료되었습니다. 다시 업로드해주세요.', 'warning')
                session.pop('pending_upload', None)
                return redirect(url_for('upload'))

            try:
                # DB 자동 백업
                _backup_db()

                file_type = pending.get('file_type', 'excel')
                if file_type == 'csv':
                    target_date = date.fromisoformat(pending['target_date'])
                    preview = preview_parse_csv(tmp_path, target_date)
                else:
                    preview = preview_parse(tmp_path)
                records = preview['records']

                upload_obj = Upload(
                    user_id=current_user.id,
                    filename=pending['filename'],
                    records_count=len(records),
                )
                db.session.add(upload_obj)
                db.session.flush()  # upload_obj.id 확보

                count = 0
                for r in records:
                    # 광고주 upsert (신규 생성 또는 이름/계정 업데이트)
                    adv = Advertiser.query.filter_by(advertiser_id=r['advertiser_id']).first()
                    if not adv:
                        adv = Advertiser(
                            advertiser_id=r['advertiser_id'],
                            account_id=r['account_id'],
                            name=r['advertiser_name'],
                        )
                        db.session.add(adv)
                        db.session.flush()
                    else:
                        if adv.name != r['advertiser_name']:
                            adv.name = r['advertiser_name']
                        if r['account_id'] and adv.account_id != r['account_id']:
                            adv.account_id = r['account_id']

                    # 소진액 upsert
                    existing = DailySpend.query.filter_by(
                        user_id=current_user.id,
                        advertiser_id=r['advertiser_id'],
                        date=r['date'],
                        media=r['media'],
                    ).first()
                    if existing:
                        existing.amount = r['amount']
                        existing.upload_id = upload_obj.id
                    else:
                        spend = DailySpend(
                            user_id=current_user.id,
                            advertiser_id=r['advertiser_id'],
                            date=r['date'],
                            media=r['media'],
                            amount=r['amount'],
                            upload_id=upload_obj.id,
                        )
                        db.session.add(spend)
                    count += 1

                upload_obj.records_count = count
                db.session.commit()

                # 임시 파일 삭제
                os.remove(tmp_path)
                session.pop('pending_upload', None)
                flash(f'저장 완료! {count}개 레코드가 반영되었습니다.', 'success')
                return redirect(url_for('dashboard'))

            except Exception as e:
                db.session.rollback()
                flash(f'저장 오류: {str(e)}', 'danger')
                return redirect(url_for('upload'))

        elif action == 'cancel':
            pending = session.pop('pending_upload', None)
            if pending and os.path.exists(pending.get('tmp_path', '')):
                os.remove(pending['tmp_path'])
            flash('업로드가 취소되었습니다.', 'info')
            return redirect(url_for('upload'))

    return render_template('upload.html',
        preview=None,
        upload_history=_get_upload_history(),
    )


def _get_upload_history():
    return (Upload.query
            .filter_by(user_id=current_user.id)
            .order_by(Upload.uploaded_at.desc())
            .limit(10)
            .all())


def _backup_db():
    """저장 전 DB를 자동 백업 (최근 30개 유지)"""
    db_path = os.path.join(BASE_DIR, 'instance', 'db.sqlite')
    if not os.path.exists(db_path):
        return
    backup_dir = os.path.join(BASE_DIR, 'backup')
    os.makedirs(backup_dir, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    shutil.copy2(db_path, os.path.join(backup_dir, f'db_backup_{timestamp}.sqlite'))
    # 오래된 백업 정리 (최근 30개만 유지)
    backups = sorted(
        [f for f in os.listdir(backup_dir) if f.startswith('db_backup_')],
        reverse=True,
    )
    for old in backups[30:]:
        os.remove(os.path.join(backup_dir, old))


# ── 관리자 뷰 ─────────────────────────────────────────────────────

def admin_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            flash('관리자 권한이 필요합니다.', 'danger')
            return redirect(url_for('index'))
        return f(*args, **kwargs)
    return decorated


@app.route('/admin')
@login_required
@admin_required
def admin():
    # 담당자 목록 (관리자 제외)
    staff = User.query.filter_by(is_admin=False).order_by(User.display_name).all()
    if not staff:
        return render_template('admin.html', staff=staff, selected_user=None,
                               dates=[], adv_map={}, table={}, medias=[],
                               monthly_total=0, year=date.today().year,
                               month=date.today().month, view_mode='daily',
                               media_filter='all', today=date.today(),
                               prev_year=None, prev_month=None,
                               next_year=None, next_month=None)

    # 선택된 담당자
    selected_id = request.args.get('user_id', type=int)
    if not selected_id:
        selected_id = staff[0].id
    selected_user = db.session.get(User, selected_id)

    # 날짜 필터
    today = date.today()
    year = int(request.args.get('year', today.year))
    month = int(request.args.get('month', today.month))
    media_filter = request.args.get('media', 'all')
    view_mode = request.args.get('view', 'daily')  # daily or monthly

    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(year, month + 1, 1) - timedelta(days=1)

    query = DailySpend.query.filter(
        DailySpend.user_id == selected_id,
        DailySpend.date >= start_date,
        DailySpend.date <= end_date,
    )
    if media_filter != 'all':
        query = query.filter(DailySpend.media == media_filter)

    spends = query.order_by(DailySpend.date, DailySpend.advertiser_id).all()

    dates = sorted(set(s.date for s in spends))
    adv_map = {}
    table = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))

    for s in spends:
        adv = Advertiser.query.filter_by(advertiser_id=s.advertiser_id).first()
        adv_name = adv.name if adv else s.advertiser_id
        adv_map[s.advertiser_id] = adv_name
        table[s.advertiser_id][s.media][s.date] = s.amount

    medias = sorted(set(s.media for s in spends))
    monthly_total = sum(s.amount for s in spends)

    prev_month = (month - 1) or 12
    prev_year = year if month > 1 else year - 1
    next_month = (month % 12) + 1
    next_year = year if month < 12 else year + 1

    # 차트 데이터
    chart_data = _build_chart_data(spends, dates)

    return render_template('admin.html',
        staff=staff,
        selected_user=selected_user,
        dates=dates,
        adv_map=adv_map,
        table=table,
        medias=medias,
        monthly_total=monthly_total,
        year=year, month=month,
        prev_year=prev_year, prev_month=prev_month,
        next_year=next_year, next_month=next_month,
        media_filter=media_filter,
        view_mode=view_mode,
        today=today,
        chart_data_json=json.dumps(chart_data) if chart_data else 'null',
    )


# ── 계정 관리 ─────────────────────────────────────────────────────

@app.route('/admin/accounts', methods=['GET', 'POST'])
@login_required
@admin_required
def admin_accounts():
    if request.method == 'POST':
        action = request.form.get('action')

        if action == 'create':
            username = request.form.get('username', '').strip()
            display_name = request.form.get('display_name', '').strip()
            password = request.form.get('password', '')
            is_admin = request.form.get('is_admin') == '1'

            if not username or not display_name or not password:
                flash('모든 항목을 입력해주세요.', 'danger')
            elif User.query.filter_by(username=username).first():
                flash(f'이미 존재하는 아이디입니다: {username}', 'danger')
            else:
                user = User(username=username, display_name=display_name, is_admin=is_admin)
                user.set_password(password)
                db.session.add(user)
                db.session.commit()
                flash(f'계정 생성 완료: {display_name} ({username})', 'success')

        elif action == 'reset_password':
            user_id = request.form.get('user_id', type=int)
            new_password = request.form.get('new_password', '')
            user = db.session.get(User, user_id)
            if user and new_password:
                user.set_password(new_password)
                db.session.commit()
                flash(f'{user.display_name} 비밀번호가 변경되었습니다.', 'success')

        elif action == 'delete':
            user_id = request.form.get('user_id', type=int)
            user = db.session.get(User, user_id)
            if user and user.id != current_user.id:
                db.session.delete(user)
                db.session.commit()
                flash(f'{user.display_name} 계정이 삭제되었습니다.', 'success')
            else:
                flash('자신의 계정은 삭제할 수 없습니다.', 'warning')

        return redirect(url_for('admin_accounts'))

    users = User.query.order_by(User.is_admin.desc(), User.display_name).all()
    return render_template('admin_accounts.html', users=users)


# ── 앱 실행 ───────────────────────────────────────────────────────

def init_db():
    """DB 초기화 및 관리자 계정 seed"""
    os.makedirs(os.path.join(BASE_DIR, 'instance'), exist_ok=True)
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    db.create_all()

    if not User.query.filter_by(username='admin').first():
        admin = User(username='admin', display_name='관리자', is_admin=True)
        admin.set_password('admin1234')
        db.session.add(admin)
        db.session.commit()
        print('관리자 계정 생성: admin / admin1234')


with app.app_context():
    init_db()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5050)), debug=True)
