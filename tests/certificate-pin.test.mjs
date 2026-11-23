import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { X509Certificate } = require('node:crypto');
const { matchesPinnedCertificate, normalizeFingerprint } = require('../desktop/local-route.cjs');

test('Electron LAN certificate is validated using SHA-256 of the PEM certificate', () => {
  const pem = tls.rootCertificates[0];
  assert.ok(pem);
  const sha = new X509Certificate(pem).fingerprint256;
  const cert = { data: pem, fingerprint: 'different-or-short-format' };
  assert.equal(normalizeFingerprint(sha).length, 64);
  assert.equal(matchesPinnedCertificate('https://host.local:9443', 'https://host.local:9443', cert, sha), true);
  assert.equal(matchesPinnedCertificate('https://host.local:9443', 'https://host.local:9443', cert, '0'.repeat(64)), false);
  assert.equal(matchesPinnedCertificate('https://attacker.local:9443', 'https://host.local:9443', cert, sha), false);
  assert.equal(matchesPinnedCertificate('https://host.local:9443', 'https://host.local:9443', { fingerprint: sha }, sha), false);
  assert.equal(matchesPinnedCertificate('https://host.local:9443', 'https://host.local:9443', { data: 'not a cert' }, sha), false);
});
