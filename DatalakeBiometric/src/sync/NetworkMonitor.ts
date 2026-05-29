import NetInfo from '@react-native-community/netinfo';
import BackgroundFetch from 'react-native-background-fetch';
import { SyncManager } from './SyncManager';

export function startNetworkMonitor(sync: SyncManager): () => void {
  // 1. Monitor network changes in foreground
  const unsubscribeNetInfo = NetInfo.addEventListener(state => {
    const isOnline = state.isConnected === true && state.isInternetReachable !== false;
    console.log(`Network status changed: connected=${state.isConnected}, reachable=${state.isInternetReachable}`);
    if (isOnline) {
      sync.triggerSync().catch(err => console.error("Sync failed on network transition:", err));
    }
  });

  // 2. Configure Background Fetch for periodic syncing when app is backgrounded
  try {
    BackgroundFetch.configure(
      {
        minimumFetchInterval: 15, // minutes (minimum allowed by OS)
        stopOnTerminate: false,
        enableHeadless: true,
        startOnBoot: true,
        requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
      },
      async (taskId) => {
        console.log(`[BackgroundFetch] Start task: ${taskId}`);
        try {
          await sync.triggerSync();
        } catch (e) {
          console.error("Background sync failed:", e);
        }
        BackgroundFetch.finish(taskId);
      },
      (taskId) => {
        console.warn(`[BackgroundFetch] Task timed out: ${taskId}`);
        BackgroundFetch.finish(taskId);
      }
    );
  } catch (error) {
    console.warn("BackgroundFetch configuration failed (likely unlinked in emulator):", error);
  }

  // Return unified clean-up function
  return () => {
    unsubscribeNetInfo();
  };
}
