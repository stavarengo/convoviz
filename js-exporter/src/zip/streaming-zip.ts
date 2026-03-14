import { enc, u16, u32 } from "../utils/binary";
import { crc32, crc32Update, crc32Final } from "./crc32";
import { dosTimeDate } from "./zip-lite";

interface CentralEntry {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  localHeaderOffset: number;
}

export class StreamingZip {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private entries: CentralEntry[] = [];
  private offset = 0;
  private td = dosTimeDate(new Date());

  constructor(writable: WritableStream<Uint8Array>) {
    this.writer = writable.getWriter();
  }

  async addEntry(path: string, data: Uint8Array | Blob): Promise<void> {
    const nameBytes = enc(path);
    const localHeaderOffset = this.offset;

    let crc: number;
    let size: number;

    if (data instanceof Blob) {
      // Write local header with bit 3 set (data descriptor follows).
      // CRC and sizes in the local header are zero; the real values go
      // into a data descriptor written after the file data.
      await this.writeLocalHeader(nameBytes, 0, 0, true);

      // Stream blob chunks, computing CRC incrementally
      const reader = data.stream().getReader();
      let runningCrc = 0xffffffff;
      let totalSize = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        runningCrc = crc32Update(runningCrc, chunk);
        totalSize += chunk.length;
        await this.writer.write(chunk);
        this.offset += chunk.length;
      }

      crc = crc32Final(runningCrc);
      size = totalSize;

      // Write data descriptor (signature + crc32 + compressed size + uncompressed size)
      const desc = new Uint8Array(16);
      desc.set([0x50, 0x4b, 0x07, 0x08], 0); // data descriptor signature
      desc.set(u32(crc), 4);
      desc.set(u32(size), 8);   // compressed size (STORE = uncompressed)
      desc.set(u32(size), 12);  // uncompressed size
      await this.writer.write(desc);
      this.offset += 16;
    } else {
      // Uint8Array: compute CRC directly, write header + data in one go
      crc = crc32(data);
      size = data.length;

      await this.writeLocalHeader(nameBytes, crc, size, false);

      if (size > 0) {
        await this.writer.write(data);
        this.offset += size;
      }
    }

    this.entries.push({ nameBytes, crc, size, localHeaderOffset });
  }

  async finalize(): Promise<void> {
    const centralStart = this.offset;

    for (const entry of this.entries) {
      const cHdr = this.buildCentralHeader(entry);
      await this.writer.write(cHdr);
      this.offset += cHdr.length;
    }

    const centralSize = this.offset - centralStart;

    const eocd = new Uint8Array(22);
    let p = 0;
    eocd.set([0x50, 0x4b, 0x05, 0x06], p); p += 4;
    eocd.set(u16(0), p); p += 2;
    eocd.set(u16(0), p); p += 2;
    eocd.set(u16(this.entries.length), p); p += 2;
    eocd.set(u16(this.entries.length), p); p += 2;
    eocd.set(u32(centralSize), p); p += 4;
    eocd.set(u32(centralStart), p); p += 4;
    eocd.set(u16(0), p);

    await this.writer.write(eocd);
    await this.writer.close();
  }

  private async writeLocalHeader(
    nameBytes: Uint8Array,
    crc: number,
    size: number,
    useDataDescriptor: boolean,
  ): Promise<void> {
    const flags = 0x0800 | (useDataDescriptor ? 0x0008 : 0);
    const hdr = new Uint8Array(30 + nameBytes.length);
    let p = 0;
    hdr.set([0x50, 0x4b, 0x03, 0x04], p); p += 4;
    hdr.set(u16(20), p); p += 2;
    hdr.set(u16(flags), p); p += 2;
    hdr.set(u16(0), p); p += 2;    // compression: STORE
    hdr.set(u16(this.td.time), p); p += 2;
    hdr.set(u16(this.td.date), p); p += 2;
    hdr.set(u32(crc), p); p += 4;
    hdr.set(u32(size), p); p += 4;
    hdr.set(u32(size), p); p += 4;
    hdr.set(u16(nameBytes.length), p); p += 2;
    hdr.set(u16(0), p); p += 2;
    hdr.set(nameBytes, p);

    await this.writer.write(hdr);
    this.offset += hdr.length;
  }

  private buildCentralHeader(entry: CentralEntry): Uint8Array {
    const { nameBytes, crc, size, localHeaderOffset } = entry;
    const flags = 0x0800; // Central directory never needs bit 3
    const hdr = new Uint8Array(46 + nameBytes.length);
    let p = 0;
    hdr.set([0x50, 0x4b, 0x01, 0x02], p); p += 4;
    hdr.set(u16(20), p); p += 2;
    hdr.set(u16(20), p); p += 2;
    hdr.set(u16(flags), p); p += 2;
    hdr.set(u16(0), p); p += 2;
    hdr.set(u16(this.td.time), p); p += 2;
    hdr.set(u16(this.td.date), p); p += 2;
    hdr.set(u32(crc), p); p += 4;
    hdr.set(u32(size), p); p += 4;
    hdr.set(u32(size), p); p += 4;
    hdr.set(u16(nameBytes.length), p); p += 2;
    hdr.set(u16(0), p); p += 2;
    hdr.set(u16(0), p); p += 2;
    hdr.set(u16(0), p); p += 2;
    hdr.set(u16(0), p); p += 2;
    hdr.set(u32(0), p); p += 4;
    hdr.set(u32(localHeaderOffset), p); p += 4;
    hdr.set(nameBytes, p);
    return hdr;
  }
}
