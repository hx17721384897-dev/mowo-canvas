import "server-only";

export type DownloadedFile = {
  externalId: string;
  name: string;
  absolutePath: string;
  mimeType: "image/png";
  size: number;
  animated: boolean;
  position: number;
};

export type DownloadResult = {
  title: string;
  sourceKind: "sticker" | "emoji";
  files: DownloadedFile[];
};

export type DownloadContext = {
  directory: string;
  signal: AbortSignal;
  onResolved(total: number, title: string, sourceKind: "sticker" | "emoji"): void;
  onProgress(completed: number, total: number): void;
};

export interface ImageDownloadAdapter {
  readonly id: "line";
  supports(url: URL): boolean;
  download(sourceUrl: string, context: DownloadContext): Promise<DownloadResult>;
}
