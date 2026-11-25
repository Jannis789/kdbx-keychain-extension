/**
 * URL-/Host-Matching fürs Auto-Fill (ADR-006).
 *
 * eTLD+1 über eine kompakte Multi-Part-Suffix-Liste — die vollständige Public
 * Suffix List kommt in Phase 6 als Build-Asset, für den MVP genügt die
 * Abdeckung gängiger Suffixe. Designregel: lieber nichts füllen als das
 * falsche (siehe `sameSite`-Tests, evil-example-Falle).
 */

const MULTIPART_SUFFIXES: ReadonlySet<string> = new Set([
  // UK
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  // Australien/Neuseeland/Asien
  'com.au', 'net.au', 'org.au', 'co.nz', 'net.nz', 'org.nz',
  'co.jp', 'ne.jp', 'or.jp', 'com.cn', 'net.cn', 'org.cn',
  'com.tw', 'com.hk', 'com.sg', 'co.in', 'net.in', 'org.in',
  'co.kr', 'com.my', 'com.ph', 'com.vn',
  // Amerika
  'com.br', 'net.br', 'org.br', 'com.mx', 'com.ar', 'com.co',
  'com.pe', 'com.uy', 'com.ve',
  // Europa/Rest
  'co.za', 'com.tr', 'com.pl', 'com.ua', 'co.il', 'org.il',
]);

/** Extrahiert den Host aus einer URL *oder* aus einem nackten Host-String. */
export function hostFromUrlOrHost(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      return new URL(s).hostname.toLowerCase() || null;
    } catch {
      return null;
    }
  }
  try {
    return new URL(`http://${s}`).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Registrable Domain (eTLD+1-Näherung):
 * `login.demo.example.com` → `example.com`, `shop.example.co.uk` → `example.co.uk`.
 * IPs und Ein-Label-Hosts (localhost) werden exakt zurückgegeben.
 */
export function registrableDomain(input: string): string | null {
  const host = hostFromUrlOrHost(input);
  if (!host) return null;
  const h = host.replace(/\.$/, '');
  if (h.includes(':') || /^[0-9.]+$/.test(h)) return h; // IPv4/IPv6
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  if (MULTIPART_SUFFIXES.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return last2;
}

/** Strenger Site-Vergleich auf registrable-domain-Basis (kein Substring-Matching!). */
export function sameSite(a: string, b: string): boolean {
  const ra = registrableDomain(a);
  const rb = registrableDomain(b);
  return ra !== null && ra === rb;
}
