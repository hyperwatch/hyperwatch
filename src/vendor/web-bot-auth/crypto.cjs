Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let http_message_sig = require("./http-message-sig.cjs");
let jsonwebkey_thumbprint = require("./jsonwebkey-thumbprint.cjs");
// src/crypto.ts
function base64Url(buffer) {
	return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function keyid(jwk) {
	return (0, jsonwebkey_thumbprint.jwkThumbprint)(jwk, (value) => crypto.subtle.digest("SHA-256", value), base64Url);
}
function jwkAlgorithm(jwk) {
	if (jwk.kty === "OKP" && jwk.crv === "Ed25519") {
		if (jwk.alg !== void 0 && jwk.alg !== "EdDSA") throw new Error("Ed25519 JWK alg must be EdDSA when present");
		return "ed25519";
	}
	if (jwk.kty === "RSA" && (jwk.alg === void 0 || jwk.alg === "PS512")) return "rsa-pss-sha512";
	throw new Error("JWK must be Ed25519 or RSA-PSS/SHA-512");
}
function importAlgorithm(algorithm) {
	return algorithm === "ed25519" ? { name: "Ed25519" } : {
		name: "RSA-PSS",
		hash: "SHA-512"
	};
}
function publicJwk(jwk, algorithm) {
	if (algorithm === "ed25519") return {
		kty: "OKP",
		crv: "Ed25519",
		alg: "EdDSA",
		x: jwk.x
	};
	return {
		kty: "RSA",
		alg: "PS512",
		e: jwk.e,
		n: jwk.n
	};
}
async function signerFromJWK(jwk) {
	const algorithm = jwkAlgorithm(jwk);
	const key = await crypto.subtle.importKey("jwk", jwk, importAlgorithm(algorithm), false, ["sign"]);
	const signer = http_message_sig.webcrypto.signer(key);
	if (signer.algorithm !== algorithm) throw new Error("imported CryptoKey algorithm does not match JWK");
	return Object.freeze({
		algorithm,
		keyid: await keyid(jwk),
		sign(data) {
			return signer.sign(data);
		}
	});
}
async function verifierFromJWK(jwk) {
	const algorithm = jwkAlgorithm(jwk);
	const key = await crypto.subtle.importKey("jwk", publicJwk(jwk, algorithm), importAlgorithm(algorithm), false, ["verify"]);
	const verifier = http_message_sig.webcrypto.verifier(key);
	if (verifier.algorithm !== algorithm) throw new Error("imported CryptoKey algorithm does not match JWK");
	return Object.freeze({
		algorithm,
		keyid: await keyid(jwk),
		verify(data, signature) {
			return verifier.verify(data, signature);
		}
	});
}
exports.signerFromJWK = signerFromJWK;
exports.verifierFromJWK = verifierFromJWK;
