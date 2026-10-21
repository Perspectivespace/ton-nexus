#!/bin/bash
set -e
cd /opt/taskbot_test/miniapp
git pull origin main
cd frontend
npm run build
systemctl reload nginx
echo "Deploy finished at $(date)"
