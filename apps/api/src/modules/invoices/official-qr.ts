import QRCode from 'qrcode';
/** Encodes exactly the authoritative response string; never reconstructs invoice semantics. */
export async function officialQrImage(value: string): Promise<string> {
  if (!value.trim()) throw new Error('Official QR missing.');
  return QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 4, width: 400 });
}
