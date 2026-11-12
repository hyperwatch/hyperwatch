import { RequestDescriptor, RequestDescriptor as RequestDescriptor$1, SignatureComponent, SignatureFields, SignatureFields as SignatureFields$1, Signer, SignerSync, VerifiedSignature, Verifier } from "./http-message-sig.cjs";
import { jwkThumbprint as jwkToKeyID } from "./jsonwebkey-thumbprint.cjs";
type SignatureAgentDiscoveryType = "cimd";
interface SignatureAgentEntry {
  label: string;
  uri: string;
  type?: SignatureAgentDiscoveryType;
}
type SignatureAgentHeader = {
  kind: "current";
  entries: SignatureAgentEntry[];
} | {
  kind: "legacy";
  entries: SignatureAgentEntry[];
};
interface JSONWebKeySet {
  keys: JsonWebKey[];
}
interface WebBotAuthMetadata {
  "expected-user-agent"?: string;
  "rfc9309-product-token"?: string;
  "rfc9309-compliance"?: string[];
  trigger?: "fetcher" | "crawler";
  purpose?: string;
  "targeted-content"?: string;
  "rate-control"?: string;
  "rate-expectation"?: string;
  "known-urls"?: string[];
  ips_uri?: string;
}
interface SignatureAgentCard {
  client_id?: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  jwks_uri?: string;
  jwks?: JSONWebKeySet;
  ips_uri?: string;
  web_bot_auth?: WebBotAuthMetadata;
}
declare function parseSignatureAgentHeader(header: string): SignatureAgentHeader;
declare function parseRegistry(registry: string): URL[];
declare function parseSignatureAgentCard(input: unknown, cardURL?: string): SignatureAgentCard;
declare const HTTP_MESSAGE_SIGNATURE_TAG = "web-bot-auth";
declare const SIGNATURE_AGENT_HEADER = "signature-agent";
declare const HTTP_MESSAGE_SIGNATURES_DIRECTORY = "/.well-known/http-message-signatures-directory";
declare const NONCE_LENGTH_IN_BYTES = 64;
type WebBotAlgorithm = "ed25519" | "rsa-pss-sha512";
interface WebBotSigner extends Signer {
  readonly algorithm: WebBotAlgorithm;
  readonly keyid: string;
}
interface WebBotSignerSync extends SignerSync {
  readonly algorithm: WebBotAlgorithm;
  readonly keyid: string;
}
interface WebBotVerifier extends Verifier {
  readonly algorithm: WebBotAlgorithm;
  readonly keyid: string;
}
interface SignOptions {
  readonly signer: WebBotSigner;
  readonly expires: Date;
  readonly created?: Date;
  readonly nonce?: string;
  readonly label?: string;
  readonly signatureAgentKey?: string;
  readonly target?: "@authority" | "@target-uri";
  readonly additionalComponents?: readonly SignatureComponent[];
}
interface SignSyncOptions extends Omit<SignOptions, "signer"> {
  readonly signer: WebBotSignerSync;
}
interface UntrustedWebBotSignatureCandidate {
  readonly keyid: string;
  readonly algorithm?: WebBotAlgorithm;
  readonly signatureAgent?: SignatureAgentEntry;
}
interface VerifiedWebBotSignature<V extends WebBotVerifier = WebBotVerifier> extends VerifiedSignature<V> {
  readonly keyid: string;
  readonly created: Date;
  readonly expires: Date;
  readonly tag: typeof HTTP_MESSAGE_SIGNATURE_TAG;
  readonly nonce?: string;
  readonly signatureAgent?: SignatureAgentEntry;
}
interface VerifyOptions<V extends WebBotVerifier = WebBotVerifier> {
  readonly resolver: (candidate: UntrustedWebBotSignatureCandidate) => V | Promise<V>;
  readonly algorithms?: readonly WebBotAlgorithm[];
  readonly label?: string;
  readonly maxAge?: number;
  readonly clockSkew?: number;
  readonly now?: Date;
  readonly validate?: (signature: VerifiedWebBotSignature<V>) => boolean | void | Promise<boolean | void>;
}
declare function generateNonce(): string;
declare function validateNonce(nonce: unknown): nonce is string;
declare function sign(request: Request | RequestDescriptor, options: SignOptions): Promise<SignatureFields>;
declare function signSync(request: Request | RequestDescriptor, options: SignSyncOptions): SignatureFields;
declare function verify<V extends WebBotVerifier>(request: Request | RequestDescriptor, options: VerifyOptions<V>): Promise<VerifiedWebBotSignature<V>>;
export { parseSignatureAgentHeader as A, SignatureAgentCard as C, WebBotAuthMetadata as D, SignatureAgentHeader as E, parseRegistry as O, JSONWebKeySet as S, SignatureAgentEntry as T, jwkToKeyID as _, SIGNATURE_AGENT_HEADER as a, validateNonce as b, SignatureFields$1 as c, VerifyOptions as d, WebBotAlgorithm as f, generateNonce as g, WebBotVerifier as h, RequestDescriptor$1 as i, parseSignatureAgentCard as k, UntrustedWebBotSignatureCandidate as l, WebBotSignerSync as m, HTTP_MESSAGE_SIGNATURE_TAG as n, SignOptions as o, WebBotSigner as p, NONCE_LENGTH_IN_BYTES as r, SignSyncOptions as s, HTTP_MESSAGE_SIGNATURES_DIRECTORY as t, VerifiedWebBotSignature as u, sign as v, SignatureAgentDiscoveryType as w, verify as x, signSync as y };