#!/bin/bash
cd "$(dirname "$0")"
rsync -a --delete \
  --exclude '.env' --exclude '.git' --exclude '.gitignore' \
  --exclude '.wrangler' --exclude '.claude' --exclude 'audio-tests' \
  --exclude 'deploy' --exclude 'README.md' --exclude '*.command' \
  --exclude 'production' \
  ./ deploy/
echo ""
echo "✅ Mapa 'deploy' je sveža — njo povleci v Cloudflare Pages."
echo ""
