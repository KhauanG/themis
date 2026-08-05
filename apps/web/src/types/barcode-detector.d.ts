/**
 * Tipos da Barcode Detection API.
 *
 * Não fazem parte do lib.dom do TypeScript porque a API ainda não é padrão em todos os
 * navegadores. Está disponível no Chrome/Android, que é o alvo do Themis — foi o que
 * permitiu remover zxing e html5-qrcode (750 KB) do bundle.
 */

interface DetectedBarcode {
  boundingBox: DOMRectReadOnly;
  cornerPoints: ReadonlyArray<{ x: number; y: number }>;
  format: string;
  rawValue: string;
}

interface BarcodeDetectorOptions {
  formats?: string[];
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  static getSupportedFormats(): Promise<string[]>;
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
}
