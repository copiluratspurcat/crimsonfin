'use strict';
const https = require('node:https');
const dgram = require('node:dgram');
const os = require('node:os');
const { randomBytes } = require('node:crypto');

function normalizeFingerprint(value) {
  return String(value || '').replace(/[^a-f0-9]/gi, '').toUpperCase();
}
function localOrigin(config) {
  const c = config?.local;
  if (!c || typeof c.host !== 'string' || !/^([a-z0-9-]+\.)*local$/i.test(c.host) ||
      !Number.isInteger(c.port) || c.port < 1024 || c.port > 65535 ||
      normalizeFingerprint(c.fingerprint256).length !== 64) return null;
  return `https://${c.host}:${c.port}`;
}
function broadcastAddresses() {
  const values = new Set(['255.255.255.255']);
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const a of interfaces || []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      if (ip.length !== 4 || mask.length !== 4) continue;
      values.add(ip.map((part, i) => ((part & mask[i]) | (~mask[i] & 255))).join('.'));
    }
  }
  return [...values];
}
function privateIpv4(host) {
  return /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
}
function discoverLanHosts(port = 8098, timeoutMs = 900) {
  return new Promise(resolve => {
    const hosts = new Set();
    const nonce = randomBytes(8).toString('hex');
    const socket = dgram.createSocket('udp4');
    let settled = false;
    let timeout;
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { socket.close(); } catch {}
      resolve([...hosts]);
    }
    socket.on('message', (raw, remote) => {
      if (!privateIpv4(remote.address)) return;
      if (raw.toString('ascii') === 'CF_HERE_V1:' + nonce) hosts.add(remote.address);
    });
    socket.on('error', finish);
    timeout = setTimeout(finish, timeoutMs);
    socket.bind(0, '0.0.0.0', () => {
      try { socket.setBroadcast(true); } catch { finish(); return; }
      for (const addr of broadcastAddresses()) {
        socket.send(Buffer.from('CF_DISCOVER_V1:' + nonce), port, addr, () => {});
      }
    });
  });
}
function probeHttps(origin, fingerprint, timeoutMs) {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve(ok); } };
    const req = https.get(origin + '/api/health', {
      rejectUnauthorized: false,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' }
    }, res => {
      const cert = res.socket.getPeerCertificate();
      const pinned = normalizeFingerprint(cert?.fingerprint256) === normalizeFingerprint(fingerprint);
      let body = '';
      res.on('data', chunk => {
        body += chunk.toString();
        if (body.length > 4096) req.destroy();
      });
      res.on('end', () => {
        let valid = false;
        try { valid = JSON.parse(body).service === 'CrimsonFin'; } catch {}
        finish(pinned && res.statusCode === 200 && valid);
      });
    });
    req.on('error', () => finish(false));
    req.on('close', () => finish(false));
  });
}
async function probeLocal(config, timeoutMs = 2800) {
  const fallback = localOrigin(config);
  if (!fallback) return null;
  const addresses = await discoverLanHosts(config?.local?.discoveryPort || 8098, Math.min(1000, timeoutMs / 3));
  const endpoints = [...new Set([
    ...addresses.map(ip => `https://${ip}:${config.local.port}`),
    fallback
  ])];
  // Resolve as soon as any endpoint verifies its pinned certificate. A slow
  // mDNS fallback must not hold up a successful private-LAN connection.
  const winner = await Promise.any(endpoints.map(async origin => {
    const found = await probeHttps(origin, config.local.fingerprint256, Math.max(700, timeoutMs - 1000));
    if (!found) throw new Error('Not reachable');
    return origin;
  })).catch(() => null);
  return winner;
}
module.exports = { normalizeFingerprint, localOrigin, probeLocal, discoverLanHosts, privateIpv4 };
