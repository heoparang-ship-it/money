#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# 소진액 관리 시스템 — 코드 업데이트 스크립트
# GitHub에서 최신 코드를 가져와 서비스를 재시작합니다
# ═══════════════════════════════════════════════════════════════
set -e

APP_DIR="/opt/sojinapp"

echo "코드 업데이트 중..."
cd "$APP_DIR"
sudo git pull origin main

echo "의존성 업데이트..."
sudo ./venv/bin/pip install -r requirements.txt --quiet

echo "서비스 재시작..."
sudo systemctl restart sojinapp

echo "완료! 상태:"
sudo systemctl status sojinapp --no-pager -l
