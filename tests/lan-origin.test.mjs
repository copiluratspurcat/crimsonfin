import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedLocalHttpsOrigin } from '../server/index.mjs';

test('LAN login accepts only HTTPS matching the verified private host and port', () => {
  const socket = { encrypted: true, remoteAddress: '192.168.1.40' };
  const make = host => ({ socket, headers: { host } });
  assert.equal(allowedLocalHttpsOrigin(make('192.168.1.105:9443'), 'https://192.168.1.105:9443'), true);
  assert.equal(allowedLocalHttpsOrigin(make('hoesmad.local:9443'), 'https://hoesmad.local:9443'), true);
  assert.equal(allowedLocalHttpsOrigin(make('192.168.1.105:9443'), 'https://attacker.example:9443'), false);
  assert.equal(allowedLocalHttpsOrigin(make('192.168.1.105:9443'), 'http://192.168.1.105:9443'), false);
  assert.equal(allowedLocalHttpsOrigin(make('192.168.1.105:9443'), 'https://192.168.1.105:9444'), false);
  assert.equal(allowedLocalHttpsOrigin({ socket: { encrypted: false, remoteAddress: '192.168.1.40' },
    headers: { host: '192.168.1.105:9443' } }, 'https://192.168.1.105:9443'), false);
  assert.equal(allowedLocalHttpsOrigin({ socket: { encrypted: true, remoteAddress: '203.0.113.40' },
    headers: { host: '192.168.1.105:9443' } }, 'https://192.168.1.105:9443'), false);
});
