export type PdfTextItem = { str?: string; transform?: readonly number[]; width?: number; height?: number };
export function pageText(items: readonly PdfTextItem[], pageWidth: number, viewportTransform?: readonly number[]): string;
