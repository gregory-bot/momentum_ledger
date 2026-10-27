#!/usr/bin/env bash
# Fastest path to Azure: builds the image in Azure (no local Docker needed) and runs the whole app,
# API + MCP endpoint + web UI, on Azure Container Apps behind HTTPS, scaling to zero when idle.
#
#   az login
#   ./backend/scripts/deploy-containerapp.sh
#
# Optional: export AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_DEPLOYMENT and
# AZURE_TRANSLATOR_KEY / AZURE_TRANSLATOR_REGION first to switch on the LLM narrator and Translator.
# For the full event-driven footprint (Event Hubs, Functions, Cosmos DB, ...) use deploy.sh instead.
set -euo pipefail

RG=${RG:-rg-dangote}
LOCATION=${LOCATION:-swedencentral}
APP=${APP:-dangote}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)

az extension add --name containerapp --upgrade --only-show-errors -y >/dev/null
az provider register -n Microsoft.App --wait -o none
az provider register -n Microsoft.OperationalInsights --wait -o none
az group create -n "$RG" -l "$LOCATION" -o none

ENV_VARS=(DEMO_INJECT_FAULTS=true)
for v in AZURE_OPENAI_ENDPOINT AZURE_OPENAI_API_KEY AZURE_OPENAI_DEPLOYMENT AZURE_TRANSLATOR_KEY AZURE_TRANSLATOR_REGION VERIFIER_LLM_JUDGE; do
  [ -n "${!v:-}" ] && ENV_VARS+=("$v=${!v}")
done

echo "Building in Azure and deploying to Container Apps (first run takes a few minutes)..."
az containerapp up -n "$APP" -g "$RG" -l "$LOCATION" --source "$ROOT" \
  --ingress external --target-port 8000 --env-vars "${ENV_VARS[@]}" -o none

FQDN=$(az containerapp show -n "$APP" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
cat <<DONE

dangote is live:
  Web app      https://$FQDN/
  API index    https://$FQDN/api
  OpenAPI      https://$FQDN/docs
  MCP          https://$FQDN/mcp   (POST)

To point the GitHub Pages site at this API (fact-check desk included):
  gh variable set DANGOTE_API_URL --body "https://$FQDN" && gh workflow run pages
DONE
