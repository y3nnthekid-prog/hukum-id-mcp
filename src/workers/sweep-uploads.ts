#!/usr/bin/env node

import { createAzureSecureUploadService } from "../storage/azure.js";

const service = await createAzureSecureUploadService();
const result = await service.sweepExpired();
console.log(JSON.stringify(result));
