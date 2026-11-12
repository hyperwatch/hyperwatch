import { h as WebBotVerifier, p as WebBotSigner } from "./index-BzZLGjnF.cjs";
export declare function signerFromJWK(jwk: JsonWebKey): Promise<WebBotSigner>;
export declare function verifierFromJWK(jwk: JsonWebKey): Promise<WebBotVerifier>;