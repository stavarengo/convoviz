import { enc, u16, u32 } from "../utils/binary";
import { crc32 } from "./crc32";

interface ZipEntry {
  name: string;
  u8: Uint8Array;
}

export const dosTimeDate = (
  d?: Date,
): { time: number; date: number } => {
  d = d || new Date();
  const time =
    ((d.getHours() & 31) << 11) |
    ((d.getMinutes() & 63) << 5) |
    (Math.floor(d.getSeconds() / 2) & 31);
  const date =
    (((d.getFullYear() - 1980) & 127) << 9) |
    (((d.getMonth() + 1) & 15) << 5) |
    (d.getDate() & 31);
  return {
    time: time & 0xffff,
    date: date & 0xffff,
  };
};

export class ZipLite {
  files: ZipEntry[] = [];

  addBytes(name: string, u8: Uint8Array): void {
    this.files.push({
      name: String(name),
      u8: u8 instanceof Uint8Array ? u8 : new Uint8Array(u8),
    });
  }

  async addBlob(name: string, blob: Blob): Promise<void> {
    const ab = await blob.arrayBuffer();
    this.addBytes(name, new Uint8Array(ab));
  }

  buildBlob(): Blob {
    const td = dosTimeDate(new Date());
    const chunks: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;

    for (const f of this.files) {
      const nameBytes = enc(f.name);
      const data = f.u8;
      const crc = crc32(data);
      const size = data.length >>> 0;
      const flags = 0x0800;

      const localHdr = new Uint8Array(30 + nameBytes.length);
      let p = 0;
      localHdr.set([0x50, 0x4b, 0x03, 0x04], p);
      p += 4;
      localHdr.set(u16(20), p);
      p += 2;
      localHdr.set(u16(flags), p);
      p += 2;
      localHdr.set(u16(0), p);
      p += 2;
      localHdr.set(u16(td.time), p);
      p += 2;
      localHdr.set(u16(td.date), p);
      p += 2;
      localHdr.set(u32(crc), p);
      p += 4;
      localHdr.set(u32(size), p);
      p += 4;
      localHdr.set(u32(size), p);
      p += 4;
      localHdr.set(u16(nameBytes.length), p);
      p += 2;
      localHdr.set(u16(0), p);
      p += 2;
      localHdr.set(nameBytes, p);

      chunks.push(localHdr, data);

      const cHdr = new Uint8Array(46 + nameBytes.length);
      p = 0;
      cHdr.set([0x50, 0x4b, 0x01, 0x02], p);
      p += 4;
      cHdr.set(u16(20), p);
      p += 2;
      cHdr.set(u16(20), p);
      p += 2;
      cHdr.set(u16(flags), p);
      p += 2;
      cHdr.set(u16(0), p);
      p += 2;
      cHdr.set(u16(td.time), p);
      p += 2;
      cHdr.set(u16(td.date), p);
      p += 2;
      cHdr.set(u32(crc), p);
      p += 4;
      cHdr.set(u32(size), p);
      p += 4;
      cHdr.set(u32(size), p);
      p += 4;
      cHdr.set(u16(nameBytes.length), p);
      p += 2;
      cHdr.set(u16(0), p);
      p += 2;
      cHdr.set(u16(0), p);
      p += 2;
      cHdr.set(u16(0), p);
      p += 2;
      cHdr.set(u16(0), p);
      p += 2;
      cHdr.set(u32(0), p);
      p += 4;
      cHdr.set(u32(offset), p);
      p += 4;
      cHdr.set(nameBytes, p);

      central.push(cHdr);
      offset += localHdr.length + data.length;
    }

    const centralStart = offset;
    let centralSize = 0;
    for (const c of central) centralSize += c.length;

    const end = new Uint8Array(22);
    let p = 0;
    end.set([0x50, 0x4b, 0x05, 0x06], p);
    p += 4;
    end.set(u16(0), p);
    p += 2;
    end.set(u16(0), p);
    p += 2;
    end.set(u16(this.files.length), p);
    p += 2;
    end.set(u16(this.files.length), p);
    p += 2;
    end.set(u32(centralSize), p);
    p += 4;
    end.set(u32(centralStart), p);
    p += 4;
    end.set(u16(0), p);

    return new Blob(
      [...chunks, ...central, end] as BlobPart[],
      { type: "application/zip" },
    );
  }
}
