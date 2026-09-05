import { parseProfile, profile } from './conference';

export const MAX_TRANSFER_LENGTH = 900;
const PREFIX = '#draftbox=';
export function encodeTransfer(ids: string[]): string {
  const valid = parseProfile(profile(ids));
  if (!valid.length)
    throw Error('Save some papers before sending them to your phone.');
  return (
    PREFIX + '1.' + valid.map((id) => id.slice('eccv-2026-'.length)).join('.')
  );
}
export function decodeTransfer(hash: string): string[] | null {
  if (!hash.startsWith(PREFIX)) return null;
  if (hash.length > 60000)
    throw Error('This transfer link is too large. Use JSON import instead.');
  const [version, ...numbers] = hash.slice(PREFIX.length).split('.');
  if (
    version !== '1' ||
    !numbers.length ||
    numbers.some((n) => !/^\d+$/.test(n))
  )
    throw Error(
      'This bookmark link is invalid or uses an unsupported version. Your saved papers have not changed.',
    );
  return parseProfile(profile(numbers.map((n) => 'eccv-2026-' + n)));
}
export function isLoopback(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    hostname.startsWith('127.')
  );
}
export function transferUrl(address: string, ids: string[]) {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw Error('Enter the full site address, including http:// or https://.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error(
      'Use an http:// or https:// site address without login details.',
    );
  if (isLoopback(url.hostname) || ['0.0.0.0', '[::]'].includes(url.hostname))
    throw Error(
      'Your phone cannot open localhost. Use the laptop’s Wi-Fi address or a published site address.',
    );
  url.pathname = '/saved';
  url.search = '';
  url.hash = encodeTransfer(ids);
  if (url.href.length > MAX_TRANSFER_LENGTH)
    throw Error(
      'This list is too large for an easy-to-scan QR code. Use Export to transfer the JSON file instead.',
    );
  return url.href;
}
export function transferSummary(
  ids: string[],
  saved: string[],
  known: Set<string>,
) {
  const existing = new Set(saved);
  return {
    added: ids.filter((id) => !existing.has(id)).length,
    existing: ids.filter((id) => existing.has(id)).length,
    unavailable: ids.filter((id) => !known.has(id)).length,
  };
}
