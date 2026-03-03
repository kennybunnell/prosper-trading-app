import type { CookieOptions, Request, Response } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // const hostname = req.hostname;
  // const shouldSetDomain =
  //   hostname &&
  //   !LOCAL_HOSTS.has(hostname) &&
  //   !isIpAddress(hostname) &&
  //   hostname !== "127.0.0.1" &&
  //   hostname !== "::1";

  // const domain =
  //   shouldSetDomain && !hostname.startsWith(".")
  //     ? `.${hostname}`
  //     : shouldSetDomain
  //       ? hostname
  //       : undefined;

  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req),
  };
}

/**
 * Append the `Partitioned` attribute to all Set-Cookie headers already queued
 * on the response. This enables CHIPS (Cookies Having Independent Partitioned
 * State), which Chrome requires for cookies set in a third-party iframe context
 * (e.g. the Manus preview panel embeds the app inside manus.im).
 *
 * Express 4 does not support the Partitioned attribute natively, so we patch
 * the raw header after res.cookie() has serialised it.
 */
export function addPartitionedAttribute(res: Response): void {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) return;

  const patch = (header: string) =>
    header.includes("Partitioned") ? header : header + "; Partitioned";

  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", existing.map(patch));
  } else if (typeof existing === "string") {
    res.setHeader("Set-Cookie", patch(existing));
  }
}
