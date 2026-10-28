// A fresh ES256 signing key as a JWK set, the format Supabase's signing_keys_path reads.
import { exportJWK, generateKeyPair } from "jose";
import { randomUUID } from "node:crypto";

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = await exportJWK(privateKey);
console.log(JSON.stringify([{ ...jwk, kid: randomUUID(), alg: "ES256", use: "sig", key_ops: ["sign", "verify"] }], null, 2));
