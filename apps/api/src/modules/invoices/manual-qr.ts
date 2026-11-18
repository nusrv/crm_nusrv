/** Restrict uploaded manual QR images to known raster formats; never active SVG/HTML. */
export function isManualQrImage(value: string | undefined): boolean {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value ?? '');
  if (!match) return false;
  const data = Buffer.from(match[2]!, 'base64');
  if (data.length > 45000) return false;
  if (match[1] === 'png')
    return (
      data.length >= 24 &&
      data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' &&
      data.readUInt32BE(16) > 0 &&
      data.readUInt32BE(20) > 0
    );
  if (match[1] === 'jpeg')
    return (
      data.length > 4 &&
      data.subarray(0, 3).toString('hex') === 'ffd8ff' &&
      data.subarray(-2).toString('hex') === 'ffd9'
    );
  return (
    data.length >= 16 &&
    data.subarray(0, 4).toString() === 'RIFF' &&
    data.subarray(8, 12).toString() === 'WEBP'
  );
}
