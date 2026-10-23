# Chat preview implementation — not yet accepted

The approved conversational scope is online shopping, work, and simple rent/debt. Existing material campaign remains open and separate. New chat code is initially disabled (`CHAT_ENABLED` on web, `PASLA_CHAT_ENABLED` on engine).

New campaign `chat-preview-20261023`: USD10 and 200 **reserved** calls. Each admitted turn reserves 3 × (20000 input × USD0.25/M + 4096 output × USD2/M) = 39576 microUSD. Failed, uncertain and unused reservations are retained. Actual calls/tokens are recorded separately; prices are conservative application configuration, not an Azure billing cap. Old USD1/36 campaign is unchanged.

23 October Azure metadata: resource/deployment PASLA/pasla-chat, Korea Central, GlobalStandard, gpt-5-mini2025-08-07. Initial capacity10 allowed10 requests/60s and10000 tokens/60s. Regional quota1000units/current10 permitted increasing this preview deployment to100. Post-change response confirms100 requests/60s and100000 tokens/60s with the same model/version. New chat's conservative full-call pacing is therefore15seconds; actual end-to-end response time is still to be measured.

Worker stores private conversation titles/messages in content tables, operational turn IDs/status/usage separately. New additive migration0005 includes atomic budget, ownership/version and active-turn admission. Completion uses a D1 transaction fencing cancellation/deletion/version/consent/email. Account deletion cascades; account export includes chat tables. Backups discover migrations and export all preview tables. Encrypted historical backups keep their seven-day retention; no remote restore is claimed.

The single pinned preview VPS uses the existing durable SQLite replay/gate file outside releases. Do not run multiple hosts or restore an older replay file while tickets are live. Both old and new Azure requests share one gate; old pilot's65-second policy remains its default, while chat pacing comes from verified deployment RPM/TPM. Unknown dispatch outcomes retain the120-second engine lease. No paid auto-retry.

Schema and quotes prove structure/integrity only. A separate model judges paraphrase support, classification, facts, negation and exceptions. This can still miss legal errors. No global legal-quality or current-law certification is implied.

Acceptance pending: browser regression/preview rollout, real signed account journey,18×3 synthetic conversations with two review passes, source register for three initial needs, costs and timings. Local test results alone do not close these gates.
