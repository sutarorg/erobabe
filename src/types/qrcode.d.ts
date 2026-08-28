/**
 * Minimal typings for the `qrcode` package — only the canvas renderer the
 * 2FA enrollment screen uses. Avoids pulling in a full @types dependency.
 */
declare module "qrcode" {
  export interface QRCodeRenderOptions {
    width?: number;
    margin?: number;
    scale?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark?: string; light?: string };
  }
  export function toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: QRCodeRenderOptions
  ): Promise<void>;
  export function toDataURL(text: string, options?: QRCodeRenderOptions): Promise<string>;
  const _default: { toCanvas: typeof toCanvas; toDataURL: typeof toDataURL };
  export default _default;
}
