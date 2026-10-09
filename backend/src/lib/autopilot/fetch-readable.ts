/**
 * Open a link a freelancer gave us and read what is really there.
 *
 * The links are chosen by strangers, and this runs on our server, so it
 * refuses anything that resolves to a private or loopback address — otherwise
 * a "portfolio" pointing at an internal service would have us read it for
 * them. Redirects are followed by hand so every hop gets the same check.
 */
import dns from "node:dns/promises";
import net from "node:net";

export type Readable =
  | { ok: true; contentType: string; text: string }
  | { ok: false; reason: string };

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/i;

export function firstUrl(s: string): string | null {
  const m = URL_RE.exec(s);
  return m ? m[0].replace(/[.,;:!?]+$/, "") : null;
}

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === "::1" ||
    v6 === "::" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80") ||
    (v6.startsWith("::ffff:") && isPrivate(v6.slice(7)))
  );
}

async function safeHost(url: URL): Promise<boolean> {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }
  if (net.isIP(host)) return !isPrivate(host);
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivate(a.address));
  } catch {
    return false;
  }
}

/** Raw GitHub pages are mostly chrome; the README says what a repo is. */
function rewrite(url: URL): URL {
  const gh = /^\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
  if (url.hostname === "github.com" && gh) {
    return new URL(
      `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/HEAD/README.md`,
    );
  }
  return url;
}

/** Servers label plain text and Markdown as text/html; only real markup is stripped. */
function looksLikeHtml(body: string): boolean {
  return /<(html|head|body|div|p|span|h[1-6]|article|section|main|br)[\s>/]/i.test(
    body,
  );
}

/** Keeps line structure: a heading and the paragraph under it must stay apart. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(
      /<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article)[^>]*>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}

export async function fetchReadable(
  raw: string,
  maxChars: number,
): Promise<Readable> {
  let url: URL;
  try {
    url = rewrite(new URL(raw));
  } catch {
    return { ok: false, reason: "not a valid link" };
  }

  for (let hop = 0; hop < 4; hop++) {
    if (!(await safeHost(url)))
      return { ok: false, reason: "address not allowed" };
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": "SecureFlow-Autopilot/1.0", Accept: "*/*" },
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      return { ok: false, reason: "link did not respond" };
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) return { ok: false, reason: `link returned ${res.status}` };

    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    const size = Number(res.headers.get("content-length") ?? 0);
    const textual =
      type.startsWith("text/") ||
      /json|xml|javascript|markdown|svg/.test(type) ||
      type === "";

    if (!textual) {
      // An image, PDF or archive: we cannot read it, but that it exists, what
      // kind of file it is and how big it is are facts, not claims.
      await res.body?.cancel().catch(() => {});
      return {
        ok: true,
        contentType: type,
        text: `A ${type} file${size ? ` of ${(size / 1024).toFixed(0)} KB` : ""} is present at this link; its contents could not be read as text.`,
      };
    }

    const body = (await res.text()).slice(0, 400_000);
    const plain =
      /html/.test(type) && looksLikeHtml(body) ? htmlToText(body) : body;
    return {
      ok: true,
      contentType: type || "text",
      text:
        plain.length > maxChars
          ? `${plain.slice(0, maxChars)} …[truncated]`
          : plain,
    };
  }
  return { ok: false, reason: "too many redirects" };
}
