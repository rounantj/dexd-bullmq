# ════════════════════════════════════════════════════════════════════════════
# HEROKU PROCFILE - DEXD INFRA WORKERS
# ════════════════════════════════════════════════════════════════════════════
#
# CONFIGURAÇÃO RECOMENDADA POR DYNO:
# ──────────────────────────────────────────────────────────────────────────────
# Eco/Basic (512MB)    → WORKER_CONCURRENCY=1 ou 2
# Standard 1X (512MB)  → WORKER_CONCURRENCY=2 ou 3
# Standard 2X (1GB)    → WORKER_CONCURRENCY=3 a 5
# Performance M (2.5GB)→ WORKER_CONCURRENCY=5 a 8
# Performance L (14GB) → WORKER_CONCURRENCY=10 a 15
#
# Configure no Heroku Dashboard: Settings → Config Vars → WORKER_CONCURRENCY
# ════════════════════════════════════════════════════════════════════════════

# API do Bull Board + Dashboard
web: npm start

# Worker de processamento de produtos (rode em dyno separado se precisar escalar)
# heroku ps:scale product_worker=1 -a seu-app
product_worker: npm run worker:product
