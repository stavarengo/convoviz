export const enc = (str: string): Uint8Array => new TextEncoder().encode(str);

export const u16 = (n: number): Uint8Array =>
  new Uint8Array([n & 255, (n >>> 8) & 255]);

export const u32 = (n: number): Uint8Array =>
  new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
