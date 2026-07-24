const verifiedRequestIps = new WeakMap<Request, string>();

/** Called only by the Bun server adapter using Server.requestIP(). */
export function setVerifiedRequestIp(request: Request, ip: string): void {
  verifiedRequestIps.set(request, ip);
}

export function getVerifiedRequestIp(request: Request): string | undefined {
  return verifiedRequestIps.get(request);
}
