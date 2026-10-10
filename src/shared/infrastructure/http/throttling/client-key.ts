import { isIPv6 } from 'node:net';

// The key rate limits are counted under. IPv4 clients are counted per address. An IPv6 client
// usually controls a whole /64 (one customer network), so counting per address would hand it
// billions of fresh buckets: it is counted per /64 instead.
export function clientKey(ip: string | undefined): string {
  if (!ip) {
    return 'unknown';
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) {
    return mapped[1];
  }
  if (!isIPv6(ip)) {
    return ip;
  }
  return `${expand(ip).slice(0, 4).join(':')}::/64`;
}

// Eight hextets, without the `::` shorthand and without a zone (`%eth0`).
function expand(ip: string): string[] {
  const [address = ''] = ip.split('%');
  const [head = '', tail] = address.split('::');
  const left = head.length > 0 ? head.split(':') : [];
  const right = tail !== undefined && tail.length > 0 ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  return [...left, ...Array<string>(Math.max(missing, 0)).fill('0'), ...right].map((hextet) =>
    hextet.toLowerCase().replace(/^0+(?=.)/, ''),
  );
}
