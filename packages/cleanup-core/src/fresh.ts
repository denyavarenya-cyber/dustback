import type { CleanupConfig } from './config';
import { CleanupError } from './errors';
import type { ScanResult } from './scan';

/** A plan may only come from a recent scan of the configured cluster. */
export function assertFresh(scan: ScanResult, config: CleanupConfig, now: Date): void {
  if (scan.cluster !== config.cluster) {
    throw new CleanupError('CLUSTER_MISMATCH', 'the scan was made on another cluster');
  }
  const age = (now.getTime() - Date.parse(scan.scannedAt)) / 1000;
  if (!Number.isFinite(age) || age < 0 || age > config.maxScanAgeSeconds) {
    throw new CleanupError('STALE_SCAN', 'the scan is too old; scan again');
  }
}
