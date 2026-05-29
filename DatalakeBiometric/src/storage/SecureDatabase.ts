import { open } from '@op-engineering/op-sqlite';
import uuid from 'react-native-uuid';
// @ts-ignore
import crypto from 'react-native-quick-crypto';
import { KeyManager } from './KeyManager';
import * as Schema from './DatabaseSchema';

let db: any = null;
let deviceIdCached: string | null = null;

function getDeviceId(): string {
  if (deviceIdCached) return deviceIdCached;
  // Fallback: simple device ID generation
  deviceIdCached = 'device-' + uuid.v4().toString().substring(0, 8);
  return deviceIdCached;
}

export function setDeviceId(id: string) {
  deviceIdCached = id;
}

export async function initDatabase(): Promise<void> {
  if (db) return;
  
  const dbKey = await KeyManager.getDatabaseKey();
  
  try {
    db = open({
      name: 'datalake_biometric.db',
      encryptionKey: dbKey,
    });
    
    // Execute table creations
    await db.executeAsync(Schema.CREATE_FACE_TEMPLATES);
    await db.executeAsync(Schema.CREATE_LOCAL_ATTENDANCE);
    await db.executeAsync(Schema.CREATE_SYNC_OUTBOX);
    await db.executeAsync(Schema.CREATE_SECURITY_LOG);
    
    // Execute indexes
    for (const idx of Schema.CREATE_INDEXES) {
      await db.executeAsync(idx);
    }
    
    console.log("Database initialized and encrypted successfully with SQLCipher!");
  } catch (error) {
    console.error("Database initialization failed:", error);
    throw error;
  }
}

function getRows(result: any): any[] {
  if (!result) return [];
  if (result.rows && typeof result.rows.raw === 'function') {
    return result.rows.raw();
  }
  if (result.rows && result.rows._array) {
    return result.rows._array;
  }
  const arr = [];
  if (result.rows && result.rows.length) {
    for (let i = 0; i < result.rows.length; i++) {
      arr.push(result.rows.item(i));
    }
  }
  return arr;
}

export async function enrollFace(userId: string, embedding: Float32Array): Promise<void> {
  const blob = new Uint8Array(embedding.buffer);
  const id = uuid.v4().toString();
  
  await db.executeAsync(
    `INSERT OR REPLACE INTO face_templates (id, user_id, embedding, enrolled_at, device_id)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, blob, Date.now(), getDeviceId()]
  );
}

export async function getAllTemplates(): Promise<Array<{ userId: string; embedding: Float32Array }>> {
  const result = await db.executeAsync(`SELECT user_id, embedding FROM face_templates`);
  const rows = getRows(result);
  
  return rows.map((row: any) => {
    let rawBlob = row.embedding;
    // Handle different binary output formats from sqlite binding
    let buffer: ArrayBuffer;
    if (rawBlob instanceof Uint8Array) {
      buffer = rawBlob.buffer.slice(rawBlob.byteOffset, rawBlob.byteOffset + rawBlob.byteLength);
    } else if (rawBlob instanceof ArrayBuffer) {
      buffer = rawBlob;
    } else {
      // In case it's returned as base64 string or other format
      const binaryString = atob(rawBlob.toString());
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      buffer = bytes.buffer;
    }
    
    return {
      userId: row.user_id,
      embedding: new Float32Array(buffer)
    };
  });
}

export async function recordAttendance(params: {
  userId: string;
  score: number;
  lat?: number;
  lng?: number;
}): Promise<void> {
  const attendanceId = uuid.v4().toString();
  const idempotencyKey = uuid.v4().toString();
  const timestamp = Date.now();
  
  const payload = JSON.stringify({
    attendanceId,
    userId: params.userId,
    timestamp,
    location: {
      latitude: params.lat ?? null,
      longitude: params.lng ?? null
    },
    verificationScore: params.score
  });
  
  await db.transaction(async (tx: any) => {
    // 1. Write to local attendance
    await tx.executeAsync(
      `INSERT INTO local_attendance (id, user_id, timestamp, location_lat, location_lng, verification_score, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
      [attendanceId, params.userId, timestamp, params.lat ?? null, params.lng ?? null, params.score]
    );
    
    // 2. Queue event in sync outbox
    await tx.executeAsync(
      `INSERT INTO sync_outbox (id, idempotency_key, event_type, payload, created_at)
       VALUES (?, ?, 'CHECK_IN', ?, ?)`,
      [uuid.v4().toString(), idempotencyKey, payload, timestamp]
    );
  });
}

export async function logSecurityEvent(type: string, details: string): Promise<void> {
  const id = uuid.v4().toString();
  await db.executeAsync(
    `INSERT INTO security_log (id, event_type, timestamp, details) VALUES (?, ?, ?, ?)`,
    [id, type, Date.now(), details]
  );
}

export async function getPendingOutboxEvents(limit: number): Promise<any[]> {
  const result = await db.executeAsync(
    `SELECT id, idempotency_key, event_type, payload, attempt_count, next_attempt_at 
     FROM sync_outbox 
     WHERE next_attempt_at <= ? AND attempt_count < 5
     ORDER BY created_at ASC 
     LIMIT ?`,
    [Date.now(), limit]
  );
  return getRows(result);
}

export async function markEventSynced(eventId: string, attendanceId: string): Promise<void> {
  await db.transaction(async (tx: any) => {
    // 1. Delete from sync outbox
    await tx.executeAsync(`DELETE FROM sync_outbox WHERE id = ?`, [eventId]);
    
    // 2. Purge (delete) local attendance record to comply with zero-trace security specs
    await tx.executeAsync(`DELETE FROM local_attendance WHERE id = ?`, [attendanceId]);
    
    // 3. Log purge event in security log (audit trail)
    await tx.executeAsync(
      `INSERT INTO security_log (id, event_type, timestamp, details) VALUES (?, ?, ?, ?)`,
      [uuid.v4().toString(), 'LOCAL_DATA_PURGE', Date.now(), `Attendance record ${attendanceId} successfully synced and purged from device.`]
    );
  });
}

export async function backoffEvent(eventId: string, currentAttempts: number): Promise<void> {
  const nextAttempt = currentAttempts + 1;
  // Exponential backoff: 2^attempt minutes, capped at 32 mins
  const backoffMs = Math.min(Math.pow(2, nextAttempt), 32) * 60_000;
  const nextAttemptAt = Date.now() + backoffMs;
  
  await db.executeAsync(
    `UPDATE sync_outbox 
     SET attempt_count = ?, next_attempt_at = ? 
     WHERE id = ?`,
    [nextAttempt, nextAttemptAt, eventId]
  );
}

export async function markEventFailed(eventId: string): Promise<void> {
  // Permanently failed (e.g. 4xx error indicating bad payload)
  await db.transaction(async (tx: any) => {
    // 1. Read payload BEFORE deleting the outbox row
    const result = await tx.executeAsync(`SELECT payload FROM sync_outbox WHERE id = ?`, [eventId]);
    const rows = getRows(result);
    if (rows.length > 0) {
      try {
        const payloadData = JSON.parse(rows[0].payload);
        if (payloadData.attendanceId) {
          await tx.executeAsync(
            `UPDATE local_attendance SET sync_status = 'FAILED' WHERE id = ?`,
            [payloadData.attendanceId]
          );
        }
      } catch (e) {
        console.error("Failed to parse failed event payload:", e);
      }
    }

    // 2. Delete from sync outbox AFTER reading payload
    await tx.executeAsync(`DELETE FROM sync_outbox WHERE id = ?`, [eventId]);

    // 3. Log failure event
    await tx.executeAsync(
      `INSERT INTO security_log (id, event_type, timestamp, details) VALUES (?, ?, ?, ?)`,
      [uuid.v4().toString(), 'SYNC_FAILED', Date.now(), `Outbox event ${eventId} permanently failed after max retries.`]
    );
  });
}

export async function getStats(): Promise<{
  templatesCount: number;
  attendanceCount: number;
  pendingSyncCount: number;
  securityLogsCount: number;
}> {
  const templatesResult = await db.executeAsync(`SELECT COUNT(*) as count FROM face_templates`);
  const attendanceResult = await db.executeAsync(`SELECT COUNT(*) as count FROM local_attendance`);
  const pendingResult = await db.executeAsync(`SELECT COUNT(*) as count FROM sync_outbox`);
  const logsResult = await db.executeAsync(`SELECT COUNT(*) as count FROM security_log`);
  
  return {
    templatesCount: getRows(templatesResult)[0]?.count ?? 0,
    attendanceCount: getRows(attendanceResult)[0]?.count ?? 0,
    pendingSyncCount: getRows(pendingResult)[0]?.count ?? 0,
    securityLogsCount: getRows(logsResult)[0]?.count ?? 0,
  };
}

export async function getSecurityLogs(): Promise<any[]> {
  const result = await db.executeAsync(`SELECT * FROM security_log ORDER BY timestamp DESC LIMIT 20`);
  return getRows(result);
}

/**
 * Bonus Enhancement: Audit Trail Export
 * Exports the full security_log table as a tamper-evident JSON string.
 * In a real-world scenario, this could be signed with a private key.
 */
export async function exportAuditTrail(): Promise<string> {
  const result = await db.executeAsync(`SELECT * FROM security_log ORDER BY timestamp ASC`);
  const logs = getRows(result);
  
  const payload = {
    exportTimestamp: Date.now(),
    deviceId: getDeviceId(),
    totalLogs: logs.length,
    logs: logs
  };
  
  const payloadStr = JSON.stringify(payload);
  
  // Use a secure key (in production, this would be retrieved from KeyManager)
  const hmacKey = "simulated_audit_hmac_secret_key_123456";
  const hmac = crypto.createHmac('sha256', hmacKey);
  hmac.update(payloadStr);
  const checksumHex = hmac.digest('hex');
  
  const finalExport = {
    ...payload,
    signature: `HMAC-SHA256:${checksumHex}`
  };
  
  return JSON.stringify(finalExport, null, 2);
}
