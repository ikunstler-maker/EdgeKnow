import "server-only";

// A plain ZIP archive written as a stream (files stored as they are, without
// compression), so a large set of files never has to fit in memory at once.

// One CRC-32 for both archive writers (this one for the server, `zip.ts` for the browser).
export { crc32 } from "./zip";
import { crc32 } from "./zip";

function dosTime(date: Date) {
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    day: ((Math.max(1980, date.getUTCFullYear()) - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export type ZipEntry = { name: string; date?: Date; read: () => Promise<Uint8Array> };

// Files that can't be read are left out; `onSkip` hears about them.
export function zipStream(entries: ZipEntry[], onSkip?: (name: string) => void): ReadableStream<Uint8Array> {
  const used = new Set<string>();
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (index < entries.length) {
        const entry = entries[index++];
        let bytes: Uint8Array;
        try {
          bytes = await entry.read();
        } catch {
          onSkip?.(entry.name);
          continue;
        }
        // Same names get a number: "brief (2).pdf"; folders with "/" stay folders.
        const clean = entry.name.replace(/[\\:*?"<>|]/g, "_").replace(/^\/+/, "") || "file";
        let name = clean;
        for (let n = 2; used.has(name.toLowerCase()); n++) name = clean.replace(/(\.[^./]*)?$/, (ext) => ` (${n})${ext}`);
        used.add(name.toLowerCase());
        const nameBytes = new TextEncoder().encode(name);
        const crc = crc32(bytes);
        const { time, day } = dosTime(entry.date ?? new Date());
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true); // names in UTF-8
        local.setUint16(10, time, true);
        local.setUint16(12, day, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, bytes.length, true);
        local.setUint32(22, bytes.length, true);
        local.setUint16(26, nameBytes.length, true);
        const record = new DataView(new ArrayBuffer(46));
        record.setUint32(0, 0x02014b50, true);
        record.setUint16(4, 20, true);
        record.setUint16(6, 20, true);
        record.setUint16(8, 0x0800, true);
        record.setUint16(12, time, true);
        record.setUint16(14, day, true);
        record.setUint32(16, crc, true);
        record.setUint32(20, bytes.length, true);
        record.setUint32(24, bytes.length, true);
        record.setUint16(28, nameBytes.length, true);
        record.setUint32(42, offset, true);
        central.push(new Uint8Array(record.buffer), nameBytes);
        offset += 30 + nameBytes.length + bytes.length;
        count += 1;
        controller.enqueue(new Uint8Array(local.buffer));
        controller.enqueue(nameBytes);
        controller.enqueue(bytes);
        return;
      }
      const size = central.reduce((sum, part) => sum + part.length, 0);
      for (const part of central) controller.enqueue(part);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, count, true);
      end.setUint16(10, count, true);
      end.setUint32(12, size, true);
      end.setUint32(16, offset, true);
      controller.enqueue(new Uint8Array(end.buffer));
      controller.close();
    },
  });
}
