import { ManagedIdentityCredential } from "@azure/identity";
import { useAzureMonitor } from "@azure/monitor-opentelemetry";

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();
if (connectionString) {
  const clientId = process.env.AZURE_CLIENT_ID?.trim();
  const credential = clientId ? new ManagedIdentityCredential(clientId) : new ManagedIdentityCredential();
  useAzureMonitor({
    azureMonitorExporterOptions: { connectionString, credential },
    tracesPerSecond: 0,
    samplingRatio: 0.2,
    enableLiveMetrics: false,
    enableStandardMetrics: true,
    browserSdkLoaderOptions: { enabled: false },
    instrumentationOptions: {
      // Incoming HTTP dinonaktifkan agar URL/query privat tidak terkirim.
      // Route API dicatat manual melalui middleware dengan label terbatas.
      http: { enabled: false },
      console: { enabled: false },
      // Azure SDK spans dapat memuat nama blob/partition; nonaktif sampai ada
      // processor yang terbukti menghapus identifier tersebut.
      azureSdk: { enabled: false },
      mongoDb: { enabled: false },
      mySql: { enabled: false },
      postgreSql: { enabled: false },
      redis: { enabled: false },
      redis4: { enabled: false },
      bunyan: { enabled: false },
      winston: { enabled: false },
    },
  });
}

await import("./server.js");
