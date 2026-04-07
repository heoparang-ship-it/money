#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# 소진액 관리 시스템 — AWS Lightsail 자동 배포 스크립트
# Ubuntu 22.04 LTS 기준
# ═══════════════════════════════════════════════════════════════
set -e

APP_NAME="sojinapp"
APP_DIR="/opt/$APP_NAME"
APP_USER="sojin"
REPO_URL="https://github.com/heoparang-ship-it/money.git"
PORT=5050

echo "══════════════════════════════════════════"
echo "  소진액 관리 시스템 — AWS 배포 시작"
echo "══════════════════════════════════════════"

# ── 1. 시스템 패키지 설치 ─────────────────────────────────
echo "[1/7] 시스템 패키지 설치..."
sudo apt update -y
sudo apt install -y python3 python3-pip python3-venv nginx git

# ── 2. 앱 사용자 생성 ────────────────────────────────────
echo "[2/7] 앱 사용자 생성..."
if ! id "$APP_USER" &>/dev/null; then
    sudo useradd -r -s /bin/false "$APP_USER"
fi

# ── 3. 코드 클론 ─────────────────────────────────────────
echo "[3/7] 코드 클론..."
if [ -d "$APP_DIR" ]; then
    echo "  기존 디렉토리 존재 — git pull"
    cd "$APP_DIR" && sudo git pull origin main
else
    sudo git clone "$REPO_URL" "$APP_DIR"
fi

# ── 4. Python 가상환경 & 의존성 ──────────────────────────
echo "[4/7] Python 가상환경 설정..."
cd "$APP_DIR"
sudo python3 -m venv venv
sudo ./venv/bin/pip install --upgrade pip
sudo ./venv/bin/pip install -r requirements.txt

# ── 5. 디렉토리 권한 설정 ────────────────────────────────
echo "[5/7] 디렉토리 권한 설정..."
sudo mkdir -p "$APP_DIR/webapp/instance"
sudo mkdir -p "$APP_DIR/webapp/uploads"
sudo chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# ── 6. systemd 서비스 등록 ───────────────────────────────
echo "[6/7] systemd 서비스 등록..."
sudo cp "$APP_DIR/deploy/sojinapp.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable "$APP_NAME"
sudo systemctl restart "$APP_NAME"

# ── 7. Nginx 설정 ────────────────────────────────────────
echo "[7/7] Nginx 리버스 프록시 설정..."
sudo cp "$APP_DIR/deploy/nginx-sojinapp.conf" /etc/nginx/sites-available/"$APP_NAME"
sudo ln -sf /etc/nginx/sites-available/"$APP_NAME" /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

echo ""
echo "══════════════════════════════════════════"
echo "  배포 완료!"
echo "  http://$(curl -s http://checkip.amazonaws.com)"
echo "══════════════════════════════════════════"
