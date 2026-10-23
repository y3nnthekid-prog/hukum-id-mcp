import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { AZURE_PASLA, createAzurePilotModel, publicPilotPin } from "../eval/azure-pasla.js";
import { frozenPilotSource } from "../eval/azure-pilot-source.js";

const schema = z.object({ status: z.string() });
const result = (extra = {}) => Response.json({ model: "gpt-5-mini-2025-08-07", choices: [{ finish_reason: "stop", message: { content: '{"status":"ok"}' } }], usage: { prompt_tokens: 25, completion_tokens: 30 }, ...extra });

test("Azure pilot pins the Pasla deployment, sends supported structured-output parameters and records its transport", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const pilot = createAzurePilotModel({ apiKey: "synthetic-key-only", maxUsd: 1, fetchImpl: async (url, init) => { requests.push({ url, init }); return result(); } });
  assert.deepEqual(await pilot.model.generate({ system: "Return JSON", user: "Synthetic", schema, effort: "low", allowRetries: false, maxOutputTokens: 2500 }), { status: "ok" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, "https://pasla.openai.azure.com/openai/v1/chat/completions");
  assert.equal(requests[0]!.init.redirect, "error");
  assert.equal((requests[0]!.init.headers as Record<string, string>)["api-key"], "synthetic-key-only");
  const body = JSON.parse(String(requests[0]!.init.body));
  assert.equal(body.model, "pasla-chat"); assert.equal(body.max_completion_tokens, 2500);
  assert.equal(body.reasoning_effort, "low"); assert.equal(body.temperature, undefined); assert.equal(body.max_tokens, undefined);
  assert.equal(body.response_format.type, "json_schema"); assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema.required, ["status"]);
  assert.equal(pilot.model.model, "azure:pasla-chat:gpt-5-mini:2025-08-07");
  assert.equal(pilot.summary().transport, "azure-openai"); assert.equal(pilot.summary().calls, 1);
  assert.equal(pilot.summary().usage.length, 1); assert.equal(AZURE_PASLA.deployment, "pasla-chat");
});

test("Azure pilot reserves failed requests without retries and never returns provider bodies or credentials", async () => {
  let calls = 0;
  const pilot = createAzurePilotModel({ apiKey: "synthetic-key-only", maxUsd: 1, fetchImpl: async () => { calls++; return new Response("synthetic-key-only private echoed body", { status: 429 }); } });
  await assert.rejects(pilot.model.generate({ system: "JSON", user: "Synthetic", schema, effort: "low" }), error => error instanceof Error && !/synthetic-key|echoed body/.test(error.message));
  assert.equal(calls, 1); assert.equal(pilot.summary().calls, 1); assert.ok(pilot.summary().reservedUsd > 0);
  assert.equal(pilot.summary().lastFailure, "HTTP_429");
  assert.equal(JSON.stringify(pilot.summary()).includes("synthetic-key-only"), false);
});
test('Azure 429 exposes only a bounded wait hint and does not retry',async()=>{
 for(const [headers,expected] of [[{'retry-after-ms':'1501'},2],[{'retry-after':'75'},75],[{'retry-after':'999999'},86400],[{'retry-after-ms':'invalid'},60]] as const){
  let calls=0;const pilot=createAzurePilotModel({apiKey:'synthetic-key-only',maxUsd:1,fetchImpl:async()=>{calls++;return new Response('private provider response',{status:429,headers});}});
  await assert.rejects(pilot.model.generate({system:'JSON',user:'Synthetic',schema,effort:'low'}));assert.equal(calls,1);assert.equal(pilot.summary().retryAfterSeconds,expected);assert.ok(!JSON.stringify(pilot.summary()).includes('private provider'));
 }
});

test("Azure wire schemas omit unsupported constraints without removing property names or local validation", async () => {
  let body: any;
  const bounded = z.object({ maxLength: z.array(z.object({ format: z.string().min(3).max(8) })).min(1).max(2) });
  const pilot = createAzurePilotModel({ apiKey: "synthetic-key-only", maxUsd: 1, fetchImpl: async (_url, init) => {
    body = JSON.parse(String(init.body));
    return result({ choices: [{ finish_reason: "stop", message: { content: '{"maxLength":[{"format":"x"}]}' } }] });
  } });
  await assert.rejects(pilot.model.generate({ system: "JSON", user: "Synthetic", schema: bounded, effort: "low" }));
  const wire = body.response_format.json_schema.schema;
  assert.equal(wire.properties.maxLength.minItems, undefined);
  assert.equal(wire.properties.maxLength.maxItems, undefined);
  assert.equal(wire.properties.maxLength.items.properties.format.minLength, undefined);
  assert.match(wire.properties.maxLength.description, /maxItems.*2/);
  assert.match(wire.properties.maxLength.items.properties.format.description, /minLength.*3/);
  assert.equal(pilot.summary().validationIssues[0]?.code, "too_small");
  assert.deepEqual(wire.required, ["maxLength"]);
  assert.deepEqual(wire.properties.maxLength.items.required, ["format"]);
});

test("Azure pilot stops before network on exhausted cost/call limits, oversized input or cancellation", async () => {
  let calls = 0;
  const options = { apiKey: "synthetic-key-only", maxUsd: 1, fetchImpl: async () => { calls++; return result(); } };
  const tiny = createAzurePilotModel({ ...options, maxUsd: 0.000001 });
  await assert.rejects(tiny.model.generate({ system: "JSON", user: "Synthetic", schema, effort: "low" }), /BUDGET/);
  const capped = createAzurePilotModel({ ...options, maxCalls: 1 });
  await capped.model.generate({ system: "JSON", user: "Synthetic", schema, effort: "low" });
  await assert.rejects(capped.model.generate({ system: "JSON", user: "Synthetic", schema, effort: "low" }), /CALL_LIMIT/);
  await assert.rejects(createAzurePilotModel(options).model.generate({ system: "JSON", user: "x".repeat(21000), schema, effort: "low" }), /INPUT_LIMIT/);
  await assert.rejects(createAzurePilotModel(options).model.generate({ system: "JSON", user: "Synthetic", schema, effort: "low", signal: AbortSignal.abort() }));
  assert.equal(calls, 1);
});

test("Azure pilot rejects model drift, truncated results and malformed JSON without retrying", async () => {
  for (const response of [result({ model: "different-model" }), result({ choices: [{ finish_reason: "length", message: { content: '{"status":"ok"}' } }] }), result({ choices: [{ finish_reason: "stop", message: { content: "not JSON" } }] }), result({ usage: { prompt_tokens: -1, completion_tokens: 4 } })]) {
    let calls = 0;
    const pilot = createAzurePilotModel({ apiKey: "synthetic-key-only", maxUsd: 1, fetchImpl: async () => { calls++; return response; } });
    await assert.rejects(pilot.model.generate({ system: "JSON", user: "Synthetic", schema, effort: "medium" }));
    assert.equal(calls, 1);
  }
  for (const maxUsd of [0, -1, NaN, Infinity, 2]) assert.throws(() => createAzurePilotModel({ apiKey: "synthetic-key-only", maxUsd }), /CONFIG/);
});

test("Azure pilot retains paid usage on model drift and only accepts public pin material", async () => {
  const pilot = createAzurePilotModel({ apiKey: "synthetic-key-only", maxUsd: 1, fetchImpl: async () => result({ model: "different-model" }) });
  await assert.rejects(pilot.model.generate({ system: "JSON", user: "Synthetic", schema, effort: "low" }));
  assert.equal(pilot.summary().usage.length, 1);
  assert.equal(pilot.summary().lastFailure, "MODEL_DRIFT");
  assert.ok(pilot.summary().estimatedUsageUsd > 0);
  const keys = generateKeyPairSync("ed25519");
  const publicPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privatePem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.equal(publicPilotPin(publicPem.replace(/\n/g, "\r\n")), publicPem);
  for (const bad of [privatePem, publicPem + privatePem, "garbage", publicPem + "extra"]) assert.throws(() => publicPilotPin(bad), /PUBLIC_PIN/);
});

test("continuation validates and reuses the identical frozen public evidence without network", async () => {
  const frozen = await readFile(new URL("./fixtures/azure-pilot-source.json", import.meta.url), "utf8");
  const data = JSON.parse(frozen);
  const checked = frozenPilotSource(frozen, data.publicKeyPem);
  assert.equal(checked.frozen, frozen);
  assert.equal(checked.passage.documentId, "perma-14-2016");
  data.source.data[0].potongan[0].text += "changed";
  assert.throws(() => frozenPilotSource(JSON.stringify(data), data.publicKeyPem), /SOURCE_PIN_OR_HASH/);
  const wrongPin = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.throws(() => frozenPilotSource(frozen, wrongPin), /SOURCE_PIN/);
});

test("explicit Azure reasoning pilot profile sends low/4096 and identifies the override in signed model metadata", async () => {
  let request: any;
  const pilot = createAzurePilotModel({ apiKey: "synthetic-key-only", maxUsd: 1, profile: "low-4096", fetchImpl: async (_url, init) => { request = JSON.parse(String(init.body)); return result(); } });
  await pilot.model.generate({ system: "JSON", user: "Synthetic", schema, effort: "medium", maxOutputTokens: 2500 });
  assert.equal(request.reasoning_effort, "low");
  assert.equal(request.max_completion_tokens, 4096);
  assert.equal(pilot.summary().profile, "low-4096");
  assert.equal(pilot.model.model, AZURE_PASLA.identity + ":low-4096");
});

test("overlapping Azure requests cannot both pass a one-call budget", async () => {
  let finish!: (response: Response) => void;
  let calls = 0;
  const pilot = createAzurePilotModel({ apiKey: "synthetic-key-only", maxUsd: 1, maxCalls: 1, fetchImpl: () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); } });
  const pending = pilot.model.generate({ system: "JSON", user: "Synthetic", schema, effort: "low" });
  await assert.rejects(pilot.model.generate({ system: "JSON", user: "Synthetic", schema, effort: "low" }), /CALL_LIMIT/);
  assert.equal(calls, 1);
  finish(result());
  await pending;
  assert.equal(pilot.summary().calls, 1);
});
