export const CREATE_FACE_TEMPLATES = `
  CREATE TABLE IF NOT EXISTS face_templates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    embedding BLOB NOT NULL,
    enrolled_at INTEGER NOT NULL,
    device_id TEXT NOT NULL
  );
`;

export const CREATE_LOCAL_ATTENDANCE = `
  CREATE TABLE IF NOT EXISTS local_attendance (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    location_lat REAL,
    location_lng REAL,
    verification_score REAL NOT NULL,
    sync_status TEXT DEFAULT 'PENDING' CHECK(sync_status IN ('PENDING','SYNCHRONIZED','FAILED'))
  );
`;

export const CREATE_SYNC_OUTBOX = `
  CREATE TABLE IF NOT EXISTS sync_outbox (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    attempt_count INTEGER DEFAULT 0,
    next_attempt_at INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`;

export const CREATE_SECURITY_LOG = `
  CREATE TABLE IF NOT EXISTS security_log (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    details TEXT
  );
`;

export const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_outbox_retry ON sync_outbox(next_attempt_at) WHERE attempt_count < 5;`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_user ON local_attendance(user_id, timestamp);`
];
