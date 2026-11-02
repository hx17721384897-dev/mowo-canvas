export type DownloadCandidate = {
  externalId: string;
  name: string;
  mediaUrl: string;
  mimeType?: string;
};

export type DownloadCollection = {
  sourceLabel: string;
  sourceUrl: string;
  items: DownloadCandidate[];
};

export interface ImageDownloadAdapter {
  readonly id: string;
  readonly label: string;
  supports(url: URL): boolean;
  resolve(url: URL, signal?: AbortSignal): Promise<DownloadCollection>;
}

// Platform adapters are intentionally added later. The UI and asset catalog do
// not depend on LINE or any other downloader implementation.
