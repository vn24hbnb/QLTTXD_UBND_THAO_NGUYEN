-- Cấu trúc cơ sở dữ liệu Quản lý Trật tự Xây dựng Phường Thảo Nguyên
-- SQLite cho phát triển; PostgreSQL được quản lý bằng supabase/migrations.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'coordinator', 'inspector', 'citizen')),
    totp_secret TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permits (
    id TEXT PRIMARY KEY,
    permit_number TEXT UNIQUE NOT NULL,
    issue_date TEXT NOT NULL,
    issuing_authority TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    owner_address TEXT,
    construction_type TEXT NOT NULL,
    site_address TEXT NOT NULL,
    land_area REAL,
    building_area REAL,
    total_floor_area REAL,
    land_use_ratio REAL,
    floors_text TEXT,
    confirmed_floors INTEGER,
    basement_floors INTEGER DEFAULT 0,
    mezzanine_floors INTEGER DEFAULT 0,
    building_height REAL,
    setback_text TEXT,
    red_line_setback TEXT,
    construction_boundary TEXT,
    ground_elevation TEXT,
    building_density REAL,
    exterior_color TEXT,
    land_lot TEXT,
    design_by TEXT,
    design_doc TEXT,
    land_use_cert TEXT,
    expiration_date TEXT,
    status TEXT NOT NULL CHECK(status IN ('Cần kiểm tra', 'Đang thi công', 'Đã hoàn thành', 'Chờ xác nhận vị trí', 'Tạm dừng')),
    current_stage INTEGER DEFAULT 0 CHECK(current_stage BETWEEN 0 AND 4),
    longitude REAL,
    latitude REAL,
    commune_code TEXT DEFAULT '03982',
    version_id INTEGER DEFAULT 1 CHECK(version_id > 0),
    is_public INTEGER DEFAULT 0 CHECK(is_public IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inspections (
    id TEXT PRIMARY KEY,
    permit_id TEXT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
    stage_index INTEGER NOT NULL CHECK(stage_index BETWEEN 0 AND 3),
    inspector_id TEXT REFERENCES users(id),
    inspect_date TEXT NOT NULL,
    measured_area REAL,
    measured_setback REAL,
    measured_floors INTEGER,
    notes TEXT,
    status TEXT NOT NULL CHECK(status IN ('draft', 'pending_approval', 'approved', 'rejected')),
    approved_by TEXT REFERENCES users(id),
    approved_at TEXT,
    created_at TEXT NOT NULL,
    snapshot_json TEXT,
    measured_setback_rear REAL
);

CREATE TABLE IF NOT EXISTS inspection_photos (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    sha256_hash TEXT NOT NULL,
    caption TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS complaints (
    id TEXT PRIMARY KEY,
    lookup_code TEXT UNIQUE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    location_text TEXT NOT NULL,
    permit_id TEXT REFERENCES permits(id),
    longitude REAL,
    latitude REAL,
    is_anonymous INTEGER DEFAULT 1,
    sender_phone TEXT,
    sender_email TEXT,
    status_step INTEGER DEFAULT 0 CHECK(status_step BETWEEN 0 AND 5),
    assigned_to TEXT REFERENCES users(id),
    investigation_notes TEXT,
    official_reply TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    master_complaint_id TEXT REFERENCES complaints(id),
    merged_at TEXT,
    merged_reason TEXT,
    reply_approved_at TEXT,
    reply_approved_by TEXT REFERENCES users(id),
    version_id INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    user_id TEXT,
    endpoint TEXT NOT NULL,
    response_code INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    request_hash TEXT
);

-- Bổ sung cho Mốc B: Quản lý biên bản vi phạm và nhập hàng loạt
CREATE TABLE IF NOT EXISTS violations (
    id TEXT PRIMARY KEY,
    permit_id TEXT REFERENCES permits(id) ON DELETE CASCADE,
    inspection_id TEXT REFERENCES inspections(id) ON DELETE SET NULL,
    violation_code TEXT UNIQUE NOT NULL,
    version_id INTEGER NOT NULL DEFAULT 1,
    snapshot_json TEXT,
    violation_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('nhẹ', 'trung_bình', 'nghiêm_trọng')),
    status TEXT NOT NULL CHECK(status IN ('lập_biên_bản', 'chờ_khắc_phục', 'đã_khắc_phục', 'chuyển_cưỡng_chế')),
    description TEXT NOT NULL,
    remedy_deadline TEXT,
    fine_amount REAL DEFAULT 0,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    filename TEXT NOT NULL,
    total_rows INTEGER NOT NULL,
    valid_rows INTEGER NOT NULL,
    error_rows INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('preview', 'committed', 'failed')),
    created_at TEXT NOT NULL
);

-- Chỉ mục tối ưu hóa tìm kiếm và địa lý
CREATE INDEX IF NOT EXISTS idx_permits_status ON permits(status);
CREATE INDEX IF NOT EXISTS idx_permits_coords ON permits(longitude, latitude);
CREATE INDEX IF NOT EXISTS idx_complaints_lookup ON complaints(lookup_code);
CREATE INDEX IF NOT EXISTS idx_inspections_permit ON inspections(permit_id, stage_index);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_violations_permit ON violations(permit_id);
CREATE INDEX IF NOT EXISTS idx_violations_status ON violations(status);


CREATE TABLE IF NOT EXISTS files (
    file_name TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL CHECK(file_size > 0),
    sha256 TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS permit_history (
    id TEXT PRIMARY KEY,
    permit_id TEXT NOT NULL REFERENCES permits(id),
    version_id INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    change_reason TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(permit_id, version_id)
);
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL CHECK(count > 0)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
CREATE INDEX IF NOT EXISTS idx_inspection_photos_file ON inspection_photos(file_name);
CREATE INDEX IF NOT EXISTS idx_complaints_assigned ON complaints(assigned_to);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
