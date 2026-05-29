import NetInfo from '@react-native-community/netinfo';
import { fetch as pinnedFetch } from 'react-native-ssl-pinning';
import * as SecureDatabase from '../storage/SecureDatabase';
import { SecureCache } from '../storage/SecureCache';

const API_ENDPOINT = 'https://api.datalake.nhai.gov.in/v1/sync/events';
const BATCH_SIZE = 10;

export class SyncManager {
  private isSyncing = false;
  private mockMode = true; // Enabled by default for hackathon demo to ensure sync works locally
  private mockFailRate = 0.0; // Simulated failure rate

  public setMockMode(enabled: boolean): void {
    this.mockMode = enabled;
    console.log(`SyncManager mock mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  public setMockFailRate(rate: number): void {
    this.mockFailRate = rate;
  }

  public getMockMode(): boolean {
    return this.mockMode;
  }

  public async triggerSync(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    
    try {
      // Check network status
      const net = await NetInfo.fetch();
      const isOnline = net.isConnected === true && net.isInternetReachable !== false;
      
      if (!isOnline && !this.mockMode) {
        console.log("SyncManager: device is offline. Sync skipped.");
        return;
      }
      
      console.log("SyncManager: starting outbox processing...");
      await this.processOutbox();
    } catch (e) {
      console.error("SyncManager error during outbox processing:", e);
    } finally {
      this.isSyncing = false;
    }
  }

  private async fetchWithTimeout(resource: string, options: any): Promise<any> {
    const { timeout = 10000 } = options;
    
    // In production, the NHAI certificate must be bundled in android/app/src/main/assets and iOS bundle
    return pinnedFetch(resource, {
      ...options,
      timeoutInterval: timeout,
      sslPinning: {
        certs: ["nhai_api_cert"] // The bundled certificate name without extension
      }
    });
  }

  private async processOutbox(): Promise<void> {
    // Keep processing in batches of 10 until no more eligible events remain
    while (true) {
      const events = await SecureDatabase.getPendingOutboxEvents(BATCH_SIZE);
      if (events.length === 0) {
        console.log("SyncManager: outbox is empty or all items are backed off.");
        break;
      }
      
      console.log(`SyncManager: processing batch of ${events.length} events...`);
      let batchSuccessCount = 0;
      
      for (const event of events) {
        let attendanceId = '';
        try {
          const payloadObj = JSON.parse(event.payload);
          attendanceId = payloadObj.attendanceId || '';
        } catch (e) {
          console.warn("Failed to parse event payload:", e);
        }
        
        let status = 0;
        
        if (this.mockMode) {
          // Simulate network latency (200ms)
          await new Promise(resolve => setTimeout(resolve, 200));
          
          if (Math.random() < this.mockFailRate) {
            status = 500; // Simulated server failure
            console.log(`SyncManager (Mock): simulated server failure for event ${event.id}`);
          } else {
            status = 200; // Simulated success
            console.log(`SyncManager (Mock): simulated success for event ${event.id}`);
          }
        } else {
          try {
            const token = await SecureCache.getAuthToken();
            const res = await this.fetchWithTimeout(API_ENDPOINT, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Idempotency-Key': event.idempotency_key,
                'Authorization': `Bearer ${token}`
              },
              body: event.payload,
              timeout: 15000 // 15 seconds timeout
            });
            status = res.status;
          } catch (netError: any) {
            console.warn(`SyncManager network error for event ${event.id}:`, netError.message);
            // Treat as network timeout/offline, apply backoff and halt batch
            await SecureDatabase.backoffEvent(event.id, event.attempt_count);
            return; // Exit outbox loop since network is failing
          }
        }
        
        // Handle HTTP response codes
        if (status === 200 || status === 201 || status === 409) {
          // Success or Conflict (duplicate idempotency key is already synced)
          await SecureDatabase.markEventSynced(event.id, attendanceId);
          batchSuccessCount++;
        } else if (status >= 500) {
          // Server error, retry with backoff
          await SecureDatabase.backoffEvent(event.id, event.attempt_count);
        } else {
          // Client error (4xx other than 409), bad format, do not retry
          await SecureDatabase.markEventFailed(event.id);
        }
      }
      
      // If we didn't successfully sync anything in this batch, break to avoid infinite loop
      if (batchSuccessCount === 0) {
        break;
      }
    }
  }
}
