import { crc32, inflateSync } from 'node:zlib';

const MAX_BYTES = 45_000;
const MAX_SIDE = 4096;
const MAX_PIXELS = 4_194_304;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const PNG_FORMATS: Record<number, [channels: number, depths: number[]]> = {
  0: [1, [1, 2, 4, 8, 16]],
  2: [3, [8, 16]],
  3: [1, [1, 2, 4, 8]],
  4: [2, [8, 16]],
  6: [4, [8, 16]],
};
const ADAM7 = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
  [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
] as const;

function safeDimensions(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE && width * height <= MAX_PIXELS;
}

export function isManualQrImage(value: string | undefined): boolean {
  if (!value || value.length > 32 + Math.ceil(MAX_BYTES / 3) * 4) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[0] !== value) return false;
  const encoded = match[2]!;
  const image = Buffer.from(encoded, 'base64');
  if (image.length > MAX_BYTES || image.toString('base64') !== encoded) return false;
  if (match[1] === 'png') return validPng(image);
  if (match[1] === 'jpeg') return validJpeg(image);
  return validWebp(image);
}

function validPng(data: Buffer): boolean {
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  let width = 0;
  let height = 0;
  let bits = 0;
  let color = 0;
  let interlace = 0;
  let depth = 0;
  let palette = false;
  let idatEnded = false;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset);
    const end = offset + 8 + length;
    if (end + 4 > data.length || data.readUInt32BE(end) !== crc32(data.subarray(offset + 4, end))) return false;
    const type = data.toString('latin1', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, end);
    if (offset === 8 && type !== 'IHDR') return false;
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) return false;
    if (type !== 'IDAT' && compressed.length) idatEnded = true;
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) return false;
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      depth = chunk[8]!;
      color = chunk[9]!;
      interlace = chunk[12]!;
      const format = PNG_FORMATS[color];
      if (!safeDimensions(width, height) || !format || !format[1].includes(depth) ||
          chunk[10] !== 0 || chunk[11] !== 0 || interlace > 1) return false;
      bits = depth * format[0];
    } else if (type === 'PLTE') {
      if (palette || compressed.length || color === 0 || color === 4 || !length || length % 3 ||
          length > 768 || (color === 3 && length / 3 > 2 ** depth)) return false;
      palette = true;
    } else if (type === 'IDAT') {
      if (idatEnded || (color === 3 && !palette)) return false;
      compressed.push(chunk);
    } else if (type === 'IEND') {
      return length === 0 && end + 4 === data.length && compressed.length > 0 &&
        validPngScanlines(compressed, width, height, bits, interlace);
    } else if (/^[A-Z]/.test(type)) return false;
    offset = end + 4;
  }
  return false;
}

function validPngScanlines(compressed: Buffer[], width: number, height: number, bits: number, interlace: number): boolean {
  const passes = interlace ? ADAM7 : [[0, 0, 1, 1]] as const;
  const rows = passes.map(([x, y, dx, dy]) => {
    const across = Math.ceil((width - x) / dx);
    const down = Math.ceil((height - y) / dy);
    return { stride: across > 0 ? 1 + Math.ceil(across * bits / 8) : 0, count: Math.max(0, down) };
  });
  const expected = rows.reduce((sum, row) => sum + row.stride * row.count, 0);
  try {
    const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
    if (raw.length !== expected) return false;
    let offset = 0;
    for (const { stride, count } of rows) {
      if (stride === 0) continue;
      for (let row = 0; row < count; row++, offset += stride) {
        if (raw[offset]! > 4) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function validJpeg(data: Buffer): boolean {
  if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8) return false;
  let components = 0;
  let scans = 0;
  let quantization = false;
  let entropyTables = false;
  for (let offset = 2; offset < data.length;) {
    if (data[offset++] !== 0xff) return false;
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++]!;
    if (marker === 0xd9) return scans > 0 && offset === data.length;
    if (marker < 0xc0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) ||
        offset + 2 > data.length) return false;
    const length = data.readUInt16BE(offset);
    const end = offset + length;
    if (length < 2 || end > data.length) return false;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (components || length < 11) return false;
      components = data[offset + 7]!;
      if (!components || length !== 8 + 3 * components ||
          !safeDimensions(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3))) return false;
    } else if (marker === 0xdb) {
      if (length < 67) return false;
      quantization = true;
    } else if (marker === 0xc4 || marker === 0xcc) {
      if (length < (marker === 0xc4 ? 20 : 4)) return false;
      entropyTables = true;
    }
    if (marker !== 0xda) {
      offset = end;
      continue;
    }
    if (!components || !quantization || !entropyTables || length < 8) return false;
    const scanComponents = data[offset + 2]!;
    if (!scanComponents || scanComponents > components || length !== 6 + 2 * scanComponents) return false;
    const scanEnd = jpegScanEnd(data, end);
    if (scanEnd === null) return false;
    scans++;
    offset = scanEnd;
  }
  return false;
}

function jpegScanEnd(data: Buffer, start: number): number | null {
  let entropy = false;
  for (let cursor = start; cursor < data.length; cursor++) {
    if (data[cursor] !== 0xff) {
      entropy = true;
      continue;
    }
    let next = cursor + 1;
    while (data[next] === 0xff) next++;
    const marker = data[next];
    if (marker === 0) entropy = true;
    else if (marker === undefined || marker < 0xd0 || marker > 0xd7) return entropy ? cursor : null;
    cursor = next;
  }
  return null;
}

type WebpChunk = { kind: string; data: Buffer };

function webpChunks(data: Buffer): WebpChunk[] | null {
  const chunks: WebpChunk[] = [];
  for (let offset = 0; offset < data.length;) {
    if (offset + 8 > data.length) return null;
    const length = data.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    const padding = length % 2;
    if (end + padding > data.length || (padding && data[end] !== 0)) return null;
    chunks.push({ kind: data.toString('latin1', offset, offset + 4), data: data.subarray(offset + 8, end) });
    offset = end + padding;
  }
  return chunks;
}

function webpDimensions({ kind, data }: WebpChunk): [number, number] | null {
  if (kind === 'VP8 ' && data.length > 10) {
    const tag = data.readUIntLE(0, 3);
    if ((tag & 1) !== 0 || (tag >>> 5) === 0 || (tag >>> 5) > data.length - 10 ||
        data.readUIntBE(3, 3) !== 0x9d012a) return null;
    return [data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff];
  }
  if (kind === 'VP8L' && data.length > 5 && data[0] === 0x2f) {
    const header = data.readUInt32LE(1);
    if (header >>> 29) return null;
    return [(header & 0x3fff) + 1, ((header >>> 14) & 0x3fff) + 1];
  }
  return null;
}

function webpImageMatches(chunks: WebpChunk[], width: number, height: number): boolean {
  const images = chunks.filter(({ kind }) => kind === 'VP8 ' || kind === 'VP8L');
  if (images.length !== 1) return false;
  const size = webpDimensions(images[0]!);
  return size !== null && size[0] === width && size[1] === height;
}

function validWebp(data: Buffer): boolean {
  if (data.length < 20 || data.toString('latin1', 0, 4) !== 'RIFF' ||
      data.toString('latin1', 8, 12) !== 'WEBP' || data.readUInt32LE(4) !== data.length - 8) return false;
  const chunks = webpChunks(data.subarray(12));
  const first = chunks?.[0];
  if (!first || !chunks) return false;
  if (first.kind !== 'VP8X') {
    const size = webpDimensions(first);
    return chunks.length === 1 && !!size && safeDimensions(...size);
  }
  const header = first.data;
  if (header.length !== 10 || (header[0]! & 0xc1) !== 0 || header.readUIntBE(1, 3) !== 0) return false;
  const width = header.readUIntLE(4, 3) + 1;
  const height = header.readUIntLE(7, 3) + 1;
  if (!safeDimensions(width, height) || chunks.slice(1).some(({ kind }) => kind === 'VP8X')) return false;
  const frames = chunks.filter(({ kind }) => kind === 'ANMF');
  const animation = chunks.filter(({ kind }) => kind === 'ANIM');
  if (!(header[0]! & 2)) return frames.length === 0 && animation.length === 0 && webpImageMatches(chunks, width, height);
  if (animation.length !== 1 || animation[0]!.data.length !== 6 || !frames.length ||
      chunks.some(({ kind }) => kind === 'VP8 ' || kind === 'VP8L')) return false;

  let totalFramePixels = 0;
  return frames.every(({ data: frame }) => {
    if (frame.length < 24 || (frame[15]! & 0xfc) !== 0) return false;
    const frameWidth = frame.readUIntLE(6, 3) + 1;
    const frameHeight = frame.readUIntLE(9, 3) + 1;
    totalFramePixels += frameWidth * frameHeight;
    if (totalFramePixels > 4 * MAX_PIXELS || 2 * frame.readUIntLE(0, 3) + frameWidth > width ||
        2 * frame.readUIntLE(3, 3) + frameHeight > height) return false;
    const frameChunks = webpChunks(frame.subarray(16));
    return !!frameChunks && webpImageMatches(frameChunks, frameWidth, frameHeight);
  });
}
