Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let structured_headers = require("structured-headers");
// src/errors.ts
const SignatureErrorCode = Object.freeze({
	MissingField: "MissingField",
	MalformedField: "MalformedField",
	LabelRequired: "LabelRequired",
	LabelMismatch: "LabelMismatch",
	DuplicateLabel: "DuplicateLabel",
	InvalidComponent: "InvalidComponent",
	DuplicateComponent: "DuplicateComponent",
	UnsupportedFeature: "UnsupportedFeature",
	AlgorithmMismatch: "AlgorithmMismatch",
	PolicyViolation: "PolicyViolation",
	VerificationFailed: "VerificationFailed",
	ResolverFailed: "ResolverFailed"
});
var SignatureError = class extends Error {
	constructor(code, message, cause) {
		super(message);
		this.name = "SignatureError";
		this.code = code;
		this.cause = cause;
	}
};
function isSignatureError(error) {
	return error instanceof SignatureError;
}
// src/webcrypto.ts
function rsaHashName(algorithm) {
	if (!("hash" in algorithm)) return void 0;
	const hash = algorithm.hash;
	if (typeof hash !== "object" || hash === null || !("name" in hash)) return;
	return typeof hash.name === "string" ? hash.name : void 0;
}
function signatureAlgorithm(key) {
	if (key.algorithm.name === "Ed25519") return "ed25519";
	if (key.algorithm.name === "RSA-PSS" && rsaHashName(key.algorithm) === "SHA-512") return "rsa-pss-sha512";
	throw new SignatureError(SignatureErrorCode.UnsupportedFeature, `Unsupported WebCrypto algorithm ${key.algorithm.name}`);
}
function cryptoParameters(key) {
	return key.algorithm.name === "RSA-PSS" ? {
		name: "RSA-PSS",
		saltLength: 64
	} : { name: key.algorithm.name };
}
function createWebCryptoSigner(key) {
	if (key.type !== "private" || !key.usages.includes("sign")) throw new SignatureError(SignatureErrorCode.PolicyViolation, "Signing requires a private key with sign usage");
	const algorithm = signatureAlgorithm(key);
	const parameters = cryptoParameters(key);
	return Object.freeze({
		algorithm,
		async sign(data) {
			return new Uint8Array(await crypto.subtle.sign(parameters, key, data));
		}
	});
}
function createWebCryptoVerifier(key) {
	if (key.type !== "public" || !key.usages.includes("verify")) throw new SignatureError(SignatureErrorCode.PolicyViolation, "Verification requires a public key with verify usage");
	const algorithm = signatureAlgorithm(key);
	const parameters = cryptoParameters(key);
	return Object.freeze({
		algorithm,
		verify(data, signature) {
			return crypto.subtle.verify(parameters, key, signature, data);
		}
	});
}
// src/core.ts
const encoder = new TextEncoder();
const fieldNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const sfKeyPattern = /^[a-z*][a-z0-9_.*-]*$/;
const derivedComponents = /* @__PURE__ */ new Set([
	"@method",
	"@target-uri",
	"@authority",
	"@scheme",
	"@request-target",
	"@path",
	"@query",
	"@status"
]);
const unsupportedParameters = /* @__PURE__ */ new Set([
	"sf",
	"bs",
	"tr"
]);
function fail(code, message, cause) {
	throw new SignatureError(code, message, cause);
}
function cloneBareItem(value) {
	if (value instanceof ArrayBuffer) return value.slice(0);
	return value;
}
function validateParameterName(name) {
	if (!sfKeyPattern.test(name)) fail(SignatureErrorCode.MalformedField, `Invalid parameter name ${name}`);
}
function validateSerializableBareItem(value, location) {
	try {
		(0, structured_headers.serializeItem)(value);
	} catch (error) {
		fail(SignatureErrorCode.MalformedField, `Invalid ${location}`, error);
	}
}
function isRfc8941BareItem(value) {
	return !(value instanceof Date) && !(value instanceof structured_headers.DisplayString);
}
function validateBareItem(value, location) {
	if (!isRfc8941BareItem(value)) return fail(SignatureErrorCode.UnsupportedFeature, `${location} uses an RFC 9651-only value`);
	return cloneBareItem(value);
}
function copyParameters(input) {
	const output = {};
	for (const [name, value] of Object.entries(input)) {
		validateParameterName(name);
		if (value !== void 0) {
			validateSerializableBareItem(value, `parameter ${name}`);
			output[name] = cloneBareItem(value);
		}
	}
	validateKnownParameters(output);
	return Object.freeze(output);
}
function validateKnownParameters(parameters) {
	for (const name of ["created", "expires"]) {
		const value = parameters[name];
		if (value !== void 0 && (!Number.isInteger(value) || typeof value !== "number")) fail(SignatureErrorCode.MalformedField, `${name} must be an integer`);
	}
	for (const name of [
		"nonce",
		"alg",
		"keyid",
		"tag"
	]) {
		const value = parameters[name];
		if (value !== void 0 && typeof value !== "string") fail(SignatureErrorCode.MalformedField, `${name} must be a string`);
	}
}
function parametersToMap(parameters) {
	const output = /* @__PURE__ */ new Map();
	for (const [name, value] of Object.entries(parameters)) if (value !== void 0) output.set(name, cloneBareItem(value));
	return output;
}
function parametersFromMap(parameters) {
	const output = {};
	for (const [name, value] of parameters) output[name] = validateBareItem(value, `Parameter ${name}`);
	validateKnownParameters(output);
	return Object.freeze(output);
}
function component(name, parameters = {}) {
	const normalizedName = normalizeComponentName(name);
	const copied = copyComponentParameters(parameters);
	validateComponent({
		name: normalizedName,
		parameters: copied
	});
	return Object.freeze({
		name: normalizedName,
		parameters: copied
	});
}
function copyComponentParameters(parameters) {
	const output = {};
	for (const [name, value] of Object.entries(parameters)) {
		validateParameterName(name);
		if (value !== void 0) {
			validateSerializableBareItem(value, `component parameter ${name}`);
			output[name] = cloneBareItem(value);
		}
	}
	return Object.freeze(output);
}
function normalizeComponentName(name) {
	const normalized = name.toLowerCase();
	if (normalized.startsWith("@")) {
		if (normalized === "@query-param") return fail(SignatureErrorCode.UnsupportedFeature, "@query-param is not supported");
		if (!derivedComponents.has(normalized)) return fail(SignatureErrorCode.UnsupportedFeature, `Unknown derived component ${normalized}`);
	} else if (!fieldNamePattern.test(normalized)) return fail(SignatureErrorCode.InvalidComponent, `Invalid field component ${name}`);
	return normalized;
}
function normalizeComponent(input) {
	return typeof input === "string" ? component(input) : component(input.name, input.parameters);
}
function validateComponent(value) {
	const entries = Object.entries(value.parameters);
	for (const [name, parameterValue] of entries) {
		if (unsupportedParameters.has(name)) fail(SignatureErrorCode.UnsupportedFeature, `${name} is not supported`);
		if (name !== "req" && name !== "key") fail(SignatureErrorCode.UnsupportedFeature, `Component parameter ${name} is not supported`);
		if (name === "req" && parameterValue !== true) fail(SignatureErrorCode.InvalidComponent, "req must be true");
		if (name === "key" && typeof parameterValue !== "string") fail(SignatureErrorCode.InvalidComponent, "key must be a string");
	}
	if (value.name.startsWith("@") && value.parameters.key !== void 0) fail(SignatureErrorCode.InvalidComponent, `key is invalid on derived component ${value.name}`);
}
function componentMap(value) {
	const output = /* @__PURE__ */ new Map();
	for (const [name, parameterValue] of Object.entries(value.parameters)) if (parameterValue !== void 0) output.set(name, parameterValue);
	return output;
}
function componentIdentity(input) {
	const value = normalizeComponent(input);
	return (0, structured_headers.serializeItem)(value.name, componentMap(value));
}
function equivalentIdentity(input) {
	const ordered = Object.entries(input.parameters).filter((entry) => entry[1] !== void 0).sort(([left], [right]) => left.localeCompare(right));
	const parameters = /* @__PURE__ */ new Map();
	for (const [name, value] of ordered) if (value !== void 0) parameters.set(name, value);
	return (0, structured_headers.serializeItem)(input.name, parameters);
}
function normalizeComponents(inputs) {
	const output = [];
	const identities = /* @__PURE__ */ new Set();
	for (const input of inputs) {
		const value = normalizeComponent(input);
		const identity = equivalentIdentity(value);
		if (identities.has(identity)) fail(SignatureErrorCode.DuplicateComponent, `Duplicate component ${identity}`);
		identities.add(identity);
		output.push(value);
	}
	return Object.freeze(output);
}
function fieldsFromHeaders(headers) {
	const fields = [];
	headers.forEach((value, name) => fields.push(Object.freeze({
		name,
		value
	})));
	return Object.freeze(fields);
}
function copyFields(fields) {
	return Object.freeze(fields.map(({ name, value }) => {
		if (!fieldNamePattern.test(name)) fail(SignatureErrorCode.MalformedField, `Invalid field name ${name}`);
		const normalized = normalizeFieldValue(value);
		validateAscii(normalized, `Field ${name}`);
		return Object.freeze({
			name: name.toLowerCase(),
			value: normalized
		});
	}));
}
function isNativeRequest(message) {
	return typeof Request !== "undefined" && message instanceof Request;
}
function isNativeResponse(message) {
	return typeof Response !== "undefined" && message instanceof Response;
}
function snapshotRequest(message) {
	if (isNativeRequest(message)) return Object.freeze({
		kind: "request",
		method: message.method,
		targetUri: message.url,
		fields: fieldsFromHeaders(message.headers),
		trailers: Object.freeze([])
	});
	if (!fieldNamePattern.test(message.method)) fail(SignatureErrorCode.InvalidComponent, "Invalid request method");
	validateAscii(message.targetUri, "Target URI");
	if (message.requestTarget !== void 0) validateAscii(message.requestTarget, "Request target");
	return Object.freeze({
		kind: "request",
		method: message.method,
		targetUri: message.targetUri,
		requestTarget: message.requestTarget,
		fields: copyFields(message.fields),
		trailers: copyFields(message.trailers ?? [])
	});
}
function snapshotMessage(message) {
	if (isNativeRequest(message)) return snapshotRequest(message);
	if (isNativeResponse(message)) return Object.freeze({
		kind: "response",
		status: message.status,
		fields: fieldsFromHeaders(message.headers),
		trailers: Object.freeze([])
	});
	if (message.kind === "request") return snapshotRequest(message);
	if (!Number.isInteger(message.status) || message.status < 100 || message.status > 999) fail(SignatureErrorCode.InvalidComponent, "Invalid response status");
	return Object.freeze({
		kind: "response",
		status: message.status,
		fields: copyFields(message.fields),
		trailers: copyFields(message.trailers ?? []),
		request: message.request === void 0 ? void 0 : snapshotRequest(message.request)
	});
}
function normalizeFieldValue(value) {
	return value.replace(/\r\n[\t ]+/g, " ").replace(/^[\t ]+|[\t ]+$/g, "");
}
function validateAscii(value, location) {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code > 126 || code < 32 || code === 127) {
			if (code === 9) continue;
			fail(SignatureErrorCode.MalformedField, `${location} is not ASCII field content`);
		}
	}
}
function extractField(snapshot, name, trailers) {
	const source = trailers ? snapshot.trailers : snapshot.fields;
	const values = [];
	for (const field of source) if (field.name === name) values.push(normalizeFieldValue(field.value));
	if (values.length === 0) return fail(SignatureErrorCode.MissingField, `Missing field ${name}`);
	return values.join(", ");
}
function requestForComponent(snapshot, value) {
	if (value.parameters.req === void 0) return snapshot;
	if (snapshot.kind !== "response" || snapshot.request === void 0) return fail(SignatureErrorCode.InvalidComponent, "req requires a response with a related request");
	return snapshot.request;
}
function requestUrl(snapshot, name) {
	try {
		return new URL(snapshot.targetUri);
	} catch (error) {
		return fail(SignatureErrorCode.InvalidComponent, `${name} requires an absolute target URI`, error);
	}
}
function requestTarget(snapshot, name) {
	const url = requestUrl(snapshot, name);
	if (url.hash !== "") return fail(SignatureErrorCode.InvalidComponent, `${name} target URI cannot contain a fragment`);
	const schemeEnd = snapshot.targetUri.indexOf("://");
	if (schemeEnd === -1) return fail(SignatureErrorCode.InvalidComponent, `${name} requires an HTTP target URI`);
	const pathStart = snapshot.targetUri.indexOf("/", schemeEnd + 3);
	const queryStart = snapshot.targetUri.indexOf("?", schemeEnd + 3);
	const start = pathStart !== -1 && (queryStart === -1 || pathStart < queryStart) ? pathStart : queryStart;
	const pathEnd = queryStart === -1 ? snapshot.targetUri.length : queryStart;
	return Object.freeze({
		url,
		path: start === -1 || start === queryStart ? "/" : snapshot.targetUri.slice(start, pathEnd),
		query: queryStart === -1 ? "?" : snapshot.targetUri.slice(queryStart)
	});
}
function extractDerived(snapshot, name) {
	if (name === "@status") {
		if (snapshot.kind !== "response") return fail(SignatureErrorCode.InvalidComponent, "@status requires a response");
		return snapshot.status.toString();
	}
	if (snapshot.kind !== "request") return fail(SignatureErrorCode.InvalidComponent, `${name} requires a request`);
	if (name === "@method") return snapshot.method;
	const target = requestTarget(snapshot, name);
	switch (name) {
		case "@target-uri": return snapshot.targetUri;
		case "@authority": return target.url.host;
		case "@scheme": return target.url.protocol.slice(0, -1);
		case "@request-target":
			if (snapshot.requestTarget === void 0) return fail(SignatureErrorCode.UnsupportedFeature, "@request-target requires a descriptor requestTarget");
			return snapshot.requestTarget;
		case "@path": return target.path;
		case "@query": return target.query;
		default: return fail(SignatureErrorCode.UnsupportedFeature, `Unknown derived component ${name}`);
	}
}
function extractComponentValue(snapshot, value) {
	const selected = requestForComponent(snapshot, value);
	if (value.name.startsWith("@")) return extractDerived(selected, value.name);
	const fieldValue = extractField(selected, value.name, false);
	const key = value.parameters.key;
	if (key === void 0) return fieldValue;
	if (typeof key !== "string") return fail(SignatureErrorCode.InvalidComponent, "key must be a string");
	const member = parseRfc8941Dictionary(fieldValue, `field ${value.name}`).get(key);
	if (member === void 0) return fail(SignatureErrorCode.MissingField, `Field ${value.name} has no dictionary member ${key}`);
	return (0, structured_headers.isInnerList)(member) ? (0, structured_headers.serializeInnerList)(member) : (0, structured_headers.serializeItem)(member);
}
function componentsToInnerList(components, parameters) {
	return [components.map((value) => [value.name, componentMap(value)]), parametersToMap(parameters)];
}
function buildSignatureBase(snapshot, components, signatureInput) {
	const lines = components.map((value) => `${(0, structured_headers.serializeItem)(value.name, componentMap(value))}: ${extractComponentValue(snapshot, value)}`);
	lines.push(`"@signature-params": ${(0, structured_headers.serializeInnerList)(signatureInput)}`);
	return encoder.encode(lines.join("\n"));
}
function assertAlgorithm(claimed, actual) {
	if (claimed !== void 0 && claimed !== actual) fail(SignatureErrorCode.AlgorithmMismatch, `Claimed algorithm ${String(claimed)} does not match ${actual}`);
}
function createInput(message, label, componentsInput, parametersInput, algorithm) {
	if (!sfKeyPattern.test(label)) fail(SignatureErrorCode.MalformedField, `Invalid signature label ${label}`);
	const snapshot = snapshotMessage(message);
	const components = normalizeComponents(componentsInput);
	const parameters = copyParameters(parametersInput);
	assertAlgorithm(parameters.alg, algorithm);
	const innerList = componentsToInnerList(components, parameters);
	const dictionary = /* @__PURE__ */ new Map([[label, innerList]]);
	return Object.freeze({
		base: buildSignatureBase(snapshot, components, innerList),
		signatureInput: (0, structured_headers.serializeDictionary)(dictionary)
	});
}
function signatureDictionary(label, signature) {
	const item = [Uint8Array.from(signature).buffer, /* @__PURE__ */ new Map()];
	return (0, structured_headers.serializeDictionary)(/* @__PURE__ */ new Map([[label, item]]));
}
async function createSignature(message, options) {
	const label = options.label ?? "sig1";
	const input = createInput(message, label, options.components, options.parameters, options.signer.algorithm);
	const signature = await options.signer.sign(input.base);
	return Object.freeze({
		signature: signatureDictionary(label, signature),
		signatureInput: input.signatureInput
	});
}
function createSignatureSync(message, options) {
	const label = options.label ?? "sig1";
	const input = createInput(message, label, options.components, options.parameters, options.signer.algorithm);
	return Object.freeze({
		signature: signatureDictionary(label, options.signer.sign(input.base)),
		signatureInput: input.signatureInput
	});
}
function topLevelMemberCount(input) {
	let count = input.trim() === "" ? 0 : 1;
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (const character of input) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quoted && character === "\\") {
			escaped = true;
			continue;
		}
		if (character === "\"") quoted = !quoted;
		if (quoted) continue;
		if (character === "(") depth += 1;
		if (character === ")") depth -= 1;
		if (character === "," && depth === 0) count += 1;
	}
	return count;
}
function rawParameterCount(input) {
	let count = 0;
	let quoted = false;
	let escaped = false;
	for (const character of input) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quoted && character === "\\") {
			escaped = true;
			continue;
		}
		if (character === "\"") quoted = !quoted;
		if (!quoted && character === ";") count += 1;
	}
	return count;
}
function parsedParameterCount(dictionary) {
	let count = 0;
	for (const member of dictionary.values()) {
		count += member[1].size;
		if ((0, structured_headers.isInnerList)(member)) for (const item of member[0]) count += item[1].size;
	}
	return count;
}
function assertNoRfc9651Syntax(input, name) {
	let quoted = false;
	let escaped = false;
	for (let index = 0; index < input.length; index += 1) {
		const character = input[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quoted && character === "\\") {
			escaped = true;
			continue;
		}
		if (character === "\"") {
			quoted = !quoted;
			continue;
		}
		if (!quoted && (character === "@" || character === "%" && input[index + 1] === "\"")) fail(SignatureErrorCode.UnsupportedFeature, `${name} uses an RFC 9651-only value`);
	}
}
function parseRfc8941Dictionary(input, name) {
	assertNoRfc9651Syntax(input, name);
	let dictionary;
	try {
		dictionary = (0, structured_headers.parseDictionary)(input);
	} catch (error) {
		return fail(SignatureErrorCode.MalformedField, `Malformed ${name}`, error);
	}
	assertRfc8941Dictionary(dictionary, name);
	return dictionary;
}
function parseStrictDictionary(input, name) {
	const dictionary = parseRfc8941Dictionary(input, name);
	if (topLevelMemberCount(input) !== dictionary.size) return fail(SignatureErrorCode.DuplicateLabel, `${name} has duplicate labels`);
	if (rawParameterCount(input) !== parsedParameterCount(dictionary)) return fail(SignatureErrorCode.MalformedField, `${name} has duplicate parameters`);
	return dictionary;
}
function assertRfc8941Dictionary(dictionary, name) {
	for (const member of dictionary.values()) {
		if ((0, structured_headers.isInnerList)(member)) for (const [value, parameters] of member[0]) {
			validateBareItem(value, name);
			for (const parameter of parameters.values()) validateBareItem(parameter, name);
		}
		else validateBareItem(member[0], name);
		for (const parameter of member[1].values()) validateBareItem(parameter, name);
	}
}
function parseSignatureDictionary(input) {
	const dictionary = parseStrictDictionary(input, "Signature");
	for (const member of dictionary.values()) if ((0, structured_headers.isInnerList)(member) || !(member[0] instanceof ArrayBuffer) || member[1].size !== 0) fail(SignatureErrorCode.MalformedField, "Signature members must be unparameterized byte sequences");
	return dictionary;
}
function parseSignatureInputDictionary(input) {
	const dictionary = parseStrictDictionary(input, "Signature-Input");
	for (const member of dictionary.values()) if (!(0, structured_headers.isInnerList)(member)) fail(SignatureErrorCode.MalformedField, "Signature-Input members must be inner lists");
	return dictionary;
}
function matchingLabels(left, right) {
	if (left.size !== right.size) return false;
	for (const label of left.keys()) if (!right.has(label)) return false;
	return true;
}
function selectedLabel(signatures, inputs, requested) {
	if (!matchingLabels(signatures, inputs)) return fail(SignatureErrorCode.LabelMismatch, "Signature and Signature-Input label sets differ");
	if (requested !== void 0) {
		if (!signatures.has(requested) || !inputs.has(requested)) return fail(SignatureErrorCode.LabelMismatch, `Label ${requested} is not present in both signature fields`);
		return requested;
	}
	if (signatures.size !== 1) return fail(SignatureErrorCode.LabelRequired, "An explicit label is required for multiple or mismatched signatures");
	const iterator = signatures.keys().next();
	if (iterator.done) return fail(SignatureErrorCode.MissingField, "Signature fields are empty");
	return iterator.value;
}
function parsedSignatureInput(member) {
	const components = [];
	for (const [name, parameters] of member[0]) {
		if (typeof name !== "string") return fail(SignatureErrorCode.MalformedField, "Component identifiers must be strings");
		if (name !== name.toLowerCase()) return fail(SignatureErrorCode.MalformedField, `Component identifier ${name} must be lowercase`);
		const values = {};
		for (const [parameterName, value] of parameters) values[parameterName] = validateBareItem(value, `Component parameter ${parameterName}`);
		components.push(component(name, values));
	}
	const normalized = normalizeComponents(components);
	return Object.freeze({
		value: member,
		components: normalized,
		parameters: parametersFromMap(member[1])
	});
}
function signatureBytes(member) {
	if ((0, structured_headers.isInnerList)(member) || !(member[0] instanceof ArrayBuffer)) return fail(SignatureErrorCode.MalformedField, "Invalid Signature member");
	return new Uint8Array(member[0].slice(0));
}
function appendSignature(headers, fields) {
	const newSignatures = parseSignatureDictionary(fields.signature);
	const newInputs = parseSignatureInputDictionary(fields.signatureInput);
	if (newSignatures.size === 0 || newInputs.size === 0) fail(SignatureErrorCode.MalformedField, "New signature fields are empty");
	if (!matchingLabels(newSignatures, newInputs)) fail(SignatureErrorCode.LabelMismatch, "New signature label sets differ");
	const signatureHeader = headers.get("signature");
	const inputHeader = headers.get("signature-input");
	if (signatureHeader === null !== (inputHeader === null)) fail(SignatureErrorCode.LabelMismatch, "Existing signature label sets differ");
	const signatures = signatureHeader === null ? /* @__PURE__ */ new Map() : parseSignatureDictionary(signatureHeader);
	const inputs = inputHeader === null ? /* @__PURE__ */ new Map() : parseSignatureInputDictionary(inputHeader);
	if (!matchingLabels(signatures, inputs)) fail(SignatureErrorCode.LabelMismatch, "Existing signature label sets differ");
	for (const label of newSignatures.keys()) if (signatures.has(label) || inputs.has(label)) fail(SignatureErrorCode.DuplicateLabel, `Duplicate signature label ${label}`);
	for (const [label, value] of newSignatures) signatures.set(label, value);
	for (const [label, value] of newInputs) inputs.set(label, value);
	const output = new Headers(headers);
	output.set("signature", (0, structured_headers.serializeDictionary)(signatures));
	output.set("signature-input", (0, structured_headers.serializeDictionary)(inputs));
	return output;
}
function getRequiredField(snapshot, name) {
	return extractField(snapshot, name, false);
}
function assertPolicyCoverage(components, parameters, policy, now) {
	if (policy.requiredComponents.length !== 0) {
		const present = new Set(components.map(equivalentIdentity));
		for (const required of policy.requiredComponents) {
			const identity = equivalentIdentity(normalizeComponent(required));
			if (!present.has(identity)) fail(SignatureErrorCode.PolicyViolation, `Required component ${identity} is absent`);
		}
	}
	for (const required of policy.requiredParameters) if (parameters[required] === void 0) fail(SignatureErrorCode.PolicyViolation, `Required parameter ${required} is absent`);
	const skew = policy.clockSkew ?? 0;
	if (!Number.isFinite(skew) || skew < 0) fail(SignatureErrorCode.PolicyViolation, "clockSkew must be non-negative");
	const created = parameters.created;
	const expires = parameters.expires;
	if (created !== void 0 && created > now + skew) fail(SignatureErrorCode.PolicyViolation, "Signature was created in the future");
	if (expires !== void 0 && expires < now - skew) fail(SignatureErrorCode.PolicyViolation, "Signature has expired");
	if (policy.maxAge !== void 0) {
		if (!Number.isFinite(policy.maxAge) || policy.maxAge < 0) fail(SignatureErrorCode.PolicyViolation, "maxAge must be non-negative");
		if (created === void 0) fail(SignatureErrorCode.PolicyViolation, "maxAge requires created");
		if (now - created > policy.maxAge + skew) fail(SignatureErrorCode.PolicyViolation, "Signature is too old");
	}
}
async function verifySignature(message, options) {
	const snapshot = snapshotMessage(message);
	const signatureHeader = getRequiredField(snapshot, "signature");
	const inputHeader = getRequiredField(snapshot, "signature-input");
	const signatures = parseSignatureDictionary(signatureHeader);
	const inputs = parseSignatureInputDictionary(inputHeader);
	const label = selectedLabel(signatures, inputs, options.label);
	const inputMember = inputs.get(label);
	const signatureMember = signatures.get(label);
	if (inputMember === void 0 || !(0, structured_headers.isInnerList)(inputMember) || signatureMember === void 0) return fail(SignatureErrorCode.LabelMismatch, `Incomplete signature ${label}`);
	const parsed = parsedSignatureInput(inputMember);
	const signature = signatureBytes(signatureMember);
	const base = buildSignatureBase(snapshot, parsed.components, parsed.value);
	const now = options.policy.now ?? Math.floor(Date.now() / 1e3);
	if (!Number.isFinite(now)) return fail(SignatureErrorCode.PolicyViolation, "now must be finite");
	assertPolicyCoverage(parsed.components, parsed.parameters, options.policy, now);
	const claimedAlgorithm = parsed.parameters.alg;
	if (claimedAlgorithm !== void 0 && !options.policy.algorithms.includes(claimedAlgorithm)) return fail(SignatureErrorCode.PolicyViolation, `Algorithm ${claimedAlgorithm} is not allowed`);
	const untrustedCandidate = Object.freeze({
		label,
		algorithm: claimedAlgorithm,
		components: parsed.components,
		parameters: copyParameters(parsed.parameters),
		signature: signature.slice()
	});
	let verifier;
	try {
		verifier = await options.resolveVerifier(untrustedCandidate, Object.freeze({ now }));
	} catch (error) {
		return fail(SignatureErrorCode.ResolverFailed, "Verifier resolution failed", error);
	}
	if (!options.policy.algorithms.includes(verifier.algorithm)) return fail(SignatureErrorCode.PolicyViolation, `Algorithm ${verifier.algorithm} is not allowed`);
	assertAlgorithm(claimedAlgorithm, verifier.algorithm);
	if (!await verifier.verify(base, signature.slice())) return fail(SignatureErrorCode.VerificationFailed, "Signature verification failed");
	const verified = Object.freeze({
		verifier,
		label,
		algorithm: verifier.algorithm,
		components: parsed.components,
		parameters: parsed.parameters,
		signature: signature.slice()
	});
	if (options.policy.validate !== void 0) {
		if (await options.policy.validate(verified) === false) return fail(SignatureErrorCode.PolicyViolation, "Signature rejected by policy");
	}
	return verified;
}
// src/index.ts
const webcrypto = Object.freeze({
	signer: createWebCryptoSigner,
	verifier: createWebCryptoVerifier
});
exports.SignatureError = SignatureError;
exports.SignatureErrorCode = SignatureErrorCode;
Object.defineProperty(exports, "Token", {
	enumerable: true,
	get: function() {
		return structured_headers.Token;
	}
});
exports.appendSignature = appendSignature;
exports.component = component;
exports.componentIdentity = componentIdentity;
exports.createSignature = createSignature;
exports.createSignatureSync = createSignatureSync;
exports.isSignatureError = isSignatureError;
exports.verifySignature = verifySignature;
exports.webcrypto = webcrypto;
