param storageAccountName string
param appIdentityId string
param appPrincipalId string
param workerIdentityId string
param workerPrincipalId string

var blobContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var queueContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '974c5e8b-45b9-4653-ba55-5f855dd0fb88')
var tableContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}

resource rawContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'corpus-raw'
  properties: { publicAccess: 'None' }
}
resource derivedContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'corpus-derived'
  properties: { publicAccess: 'None' }
}
resource indexContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'index-releases'
  properties: { publicAccess: 'None' }
}
resource uploadContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'user-uploads'
  properties: { publicAccess: 'None' }
}
resource exportContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'exports'
  properties: { publicAccess: 'None' }
}

resource appBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, appIdentityId, blobContributor)
  scope: storage
  properties: { roleDefinitionId: blobContributor, principalId: appPrincipalId, principalType: 'ServicePrincipal' }
}
resource appQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, appIdentityId, queueContributor)
  scope: storage
  properties: { roleDefinitionId: queueContributor, principalId: appPrincipalId, principalType: 'ServicePrincipal' }
}
resource appTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, appIdentityId, tableContributor)
  scope: storage
  properties: { roleDefinitionId: tableContributor, principalId: appPrincipalId, principalType: 'ServicePrincipal' }
}
resource workerBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, workerIdentityId, blobContributor)
  scope: storage
  properties: { roleDefinitionId: blobContributor, principalId: workerPrincipalId, principalType: 'ServicePrincipal' }
}
resource workerQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, workerIdentityId, queueContributor)
  scope: storage
  properties: { roleDefinitionId: queueContributor, principalId: workerPrincipalId, principalType: 'ServicePrincipal' }
}
resource workerTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, workerIdentityId, tableContributor)
  scope: storage
  properties: { roleDefinitionId: tableContributor, principalId: workerPrincipalId, principalType: 'ServicePrincipal' }
}
