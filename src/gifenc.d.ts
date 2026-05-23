declare module "gifenc" {
  export type GifPaletteColor =
    | [number, number, number]
    | [number, number, number, number];
  export type GifPalette = GifPaletteColor[];
  export type GifPaletteFormat = "rgb565" | "rgb444" | "rgba4444";

  export interface QuantizeOptions {
    format?: GifPaletteFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export interface GifEncoderOptions {
    auto?: boolean;
    initialCapacity?: number;
  }

  export interface GifFrameOptions {
    palette?: GifPalette;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    repeat?: number;
    dispose?: number;
  }

  export interface GifEncoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifFrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(options?: GifEncoderOptions): GifEncoder;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): GifPalette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: GifPaletteFormat,
  ): Uint8Array;
}
