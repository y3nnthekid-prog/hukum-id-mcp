using './main.bicep'

param prefix = 'hukumid'
param environmentName = 'pilot'
param location = 'southeastasia'
param imageTag = 'replace-with-git-sha'
param deployRuntime = true
param entraTenantId = '00000000-0000-0000-0000-000000000000'
param entraClientId = '00000000-0000-0000-0000-000000000000'
param storageAccountName = 'replaceexistingstorage'
param storageResourceGroupName = 'replace-existing-storage-rg'
param monthlyBudgetAmount = 0
param budgetContactEmails = []
