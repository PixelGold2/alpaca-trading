export type DataStatus = "live" | "delayed" | "stale" | "error" | "demo";

export interface ProviderMeta {
  provider: string;
  timestamp: string; // ISO 8601
  status: DataStatus;
  message?: string;
}

export interface ProviderResult<T> {
  data: T | null;
  meta: ProviderMeta;
}
