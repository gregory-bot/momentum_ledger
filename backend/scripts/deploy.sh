#!/usr/bin/env bash
# Provision Azure resources, then ship the Function App and the web container.
# Requires: az CLI (logged in), Azure Functions Core Tools v4.
set -euo pipefail

RG=${RG:-rg-dangote}
LOCATION=${LOCATION:-swedencentral}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)   # repository root
BACKEND="$ROOT/backend"

az group create -n "$RG" -l "$LOCATION" -o none
echo "Deploying infrastructure (Event Hubs, Cosmos DB, Azure OpenAI, Translator, Functions, Container Apps)..."
az deployment group create -g "$RG" -f "$BACKEND/infra/main.bicep" -o none
FUNC=$(az deployment group show -g "$RG" -n main --query properties.outputs.functionApp.value -o tsv)

echo "Publishing Function App $FUNC..."
rm -rf "$BACKEND/functions/dangote" && cp -R "$BACKEND/dangote" "$BACKEND/functions/dangote"
(cd "$BACKEND/functions" && func azure functionapp publish "$FUNC" --python)

echo "Building and deploying the web app to Container Apps..."
WEB=$(az containerapp list -g "$RG" --query "[0].name" -o tsv)
az containerapp up -n "$WEB" -g "$RG" --source "$ROOT" --target-port 8000 --ingress external -o none
az containerapp show -n "$WEB" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv | sed 's/^/Web app: https:\/\//'

cat <<EOF

Stream a match into Event Hubs (the Function picks it up and writes verified overlays to Cosmos):
  export EVENTHUB_CONNECTION="\$(az eventhubs eventhub authorization-rule keys list -g $RG \\
      --namespace-name <namespace> --eventhub-name match-events -n app --query primaryConnectionString -o tsv)"
  cd backend && python -m dangote publish --speed 30
EOF
