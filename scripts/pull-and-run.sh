#!/bin/bash

set -euo pipefail

git pull origin main
sudo docker pull yjs/y-webrtc:latest
sudo docker compose -f docker-compose.production.yml up -d
sudo docker compose logs -f