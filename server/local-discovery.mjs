import dgram from 'node:dgram';

const PRIVATE_IP = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
export function createLanDiscovery(port = 8098) {
  const socket = dgram.createSocket('udp4');
  const requests = new Map();
  socket.on('message', (message, remote) => {
    if (!PRIVATE_IP.test(remote.address)) return;
    const match = /^CF_DISCOVER_V1:([a-f0-9]{16})$/.exec(message.toString('ascii'));
    if (!match) return;
    const now = Date.now();
    const entry = requests.get(remote.address);
    if (entry && entry.count >= 30 && entry.until > now) return;
    requests.set(remote.address, entry && entry.until > now
      ? { count: entry.count + 1, until: entry.until }
      : { count: 1, until: now + 60000 });
    if (requests.size > 256) requests.clear();
    socket.send(Buffer.from('CF_HERE_V1:' + match[1]), remote.port, remote.address);
  });
  socket.on('error', error => console.error('[CrimsonFin] LAN discovery:', error.code || error.name));
  socket.bind(port, '0.0.0.0');
  return socket;
}
