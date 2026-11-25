import { describe, expect, it } from 'vitest';
import { registrableDomain, sameSite } from './url-matching';

describe('registrableDomain', () => {
  it('URL → registrable Domain', () => {
    expect(registrableDomain('https://login.demo.example.com/x?y=1')).toBe('example.com');
  });

  it('Multi-Part-Suffix (co.uk)', () => {
    expect(registrableDomain('https://shop.example.co.uk')).toBe('example.co.uk');
  });

  it('Ein-Label-Host', () => {
    expect(registrableDomain('http://localhost:3000')).toBe('localhost');
  });

  it('IPv4 exakt (inkl. Port)', () => {
    expect(registrableDomain('http://192.168.1.1:8080')).toBe('192.168.1.1');
  });

  it('Host ohne Scheme', () => {
    expect(registrableDomain('demo.example.com')).toBe('example.com');
  });

  it('Müll → null', () => {
    expect(registrableDomain(' ::: ')).toBeNull();
    expect(registrableDomain('')).toBeNull();
  });
});

describe('sameSite', () => {
  it('Subdomain trifft Basis-Domain', () => {
    expect(sameSite('https://a.demo.example.com', 'https://demo.example.com')).toBe(true);
  });

  it('www ist egal', () => {
    expect(sameSite('https://www.example.com', 'https://example.com')).toBe(true);
  });

  it('fremde Domain wird nie gematcht', () => {
    expect(sameSite('https://evil-example.com', 'https://example.com')).toBe(false);
  });

  it('Substring-Falle: example.com.evil.io ≠ example.com', () => {
    expect(sameSite('https://example.com.evil.io', 'https://example.com')).toBe(false);
  });

  it('Multi-Part-Suffix-Sites matchen sich gegenseitig', () => {
    expect(sameSite('https://a.example.co.uk', 'https://b.example.co.uk')).toBe(true);
  });

  it('IPs nur exakt', () => {
    expect(sameSite('http://192.168.1.1', 'http://192.168.1.1')).toBe(true);
    expect(sameSite('http://192.168.1.1', 'http://192.168.1.2')).toBe(false);
  });
});
