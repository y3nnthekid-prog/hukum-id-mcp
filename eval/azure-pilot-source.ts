import { publicPilotPin } from "./azure-pasla.js";
import { checkPassage } from "../src/core/sintesis.js";
import type { HasilBuka } from "../src/core/sumber.js";

/** Both a first fetch and a manual continuation must pass the same local checks. */
export function frozenPilotSource(raw: string, pinnedPublicKey: string) {
  const pin = publicPilotPin(pinnedPublicKey);
  const parsed: { source: { data: HasilBuka[] }; publicKeyPem: string } = JSON.parse(raw);
  if (publicPilotPin(parsed.publicKeyPem) !== pin) throw new Error("SOURCE_PIN");
  const source = parsed.source;
  const opened = source.data?.[0]; const passage = opened?.potongan?.[0];
  if (source.data.length !== 1 || opened?.status !== "dibuka" || opened.potongan.length !== 1 || !passage || passage.documentId !== "perma-14-2016" || passage.locator.pasal !== "Pasal 2" || passage.contentHash !== "2fbc035cfb378e0c004d7c35951f823f0c9cac4c6a20f2ffb797eda43955c296" || checkPassage(passage, [pin])) throw new Error("SOURCE_PIN_OR_HASH");
  return { passage, frozen: JSON.stringify({ source, publicKeyPem: pin }, null, 2) };
}
