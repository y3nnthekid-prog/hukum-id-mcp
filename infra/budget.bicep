targetScope = 'subscription'

param name string
param amount int
param contactEmails array
param startDate string
param resourceGroupId string

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: name
  properties: {
    amount: amount
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: { startDate: startDate }
    filter: {
      dimensions: {
        name: 'ResourceGroupName'
        operator: 'In'
        values: [last(split(resourceGroupId, '/'))]
      }
    }
    notifications: {
      Actual_GreaterThan_50_Percent: { enabled: true, operator: 'GreaterThan', threshold: 50, thresholdType: 'Actual', contactEmails: contactEmails, contactGroups: [], contactRoles: [] }
      Actual_GreaterThan_75_Percent: { enabled: true, operator: 'GreaterThan', threshold: 75, thresholdType: 'Actual', contactEmails: contactEmails, contactGroups: [], contactRoles: [] }
      Actual_GreaterThan_90_Percent: { enabled: true, operator: 'GreaterThan', threshold: 90, thresholdType: 'Actual', contactEmails: contactEmails, contactGroups: [], contactRoles: [] }
    }
  }
}
