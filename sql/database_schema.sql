-- ==========================================================
-- 🛡️ สคริปต์สร้างตารางฐานข้อมูลสำหรับสารวัตรนักเรียนโรงเรียนพระนารายณ์ (v4.0)
-- อัปเดต: รองรับเวรพิเศษ (S) มาทุกวัน และระบบใบตารางเช็คชื่อ 12 สัปดาห์
-- ==========================================================

-- 1. ตารางสมาชิกสารวัตรนักเรียน (Members)
CREATE TABLE IF NOT EXISTS members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    nickname VARCHAR(50) NOT NULL,
    grade_class VARCHAR(20) NOT NULL,
    student_no INT NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    profile_image_url TEXT,                 -- URL รูปถ่ายหน้าตรงสำหรับทำบัตรสารวัตร
    role VARCHAR(30) DEFAULT 'MEMBER',      -- 'PRESIDENT', 'VICE_PRESIDENT', 'MEMBER'
    shift_role VARCHAR(30) DEFAULT 'MEMBER',-- 'SHIFT_HEAD', 'SHIFT_DEPUTY', 'MEMBER'
    duty_day VARCHAR(5),                    -- 'M', 'T', 'W', 'Ts', 'F', 'S' (S = เวรพิเศษทุกวัน)
    duty_id VARCHAR(10) UNIQUE,             -- 'M1', 'M2', 'Ts1', 'S1', 'S5', 'S12' etc.
    discord_id VARCHAR(32) UNIQUE,
    status VARCHAR(30) DEFAULT 'PENDING_APPROVAL', -- 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'INACTIVE'
    approved_by VARCHAR(32),                -- Discord ID ผู้กดอนุมัติ
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index ช่วยให้ค้นหาเร็วขึ้น
CREATE INDEX IF NOT EXISTS idx_members_duty_day ON members(duty_day, status);
CREATE INDEX IF NOT EXISTS idx_members_discord ON members(discord_id);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);

-- 2. ตารางการขอลาเวร (Leave Requests)
CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    duty_day VARCHAR(5) NOT NULL,            -- 'M', 'T', 'W', 'Ts', 'F', 'S'
    leave_date VARCHAR(50) NOT NULL,
    shift_period VARCHAR(30) NOT NULL,
    leave_type VARCHAR(50) NOT NULL,
    reason TEXT NOT NULL,
    substitute_name VARCHAR(100),
    status VARCHAR(20) DEFAULT 'NOTIFIED',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_member ON leave_requests(member_id);
CREATE INDEX IF NOT EXISTS idx_leave_duty ON leave_requests(duty_day);

-- 3. ตารางคดีและความน่าสงสัย (Cases จาก Google Form)
CREATE TABLE IF NOT EXISTS cases (
    case_id VARCHAR(30) PRIMARY KEY,
    reporter_email VARCHAR(120) NOT NULL,
    reporter_name VARCHAR(100),
    incident_date_time TIMESTAMPTZ NOT NULL,
    location VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    evidence_urls TEXT[],
    status VARCHAR(30) DEFAULT 'PENDING',
    assigned_duty_day VARCHAR(5),
    assigned_officer_id UUID REFERENCES members(id),
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ตารางบันทึกการตรวจเวรประจำวัน (Duty Logs)
CREATE TABLE IF NOT EXISTS duty_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    duty_day VARCHAR(5) NOT NULL,
    log_date DATE NOT NULL DEFAULT CURRENT_DATE,
    shift_type VARCHAR(20) NOT NULL,
    attendees_count INT DEFAULT 0,
    attendees_list JSONB,
    notes TEXT,
    reported_by_id UUID REFERENCES members(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
