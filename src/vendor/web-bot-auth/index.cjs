Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let http_message_sig = require("./http-message-sig.cjs");
let jsonwebkey_thumbprint = require("./jsonwebkey-thumbprint.cjs");
let structured_headers = require("structured-headers");
// src/registry.ts
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function stringValue(value, field) {
	if (value === void 0) return;
	if (typeof value !== "string") throw new Error(`${field} must be a string`);
	return value;
}
function stringArray(value, field) {
	if (value === void 0) return;
	if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings`);
	const output = [];
	for (const entry of value) {
		if (typeof entry !== "string") throw new Error(`${field} must be an array of strings`);
		output.push(entry);
	}
	return output;
}
function uriArray(value, field) {
	const values = stringArray(value, field);
	if (values === void 0) return;
	for (const uri of values) new URL(uri);
	return values;
}
function urlValue(value, field, allowedProtocols) {
	const parsed = stringValue(value, field);
	if (parsed === void 0) return;
	const url = new URL(parsed);
	if (!allowedProtocols.includes(url.protocol)) throw new Error(`${field} must use one of: ${allowedProtocols.join(", ")}`);
	return parsed;
}
function jwksValue(value) {
	if (value === void 0) return;
	if (!isRecord(value) || !Array.isArray(value.keys)) throw new Error("jwks must be a JWK Set");
	const keys = [];
	for (const key of value.keys) {
		if (!isRecord(key)) throw new Error("jwks keys must be objects");
		keys.push(key);
	}
	return { keys };
}
function triggerValue(value) {
	const parsed = stringValue(value, "trigger");
	if (parsed === void 0) return;
	if (parsed === "fetcher" || parsed === "crawler") return parsed;
	throw new Error("trigger must be fetcher or crawler");
}
function validateDiscoveryURI(uri) {
	if (new URL(uri).protocol !== "https:") throw new Error("Signature-Agent must use https");
}
function parseSignatureAgentHeader(header) {
	try {
		const dictionary = (0, structured_headers.parseDictionary)(header);
		if (dictionary.size === 0) throw new Error("Signature-Agent header must not be empty");
		const entries = [];
		for (const [label, value] of dictionary) {
			const [uri, params] = value;
			if (typeof uri !== "string") throw new Error("Signature-Agent values must be strings");
			const type = params.get("type");
			if (params.size !== 0 && !(params.size === 1 && type instanceof structured_headers.Token && type.toString() === "cimd")) continue;
			validateDiscoveryURI(uri);
			entries.push(type === void 0 ? {
				label,
				uri
			} : {
				label,
				uri,
				type: "cimd"
			});
		}
		return {
			kind: "current",
			entries
		};
	} catch (dictionaryError) {
		if (/^https:\/\/[^\s"(),;<>\\]+$/.test(header)) try {
			validateDiscoveryURI(header);
			return {
				kind: "legacy",
				entries: [{
					label: "",
					uri: header
				}]
			};
		} catch {}
		try {
			const [uri, params] = (0, structured_headers.parseItem)(header);
			if (typeof uri !== "string") throw new Error("legacy Signature-Agent must be a string", { cause: dictionaryError });
			if (params.size !== 0) throw new Error("legacy Signature-Agent must not carry parameters");
			validateDiscoveryURI(uri);
			return {
				kind: "legacy",
				entries: [{
					label: "",
					uri
				}]
			};
		} catch (itemError) {
			throw new Error(`failed to parse Signature-Agent header: ${errorMessage(dictionaryError)}; ${errorMessage(itemError)}`, { cause: itemError });
		}
	}
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
function stripRegistryComment(line) {
	for (let index = 0; index < line.length; index += 1) if (line.charAt(index) === "#" && (index === 0 || /\s/.test(line.charAt(index - 1)))) return line.slice(0, index).trim();
	return line.trim();
}
function parseRegistry(registry) {
	const entries = [];
	for (const [index, rawLine] of registry.split(/\r\n|\n|\r/).entries()) {
		const line = stripRegistryComment(rawLine);
		if (line === "") continue;
		const url = new URL(line);
		if (url.protocol === "data:") throw new Error("inline signature agent cards are not supported");
		if (url.protocol !== "https:") throw new Error(`registry line ${index + 1}: registry entries must use https`);
		entries.push(url);
	}
	return entries;
}
function webBotAuthValue(value) {
	if (value === void 0) return;
	if (!isRecord(value)) throw new Error("web_bot_auth must be an object");
	const metadata = {
		"expected-user-agent": stringValue(value["expected-user-agent"], "expected-user-agent"),
		"rfc9309-product-token": stringValue(value["rfc9309-product-token"], "rfc9309-product-token"),
		"rfc9309-compliance": stringArray(value["rfc9309-compliance"], "rfc9309-compliance"),
		trigger: triggerValue(value.trigger),
		purpose: stringValue(value.purpose, "purpose"),
		"targeted-content": stringValue(value["targeted-content"], "targeted-content"),
		"rate-control": stringValue(value["rate-control"], "rate-control"),
		"rate-expectation": stringValue(value["rate-expectation"], "rate-expectation"),
		"known-urls": stringArray(value["known-urls"], "known-urls"),
		ips_uri: urlValue(value.ips_uri, "ips_uri", ["https:"])
	};
	return Object.fromEntries(Object.entries(metadata).filter((entry) => entry[1] !== void 0));
}
function parseSignatureAgentCard(input, cardURL) {
	if (!isRecord(input)) throw new Error("signature agent card must be an object");
	const card = {
		client_id: urlValue(input.client_id, "client_id", ["https:"]),
		client_name: stringValue(input.client_name, "client_name"),
		client_uri: urlValue(input.client_uri, "client_uri", ["http:", "https:"]),
		logo_uri: urlValue(input.logo_uri, "logo_uri", [
			"http:",
			"https:",
			"data:"
		]),
		contacts: uriArray(input.contacts, "contacts"),
		jwks_uri: urlValue(input.jwks_uri, "jwks_uri", ["https:"]),
		jwks: jwksValue(input.jwks),
		ips_uri: urlValue(input.ips_uri, "ips_uri", ["https:"]),
		web_bot_auth: webBotAuthValue(input.web_bot_auth)
	};
	if (card.jwks !== void 0 && card.jwks_uri !== void 0) throw new Error("card must not contain both jwks and jwks_uri");
	if (card.jwks === void 0 && card.jwks_uri === void 0) throw new Error("card must contain either jwks or jwks_uri");
	if (cardURL !== void 0 && card.client_id === void 0) throw new Error("client_id is required when card URL is known");
	if (cardURL !== void 0 && card.client_id !== void 0 && card.client_id !== cardURL) throw new Error("client_id must match the card URL");
	const output = Object.fromEntries(Object.entries(card).filter((entry) => entry[1] !== void 0));
	if (Object.keys(output).length === 0) throw new Error("signature agent card must contain at least one parameter");
	return output;
}
// src/index.ts
const HTTP_MESSAGE_SIGNATURE_TAG = "web-bot-auth";
const SIGNATURE_AGENT_HEADER = "signature-agent";
const HTTP_MESSAGE_SIGNATURES_DIRECTORY = "/.well-known/http-message-signatures-directory";
const NONCE_LENGTH_IN_BYTES = 64;
function policyError(message) {
	throw new http_message_sig.SignatureError(http_message_sig.SignatureErrorCode.PolicyViolation, message);
}
function seconds(date, name) {
	const milliseconds = date.getTime();
	if (!Number.isFinite(milliseconds)) return policyError(`${name} must be a valid date`);
	return Math.floor(milliseconds / 1e3);
}
function base64(bytes) {
	return btoa(String.fromCharCode(...bytes));
}
function base64Url(bytes) {
	return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeBase64(value) {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const remainder = normalized.length % 4;
	if (remainder === 1) return void 0;
	const padded = normalized + "=".repeat((4 - remainder) % 4);
	try {
		return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
	} catch {
		return;
	}
}
function generateNonce() {
	const nonce = /* @__PURE__ */ new Uint8Array(64);
	crypto.getRandomValues(nonce);
	return base64(nonce);
}
function validateNonce(nonce) {
	if (typeof nonce !== "string") return false;
	const decoded = decodeBase64(nonce);
	return decoded !== void 0 && decoded.length === 64 && (base64(decoded) === nonce || base64Url(decoded) === nonce);
}
function requestHeader(request, name) {
	if ("kind" in request) {
		const values = request.fields.filter((field) => field.name.toLowerCase() === name).map((field) => field.value.trim());
		return values.length === 0 ? void 0 : values.join(", ");
	}
	return request.headers.get(name) ?? void 0;
}
function signingSignatureAgent(request, key) {
	const header = requestHeader(request, SIGNATURE_AGENT_HEADER);
	if (header === void 0) return void 0;
	const parsed = parseSignatureAgentHeader(header);
	if (parsed.kind === "legacy") {
		if (parsed.entries[0] === void 0) return policyError("Signature-Agent is empty");
		return Object.freeze({ component: SIGNATURE_AGENT_HEADER });
	}
	if (parsed.entries.find((candidate) => candidate.label === key) === void 0) return policyError(`Signature-Agent has no supported member ${key}`);
	return Object.freeze({ component: (0, http_message_sig.component)(SIGNATURE_AGENT_HEADER, { key }) });
}
function hasExactBareTarget(components) {
	return components.some(({ name, parameters }) => (name === "@authority" || name === "@target-uri") && Object.keys(parameters).length === 0);
}
function verifiedSignatureAgent(request, components) {
	const header = requestHeader(request, SIGNATURE_AGENT_HEADER);
	if (header === void 0) return void 0;
	const parsed = parseSignatureAgentHeader(header);
	if (parsed.kind === "legacy") {
		if (!components.some(({ name, parameters }) => name === "signature-agent" && Object.keys(parameters).length === 0)) return policyError(`signature must cover ${SIGNATURE_AGENT_HEADER}`);
		const entry = parsed.entries[0];
		if (entry === void 0) return policyError("Signature-Agent is empty");
		return Object.freeze({ ...entry });
	}
	const keys = components.flatMap(({ name, parameters }) => {
		const entries = Object.entries(parameters);
		return name === "signature-agent" && entries.length === 1 && typeof parameters.key === "string" ? [parameters.key] : [];
	});
	if (keys.length !== 1) return policyError(`signature must cover exactly one ${SIGNATURE_AGENT_HEADER} member`);
	const entry = parsed.entries.find((candidate) => candidate.label === keys[0]);
	if (entry === void 0) return policyError(`Signature-Agent has no supported member ${keys[0]}`);
	return Object.freeze({ ...entry });
}
function signingOptions(request, options) {
	if (options.signer.algorithm !== "ed25519" && options.signer.algorithm !== "rsa-pss-sha512") return policyError("signer algorithm is unsupported");
	if (options.signer.keyid === "") return policyError("signer keyid must not be empty");
	const label = options.label ?? "sig1";
	const created = seconds(options.created ?? /* @__PURE__ */ new Date(), "created");
	const expires = seconds(options.expires, "expires");
	if (created > expires) return policyError("created must not be after expires");
	const agent = signingSignatureAgent(request, options.signatureAgentKey ?? label);
	const components = [options.target ?? "@authority"];
	if (agent !== void 0) components.push(agent.component);
	components.push(...options.additionalComponents ?? []);
	return {
		label,
		components,
		parameters: {
			created,
			keyid: options.signer.keyid,
			alg: options.signer.algorithm,
			expires,
			nonce: options.nonce,
			tag: HTTP_MESSAGE_SIGNATURE_TAG
		}
	};
}
async function sign(request, options) {
	return (0, http_message_sig.createSignature)(request, {
		...signingOptions(request, options),
		signer: options.signer
	});
}
function signSync(request, options) {
	return (0, http_message_sig.createSignatureSync)(request, {
		...signingOptions(request, options),
		signer: options.signer
	});
}
function profileCandidate(request, candidate) {
	const { algorithm, parameters, components } = candidate;
	if (algorithm !== void 0 && algorithm !== "ed25519" && algorithm !== "rsa-pss-sha512") return policyError("signed algorithm is unsupported");
	const keyid = parameters.keyid;
	if (typeof keyid !== "string" || keyid === "") return policyError("keyid must be a non-empty string");
	if (parameters.tag !== "web-bot-auth") return policyError(`tag must be '${HTTP_MESSAGE_SIGNATURE_TAG}'`);
	const created = parameters.created;
	const expires = parameters.expires;
	if (typeof created !== "number" || typeof expires !== "number") return policyError("created and expires must be integers");
	if (created > expires) return policyError("created must not be after expires");
	if (!hasExactBareTarget(components)) return policyError("signature must cover bare @authority or bare @target-uri");
	const agent = verifiedSignatureAgent(request, components);
	return Object.freeze({
		keyid,
		algorithm,
		signatureAgent: agent
	});
}
async function verify(request, options) {
	const algorithms = options.algorithms ?? ["ed25519", "rsa-pss-sha512"];
	const now = seconds(options.now ?? /* @__PURE__ */ new Date(), "now");
	let selected;
	const verified = await (0, http_message_sig.verifySignature)(request, {
		label: options.label,
		policy: {
			algorithms,
			requiredComponents: [],
			requiredParameters: [
				"created",
				"expires",
				"keyid",
				"tag"
			],
			maxAge: options.maxAge ?? 86400,
			clockSkew: options.clockSkew ?? 0,
			now
		},
		async resolveVerifier(candidate) {
			const profile = profileCandidate(request, candidate);
			selected = profile;
			const verifier = await options.resolver(profile);
			if (verifier.keyid !== profile.keyid) return policyError("resolved verifier keyid does not match signed keyid");
			return verifier;
		}
	});
	if (selected === void 0) return policyError("signature candidate was not resolved");
	const authenticatedCreated = verified.parameters.created;
	const authenticatedExpires = verified.parameters.expires;
	if (typeof authenticatedCreated !== "number" || typeof authenticatedExpires !== "number") return policyError("authenticated signature lacks timestamps");
	const result = Object.freeze({
		...verified,
		keyid: selected.keyid,
		created: /* @__PURE__ */ new Date(authenticatedCreated * 1e3),
		expires: /* @__PURE__ */ new Date(authenticatedExpires * 1e3),
		tag: HTTP_MESSAGE_SIGNATURE_TAG,
		nonce: verified.parameters.nonce,
		signatureAgent: selected.signatureAgent
	});
	if (options.validate !== void 0 && await options.validate(result) === false) return policyError("signature rejected by profile validation");
	return result;
}
exports.HTTP_MESSAGE_SIGNATURES_DIRECTORY = HTTP_MESSAGE_SIGNATURES_DIRECTORY;
exports.HTTP_MESSAGE_SIGNATURE_TAG = HTTP_MESSAGE_SIGNATURE_TAG;
exports.NONCE_LENGTH_IN_BYTES = NONCE_LENGTH_IN_BYTES;
exports.SIGNATURE_AGENT_HEADER = SIGNATURE_AGENT_HEADER;
exports.generateNonce = generateNonce;
Object.defineProperty(exports, "jwkToKeyID", {
	enumerable: true,
	get: function() {
		return jsonwebkey_thumbprint.jwkThumbprint;
	}
});
exports.parseRegistry = parseRegistry;
exports.parseSignatureAgentCard = parseSignatureAgentCard;
exports.parseSignatureAgentHeader = parseSignatureAgentHeader;
exports.sign = sign;
exports.signSync = signSync;
exports.validateNonce = validateNonce;
exports.verify = verify;
