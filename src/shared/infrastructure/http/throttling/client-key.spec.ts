import { clientKey } from './client-key';

describe('clientKey', () => {
  it('should count IPv4 clients per address, also when written as IPv4-mapped IPv6', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('should count every address of one IPv6 /64 as the same client', () => {
    const a = clientKey('2001:db8:abcd:12:1111:2222:3333:4444');
    const b = clientKey('2001:0db8:abcd:0012::9');

    expect(a).toBe('2001:db8:abcd:12::/64');
    expect(b).toBe(a);
    expect(clientKey('2001:db8:abcd:13::1')).not.toBe(a);
  });

  it('should expand shorthand and drop zones', () => {
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
    expect(clientKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('should fall back to one bucket when the address is unknown', () => {
    expect(clientKey(undefined)).toBe('unknown');
  });
});
