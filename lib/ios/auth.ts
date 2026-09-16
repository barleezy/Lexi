import { LEXI_USER_COOKIE, LEXI_USER_COOKIE_MAX_AGE } from "../memory/user";
import {
  IOS_AUTH_PATH,
  IOS_CALLBACK_SCHEMES,
  callbackURLWithToken,
  iosSigningSecret,
  parseCallbackURI,
  signIosToken,
  verifyIosToken,
} from "./config";

export {
  IOS_AUTH_PATH,
  IOS_CALLBACK_SCHEMES,
  callbackURLWithToken,
  iosSigningSecret,
  parseCallbackURI,
  signIosToken,
  verifyIosToken,
};

export { LEXI_USER_COOKIE, LEXI_USER_COOKIE_MAX_AGE };

export function readBearerToken(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  return request.headers.get("x-lexi-ios-session")?.trim() ?? "";
}

export function readIosSession(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const token = readBearerToken(request);
  if (!token) return null;
  return verifyIosToken(token, Date.now(), env);
}

export function defaultIosUserId() {
  return "";
}
