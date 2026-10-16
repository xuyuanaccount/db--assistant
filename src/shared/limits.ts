export const LIMITS = {
  connectionTimeoutMs: 10_000, queryTimeoutMs: 60_000,
  sqlBytes: 256 * 1024, defaultResultRows: 100, resultRows: 1000, resultBytes: 10 * 1024 * 1024,
  uploadBytes: 100 * 1024 * 1024, previewRows: 20, batchRows: 500,
  xlsxRows: 1_000_000, retentionMs: 24 * 60 * 60 * 1000,
} as const;
