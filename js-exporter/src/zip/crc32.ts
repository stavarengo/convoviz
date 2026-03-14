export const crcTable: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++)
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export const crc32 = (u8: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++)
    c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Update a running CRC-32 with a new chunk. Pass 0xffffffff as the initial value. */
export const crc32Update = (crc: number, u8: Uint8Array): number => {
  let c = crc;
  for (let i = 0; i < u8.length; i++)
    c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return c;
};

/** Finalize a running CRC-32 value. */
export const crc32Final = (crc: number): number => (crc ^ 0xffffffff) >>> 0;
