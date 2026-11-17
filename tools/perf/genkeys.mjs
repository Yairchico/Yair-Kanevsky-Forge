import { generateKeyPair, exportJWK, SignJWT } from "jose";
import fs from "node:fs";
const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: "local-1", alg: "ES256", use: "sig", key_ops: ["verify"] };
const privateJwk = await exportJWK(privateKey);
const hsSecret = "local-dev-secret-local-dev-secret-local-dev-secret";
const anonKey = await new SignJWT({ role: "anon" }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime("10y").sign(new TextEncoder().encode(hsSecret));
fs.writeFileSync(new URL("./keys.json", import.meta.url), JSON.stringify({ publicJwk, privateJwk, hsSecret, anonKey }, null, 1));
