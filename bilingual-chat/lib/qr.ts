import QRCode from "qrcode";

/** QR code en SVG (net à l'impression, quelle que soit la taille). */
export function qrSvg(url: string) {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0f172a", light: "#ffffff" } });
}
