// Dangote: Azure footprint.
//   Event Hubs (ingest) -> Functions Flex Consumption (interpret/explain/verify) -> Cosmos DB (ledger + overlays)
//   Azure OpenAI + AI Translator (narrate/translate) · Container Apps (web overlay + API) · App Insights
//
//   az group create -n rg-momentum -l swedencentral
//   az deployment group create -g rg-dangote -f backend/infra/main.bicep

@description('Short prefix for resource names (lowercase letters/numbers).')
param prefix string = 'dangote'
param location string = resourceGroup().location
@description('Model deployed in Azure OpenAI for narration and judging.')
param openAiModel string = 'gpt-4o-mini'
param openAiModelVersion string = '2024-07-18'
@description('Container image for the web app (push with backend/scripts/deploy.sh).')
param webImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

var suffix = uniqueString(resourceGroup().id)
var name = '${prefix}${suffix}'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${name}-ai'
  location: location
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: take('st${replace(name, '-', '')}', 24)
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: { minimumTlsVersion: 'TLS1_2', allowBlobPublicAccess: false }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource deployContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'deployments'
}

// ---- ingest ----
resource ehns 'Microsoft.EventHub/namespaces@2024-01-01' = {
  name: '${name}-eh'
  location: location
  sku: { name: 'Standard', tier: 'Standard', capacity: 1 }
}

resource hub 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' = {
  parent: ehns
  name: 'match-events'
  properties: { partitionCount: 2, messageRetentionInDays: 1 }
}

resource hubRule 'Microsoft.EventHub/namespaces/eventhubs/authorizationRules@2024-01-01' = {
  parent: hub
  name: 'app'
  properties: { rights: [ 'Listen', 'Send' ] }
}

// ---- ledger + overlays ----
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: '${name}-cosmos'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [ { locationName: location, failoverPriority: 0 } ]
    capabilities: [ { name: 'EnableServerless' } ]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
  }
}

resource db 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'momentum'
  properties: { resource: { id: 'momentum' } }
}

resource containers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [for c in [ 'events', 'overlays', 'matches' ]: {
  parent: db
  name: c
  properties: { resource: { id: c, partitionKey: { paths: [ '/match_id' ], kind: 'Hash' } } }
}]

// ---- AI ----
resource openai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: '${name}-aoai'
  location: location
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: { customSubDomainName: '${name}-aoai', publicNetworkAccess: 'Enabled' }
}

resource model 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openai
  name: openAiModel
  sku: { name: 'GlobalStandard', capacity: 50 }
  properties: { model: { format: 'OpenAI', name: openAiModel, version: openAiModelVersion } }
}

resource translator 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: '${name}-translator'
  location: location
  kind: 'TextTranslation'
  sku: { name: 'S1' }
  properties: { customSubDomainName: '${name}-translator', publicNetworkAccess: 'Enabled' }
}

var sharedSettings = [
  { name: 'EVENTHUB_NAME', value: hub.name }
  { name: 'EVENTHUB_CONNECTION', value: hubRule.listKeys().primaryConnectionString }
  { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
  { name: 'COSMOS_KEY', value: cosmos.listKeys().primaryMasterKey }
  { name: 'COSMOS_DATABASE', value: db.name }
  { name: 'AZURE_OPENAI_ENDPOINT', value: openai.properties.endpoint }
  { name: 'AZURE_OPENAI_API_KEY', value: openai.listKeys().key1 }
  { name: 'AZURE_OPENAI_DEPLOYMENT', value: model.name }
  { name: 'AZURE_TRANSLATOR_KEY', value: translator.listKeys().key1 }
  { name: 'AZURE_TRANSLATOR_REGION', value: location }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
]

// ---- event-driven processing ----
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${name}-plan'
  location: location
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}

var storageConn = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

resource functions 'Microsoft.Web/sites@2023-12-01' = {
  name: '${name}-func'
  location: location
  kind: 'functionapp,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deployContainer.name}'
          authentication: { type: 'StorageAccountConnectionString', storageAccountConnectionStringName: 'DEPLOYMENT_STORAGE_CONNECTION_STRING' }
        }
      }
      scaling: { maximumInstanceCount: 40, instanceMemoryMB: 2048 }
      runtime: { name: 'python', version: '3.11' }
    }
    siteConfig: {
      appSettings: concat(sharedSettings, [
        { name: 'AzureWebJobsStorage', value: storageConn }
        { name: 'DEPLOYMENT_STORAGE_CONNECTION_STRING', value: storageConn }
        { name: 'DEMO_INJECT_FAULTS', value: 'false' }
      ])
    }
  }
}

// ---- web overlay + API ----
resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
  }
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${name}-web'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: { external: true, targetPort: webImage == 'mcr.microsoft.com/k8se/quickstart:latest' ? 80 : 8000 }
      secrets: [for s in sharedSettings: { name: toLower(replace(s.name, '_', '-')), value: s.value }]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat([for s in sharedSettings: { name: s.name, secretRef: toLower(replace(s.name, '_', '-')) }], [
            { name: 'DEMO_INJECT_FAULTS', value: 'true' }
          ])
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 5, rules: [ { name: 'http', http: { metadata: { concurrentRequests: '50' } } } ] }
    }
  }
}

output webUrl string = 'https://${web.properties.configuration.ingress.fqdn}'
output functionApp string = functions.name
output eventHubNamespace string = ehns.name
output openAiEndpoint string = openai.properties.endpoint
