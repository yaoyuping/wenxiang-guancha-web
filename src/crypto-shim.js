import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
export function createHash(name) {
  if (name !== "sha256") throw Error("Unsupported hash");
  let value = "";
  return {
    update(v) {
      value += v;
      return this;
    },
    digest(format) {
      if (format !== "hex") throw Error("Unsupported digest");
      return bytesToHex(sha256(new TextEncoder().encode(value)));
    },
  };
}
