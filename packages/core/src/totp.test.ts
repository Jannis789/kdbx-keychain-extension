import { describe, expect, it } from 'vitest';
import { base32Decode, buildOtpUri, generateTotp, parseLegacyTotp, parseOtpUri } from './totp';

describe('base32Decode', () => {
  it('dekodiert RFC-4648 ohne Padding', () => {
    expect(Array.from(base32Decode('JBSWY3DPEHPK3PXP'))).toEqual([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef,
    ]);
  });

  it('toleriert Leerzeichen, Kleinbuchstaben und Padding', () => {
    expect(base32Decode('jbsw y3dp ehpk 3pxp==')).toEqual(base32Decode('JBSWY3DPEHPK3PXP'));
  });

  it('wirft bei ungültigen Zeichen', () => {
    expect(() => base32Decode('1')).toThrow();
  });
});

describe('parseOtpUri', () => {
  it('parst Label, Secret und Defaults', () => {
    expect(
      parseOtpUri('otpauth://totp/Demo%20Wiki?secret=JBSWY3DPEHPK3PXP&period=30&digits=6'),
    ).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      digits: 6,
      period: 30,
      algorithm: 'SHA1',
      label: 'Demo Wiki',
    });
  });

  it('nimmt SHA256, Stellen und Periode mit', () => {
    const cfg = parseOtpUri('otpauth://totp/x?secret=ABC&algorithm=SHA256&digits=8&period=60');
    expect(cfg?.algorithm).toBe('SHA256');
    expect(cfg?.digits).toBe(8);
    expect(cfg?.period).toBe(60);
  });

  it('akzeptiert nacktes Base32 im otp-Feld', () => {
    expect(parseOtpUri('JBSWY3DPEHPK3PXP')).toMatchObject({ secret: 'JBSWY3DPEHPK3PXP' });
  });

  it('lehnt Fremdes ab', () => {
    expect(parseOtpUri('https://example.com?secret=ABC')).toBeNull();
    expect(parseOtpUri('otpauth://totp/x')).toBeNull();
  });
});

describe('parseLegacyTotp', () => {
  it('parst "30;6"', () => {
    expect(parseLegacyTotp('JBSWY3DPEHPK3PXP', '30;6')).toMatchObject({
      digits: 6,
      period: 30,
      algorithm: 'SHA1',
    });
  });

  it('parst "60;8;SHA512"', () => {
    expect(parseLegacyTotp('ABC', '60;8;SHA512')).toMatchObject({
      digits: 8,
      period: 60,
      algorithm: 'SHA512',
    });
  });

  it('ohne Seed → null', () => {
    expect(parseLegacyTotp(undefined, '30;6')).toBeNull();
  });
});

describe('buildOtpUri', () => {
  it('lässt Defaults weg', () => {
    expect(
      buildOtpUri({ secret: 'ABC', digits: 6, period: 30, algorithm: 'SHA1' }, 'Demo'),
    ).toBe('otpauth://totp/Demo?secret=ABC');
  });

  it('nimmt Abweichungen mit', () => {
    const uri = buildOtpUri({ secret: 'ABC', digits: 8, period: 60, algorithm: 'SHA256' });
    expect(uri).toContain('digits=8');
    expect(uri).toContain('period=60');
    expect(uri).toContain('algorithm=SHA256');
  });
});

describe('generateTotp (RFC-6238-Testvektoren)', () => {
  // Secret = ASCII "12345678901234567890" (Base32), wie in RFC 6238 Anhang B.
  // Für SHA256/512 wiederholt sich die Ziffernfolge auf 32/64 Byte (RFC 6238).
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const SHA256_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
  const SHA512_SECRET =
    'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';

  it('SHA1, 8 Stellen, T=59 → 94287082', async () => {
    const r = await generateTotp(
      { secret: RFC_SECRET, digits: 8, period: 30, algorithm: 'SHA1' },
      59_000,
    );
    expect(r.code).toBe('94287082');
    expect(r.remainingSeconds).toBe(1);
  });

  it('SHA1, 6 Stellen, T=59 → 287082', async () => {
    const r = await generateTotp(
      { secret: RFC_SECRET, digits: 6, period: 30, algorithm: 'SHA1' },
      59_000,
    );
    expect(r.code).toBe('287082');
  });

  it('SHA256, 8 Stellen, T=1111111109 → 68084774 (pyotp-Referenz)', async () => {
    const r = await generateTotp(
      { secret: SHA256_SECRET, digits: 8, period: 30, algorithm: 'SHA256' },
      111_111_1109_000,
    );
    // Gegen pyotp verifiziert. Die publizierten RFC-6238-Anhang-B-Werte ab
    // T=1111111109 sind als inkonsistent dokumentiert; @59 stimmt mit dem RFC.
    expect(r.code).toBe('68084774');
  });

  it('SHA512, 8 Stellen, T=1111111109 → 25091201 (pyotp-Referenz)', async () => {
    const r = await generateTotp(
      { secret: SHA512_SECRET, digits: 8, period: 30, algorithm: 'SHA512' },
      111_111_1109_000,
    );
    expect(r.code).toBe('25091201');
  });
});
