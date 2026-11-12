import { Token, Token as Token$1 } from "structured-headers";
export type Rfc8941BareItem = string | number | boolean | Token$1 | ArrayBuffer;
export type SignatureParameters = Readonly<{
  readonly created?: number;
  readonly expires?: number;
  readonly nonce?: string;
  readonly alg?: string;
  readonly keyid?: string;
  readonly tag?: string;
} & {
  readonly [name: string]: Rfc8941BareItem | undefined;
}>;
export type ComponentParameters = Readonly<{
  readonly [name: string]: Rfc8941BareItem | undefined;
}>;
export interface ComponentDescriptor {
  readonly name: string;
  readonly parameters: ComponentParameters;
}
export type SignatureComponent = string | ComponentDescriptor;
export interface FieldOccurrence {
  readonly name: string;
  readonly value: string;
}
export interface RequestDescriptor {
  readonly kind: "request";
  readonly method: string;
  readonly targetUri: string;
  readonly requestTarget?: string;
  readonly fields: readonly FieldOccurrence[];
  readonly trailers?: readonly FieldOccurrence[];
}
export interface ResponseDescriptor {
  readonly kind: "response";
  readonly status: number;
  readonly fields: readonly FieldOccurrence[];
  readonly trailers?: readonly FieldOccurrence[];
  readonly request?: Request | RequestDescriptor;
}
export type MessageDescriptor = RequestDescriptor | ResponseDescriptor;
export type SignatureMessage = Request | Response | MessageDescriptor;
export interface Signer {
  readonly algorithm: string;
  sign(data: Uint8Array): Uint8Array | Promise<Uint8Array>;
}
export interface SignerSync {
  readonly algorithm: string;
  sign(data: Uint8Array): Uint8Array;
}
export interface Verifier {
  readonly algorithm: string;
  verify(data: Uint8Array, signature: Uint8Array): boolean | Promise<boolean>;
}
export interface SignatureFields {
  readonly signature: string;
  readonly signatureInput: string;
}
export interface CreateSignatureOptions {
  readonly label?: string;
  readonly components: readonly SignatureComponent[];
  readonly parameters: SignatureParameters;
  readonly signer: Signer;
}
export interface CreateSignatureSyncOptions {
  readonly label?: string;
  readonly components: readonly SignatureComponent[];
  readonly parameters: SignatureParameters;
  readonly signer: SignerSync;
}
export interface UntrustedSignatureCandidate {
  readonly label: string;
  readonly algorithm?: string;
  readonly components: readonly ComponentDescriptor[];
  readonly parameters: SignatureParameters;
  readonly signature: Uint8Array;
}
export interface VerificationContext {
  readonly now: number;
}
export interface VerifiedSignature<V extends Verifier = Verifier> {
  readonly verifier: V;
  readonly label: string;
  readonly algorithm: string;
  readonly components: readonly ComponentDescriptor[];
  readonly parameters: SignatureParameters;
  readonly signature: Uint8Array;
}
export interface VerificationPolicy<V extends Verifier = Verifier> {
  readonly algorithms: readonly string[];
  readonly requiredComponents: readonly SignatureComponent[];
  readonly requiredParameters: readonly string[];
  readonly maxAge?: number;
  readonly clockSkew?: number;
  readonly now?: number;
  readonly validate?: (signature: VerifiedSignature<V>) => boolean | void | Promise<boolean | void>;
}
export interface VerifySignatureOptions<V extends Verifier = Verifier> {
  readonly label?: string;
  readonly policy: VerificationPolicy<V>;
  readonly resolveVerifier: (untrustedCandidate: UntrustedSignatureCandidate, context: VerificationContext) => V | Promise<V>;
}
declare function createWebCryptoSigner(key: CryptoKey): Signer;
declare function createWebCryptoVerifier(key: CryptoKey): Verifier;
export declare function component(name: string, parameters?: ComponentParameters): ComponentDescriptor;
export declare function componentIdentity(input: SignatureComponent): string;
export declare function createSignature(message: SignatureMessage, options: CreateSignatureOptions): Promise<SignatureFields>;
export declare function createSignatureSync(message: SignatureMessage, options: CreateSignatureSyncOptions): SignatureFields;
export declare function appendSignature(headers: Headers, fields: SignatureFields): Headers;
export declare function verifySignature<V extends Verifier>(message: SignatureMessage, options: VerifySignatureOptions<V>): Promise<VerifiedSignature<V>>;
export declare const SignatureErrorCode: Readonly<{
  MissingField: "MissingField";
  MalformedField: "MalformedField";
  LabelRequired: "LabelRequired";
  LabelMismatch: "LabelMismatch";
  DuplicateLabel: "DuplicateLabel";
  InvalidComponent: "InvalidComponent";
  DuplicateComponent: "DuplicateComponent";
  UnsupportedFeature: "UnsupportedFeature";
  AlgorithmMismatch: "AlgorithmMismatch";
  PolicyViolation: "PolicyViolation";
  VerificationFailed: "VerificationFailed";
  ResolverFailed: "ResolverFailed";
}>;
export type SignatureErrorCode = (typeof SignatureErrorCode)[keyof typeof SignatureErrorCode];
export declare class SignatureError extends Error {
  readonly code: SignatureErrorCode;
  readonly cause?: unknown;
  constructor(code: SignatureErrorCode, message: string, cause?: unknown);
}
export declare function isSignatureError(error: unknown): error is SignatureError;
export declare const webcrypto: Readonly<{
  signer: typeof createWebCryptoSigner;
  verifier: typeof createWebCryptoVerifier;
}>;
export { Token };