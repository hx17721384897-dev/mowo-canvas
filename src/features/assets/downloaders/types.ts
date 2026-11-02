export type DownloadTaskStatus = "queued" | "resolving" | "downloading" | "ready" | "importing" | "completed" | "failed" | "cancelled";

export type DownloadItemSummary = {
  id: string;
  externalId: string;
  name: string;
  mimeType: string;
  size: number;
  animated: boolean;
  position: number;
  previewUrl: string;
};

export type DownloadTaskSummary = {
  id: string;
  projectId: string;
  platform: "line";
  sourceUrl: string;
  sourceKind: "sticker" | "emoji" | null;
  title: string | null;
  status: DownloadTaskStatus;
  progress: number;
  total: number;
  errorCode: string | null;
  errorMessage: string | null;
  items: DownloadItemSummary[];
  createdAt: string;
  updatedAt: string;
};
