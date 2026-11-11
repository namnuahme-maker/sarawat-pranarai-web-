-- ==========================================================
-- 🛡️ สคริปต์สร้างตารางระบบสแกนใบเช็คชื่อดิจิทัล A4 (v7.0)
-- โครงสร้างตารางสำหรับรับข้อมูล Paper-to-Digital Ingestion
-- ==========================================================

-- 1. ตารางบันทึกเซสชันการสแกนภาพ (Attendance Scan Sessions)
CREATE TABLE IF NOT EXISTS attendance_scan_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_code VARCHAR(10) NOT NULL,            -- 'M', 'T', 'W', 'Ts', 'F', 'S'
    quarter_number INT NOT NULL DEFAULT 1,       -- 1, 2, 3, 4
    duty_date DATE NOT NULL DEFAULT CURRENT_DATE,
    week_column_index INT DEFAULT 1,             -- 1 ถึง 12
    raw_image_url TEXT,                         -- URL รูปถ่ายใบเช็คชื่อ A4
    total_roster INT DEFAULT 0,
    present_count INT DEFAULT 0,
    late_count INT DEFAULT 0,
    leave_count INT DEFAULT 0,
    absent_count INT DEFAULT 0,
    attendance_rate NUMERIC(5,2) DEFAULT 0.00,
    scanned_by VARCHAR(100),                    -- ชื่อหรือ Discord ID ผู้ส่งผล
    verified_by VARCHAR(100),
    is_confirmed BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (shift_code, duty_date)
);

-- Index สำหรับค้นหาประวัติการสแกน
CREATE INDEX IF NOT EXISTS idx_scan_shift_date ON attendance_scan_sessions(shift_code, duty_date);

-- 2. ตารางบันทึกสถานะการปฏิบัติหน้าที่รายบุคคล (Attendance Records)
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES attendance_scan_sessions(id) ON DELETE CASCADE,
    duty_id VARCHAR(15) NOT NULL,               -- เช่น 'M1', 'MS1', 'T2'
    member_name VARCHAR(120),
    shift_code VARCHAR(10) NOT NULL,
    duty_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PRESENT', -- 'PRESENT', 'LATE', 'LEAVE', 'ABSENT'
    confidence NUMERIC(4,3) DEFAULT 0.95,
    was_manually_edited BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (duty_id, duty_date)
);

-- Index สำหรับค้นหาประวัติรายคน
CREATE INDEX IF NOT EXISTS idx_records_duty_date ON attendance_records(duty_id, duty_date);
CREATE INDEX IF NOT EXISTS idx_records_status ON attendance_records(status);
