@description('Short lowercase prefix used for globally unique Azure resource names.')
@minLength(3)
@maxLength(12)
param prefix string = 'hukumid'

param location string = resourceGroup().location
param staticWebLocation string = 'eastasia'
param environmentName string = 'pilot'
param imageTag string
param deployRuntime bool = true
param entraTenantId string
param entraClientId string

@description('Existing Storage Account that remains the canonical data store.')
param storageAccountName string
param storageResourceGroupName string = resourceGroup().name

@secure()
@description('Optional platform Gemini key. Stored in Key Vault; leave blank for BYOK-only.')
param geminiApiKey string = ''

@description('Deploy a subscription budget only when amount > 0 and contacts are supplied.')
param monthlyBudgetAmount int = 0
param budgetContactEmails array = []
param budgetStartDate string = '2026-09-01T00:00:00Z'

var suffix = uniqueString(resourceGroup().id)
var baseName = toLower('${prefix}-${environmentName}')
var appImage = '${registry.properties.loginServer}/hukumid-api:${imageTag}'
var cryptoEncryptionUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'e147488a-f6f5-4113-8e2d-b22465e65bf6')
var acrPull = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var monitoringMetricsPublisher = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
var keyVaultSecretsUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
  scope: resourceGroup(storageResourceGroupName)
}

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: '${baseName}-logs'
  location: location
  properties: {
    retentionInDays: 30
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
    sku: { name: 'PerGB2018' }
    workspaceCapping: { dailyQuotaGb: 1 }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${baseName}-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logWorkspace.id
    DisableLocalAuth: true
    RetentionInDays: 30
    SamplingPercentage: 20
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource environment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: '${baseName}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logWorkspace.properties.customerId
        sharedKey: logWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${baseName}-api-id'
  location: location
}

resource workerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${baseName}-worker-id'
  location: location
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: take('hukumid${suffix}', 50)
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource vault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: take('${prefix}-${suffix}-kv', 24)
  location: location
  properties: {
    tenantId: tenant().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
    sku: { family: 'A', name: 'standard' }
    accessPolicies: []
  }
}

resource uploadKey 'Microsoft.KeyVault/vaults/keys@2024-11-01' = {
  parent: vault
  name: 'upload-envelope-key'
  properties: {
    kty: 'RSA'
    keySize: 3072
    keyOps: ['wrapKey', 'unwrapKey']
    attributes: { enabled: true }
  }
}

resource geminiSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = if (!empty(geminiApiKey)) {
  parent: vault
  name: 'gemini-api-key'
  properties: { value: geminiApiKey }
}

resource appCryptoRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, appIdentity.id, cryptoEncryptionUser)
  scope: vault
  properties: { roleDefinitionId: cryptoEncryptionUser, principalId: appIdentity.properties.principalId, principalType: 'ServicePrincipal' }
}
resource appAcrRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, appIdentity.id, acrPull)
  scope: registry
  properties: { roleDefinitionId: acrPull, principalId: appIdentity.properties.principalId, principalType: 'ServicePrincipal' }
}
resource appMonitorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(insights.id, appIdentity.id, monitoringMetricsPublisher)
  scope: insights
  properties: { roleDefinitionId: monitoringMetricsPublisher, principalId: appIdentity.properties.principalId, principalType: 'ServicePrincipal' }
}
resource appSecretRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, appIdentity.id, keyVaultSecretsUser)
  scope: vault
  properties: { roleDefinitionId: keyVaultSecretsUser, principalId: appIdentity.properties.principalId, principalType: 'ServicePrincipal' }
}

resource workerCryptoRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, workerIdentity.id, cryptoEncryptionUser)
  scope: vault
  properties: { roleDefinitionId: cryptoEncryptionUser, principalId: workerIdentity.properties.principalId, principalType: 'ServicePrincipal' }
}
resource workerAcrRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, workerIdentity.id, acrPull)
  scope: registry
  properties: { roleDefinitionId: acrPull, principalId: workerIdentity.properties.principalId, principalType: 'ServicePrincipal' }
}

resource staticWeb 'Microsoft.Web/staticSites@2025-03-01' = {
  name: '${baseName}-web'
  location: staticWebLocation
  sku: { name: 'Free', tier: 'Free' }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
  }
}

module storageAccess 'storage-access.bicep' = {
  name: 'hukumid-storage-access'
  scope: resourceGroup(storageResourceGroupName)
  params: {
    storageAccountName: storageAccountName
    appIdentityId: appIdentity.id
    appPrincipalId: appIdentity.properties.principalId
    workerIdentityId: workerIdentity.id
    workerPrincipalId: workerIdentity.properties.principalId
  }
}

var commonEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'PORT', value: '3001' }
  { name: 'AZURE_CLIENT_ID', value: appIdentity.properties.clientId }
  { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: storage.name }
  { name: 'AZURE_KEY_VAULT_KEY_ID', value: uploadKey.properties.keyUriWithVersion }
  { name: 'ENTRA_TENANT_ID', value: entraTenantId }
  { name: 'ENTRA_CLIENT_ID', value: entraClientId }
  { name: 'HUKUM_ALLOWED_ORIGINS', value: 'https://${staticWeb.properties.defaultHostname}' }
  { name: 'GEMINI_MODEL', value: 'gemini-2.5-flash' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
  { name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING', value: 'Authorization=AAD;ClientId=${appIdentity.properties.clientId}' }
  { name: 'OTEL_SERVICE_NAME', value: 'hukum-id-api' }
  { name: 'OTEL_TRACES_SAMPLER', value: 'microsoft.fixed_percentage' }
  { name: 'OTEL_TRACES_SAMPLER_ARG', value: '0.2' }
]

resource api 'Microsoft.App/containerApps@2025-07-01' = if (deployRuntime) {
  name: '${baseName}-api'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${appIdentity.id}': {} }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Multiple'
      ingress: {
        external: true
        targetPort: 3001
        transport: 'http'
        allowInsecure: false
        traffic: [{ weight: 100, latestRevision: true }]
      }
      registries: [{ server: registry.properties.loginServer, identity: appIdentity.id }]
      secrets: empty(geminiApiKey) ? [] : [{ name: 'gemini-api-key', identity: appIdentity.id, keyVaultUrl: geminiSecret!.properties.secretUriWithVersion }]
    }
    template: {
      containers: [{
        name: 'api'
        image: appImage
        env: concat(commonEnv, empty(geminiApiKey) ? [] : [{ name: 'GEMINI_API_KEY', secretRef: 'gemini-api-key' }])
        resources: { cpu: json('0.5'), memory: '1Gi' }
        probes: [
          { type: 'Liveness', httpGet: { path: '/health', port: 3001 }, initialDelaySeconds: 15, periodSeconds: 30 }
          { type: 'Readiness', httpGet: { path: '/health', port: 3001 }, initialDelaySeconds: 5, periodSeconds: 10 }
        ]
      }]
      scale: {
        minReplicas: 1
        maxReplicas: 10
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }]
      }
    }
  }
  dependsOn: [storageAccess, appCryptoRole, appAcrRole, appMonitorRole, appSecretRole]
}

resource uploadSweeper 'Microsoft.App/jobs@2025-07-01' = if (deployRuntime) {
  name: '${baseName}-upload-sweeper'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${workerIdentity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 900
      replicaRetryLimit: 2
      scheduleTriggerConfig: { cronExpression: '15 * * * *', parallelism: 1, replicaCompletionCount: 1 }
      registries: [{ server: registry.properties.loginServer, identity: workerIdentity.id }]
    }
    template: {
      containers: [{
        name: 'sweeper'
        image: appImage
        command: ['node']
        args: ['dist/workers/sweep-uploads.js']
        env: [
          { name: 'NODE_ENV', value: 'production' }
          { name: 'AZURE_CLIENT_ID', value: workerIdentity.properties.clientId }
          { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: storage.name }
          { name: 'AZURE_KEY_VAULT_KEY_ID', value: uploadKey.properties.keyUriWithVersion }
        ]
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
      }]
    }
  }
  dependsOn: [storageAccess, workerCryptoRole, workerAcrRole]
}

module budget 'budget.bicep' = if (monthlyBudgetAmount > 0 && length(budgetContactEmails) > 0) {
  name: 'hukumid-budget'
  scope: subscription()
  params: {
    name: '${baseName}-monthly-budget'
    amount: monthlyBudgetAmount
    contactEmails: budgetContactEmails
    startDate: budgetStartDate
    resourceGroupId: resourceGroup().id
  }
}

output apiUrl string = deployRuntime ? 'https://${api!.properties.configuration.ingress.fqdn}' : ''
output staticWebUrl string = 'https://${staticWeb.properties.defaultHostname}'
output registryName string = registry.name
output managedIdentityClientId string = appIdentity.properties.clientId
output uploadKeyId string = uploadKey.properties.keyUriWithVersion
output insightsConnectionString string = insights.properties.ConnectionString
