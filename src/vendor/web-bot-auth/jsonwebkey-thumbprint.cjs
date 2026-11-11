Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
// src/index.ts
const jwkThumbprintPreCompute = (jwk) => {
	const encoder = new TextEncoder();
	switch (jwk.kty) {
		case "EC": return encoder.encode(`{"crv":"${jwk.crv}","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`);
		case "OKP": return encoder.encode(`{"crv":"${jwk.crv}","kty":"OKP","x":"${jwk.x}"}`);
		case "RSA": return encoder.encode(`{"e":"${jwk.e}","kty":"RSA","n":"${jwk.n}"}`);
		default: throw new Error("Unsupported key type");
	}
};
const jwkThumbprint = async (jwk, hash, decode) => {
	return decode(await hash(jwkThumbprintPreCompute(jwk)));
};
exports.jwkThumbprint = jwkThumbprint;
exports.jwkThumbprintPreCompute = jwkThumbprintPreCompute;
