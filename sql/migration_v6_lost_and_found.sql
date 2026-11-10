-- ==============================================================
-- 📦 SARAWAT PRANARAI - LOST & FOUND SYSTEM (v6.0 PRODUCTION)
-- สคริปต์สร้างตารางฐานข้อมูลระบบของหายและคำร้องจาก Google Form
-- โรงเรียนพระนารายณ์ สำหรับ Supabase SQL Editor
-- ==============================================================

-- 1. ตารางคลังสิ่งของที่พบเจอ (Found Items Repository)
CREATE TABLE IF NOT EXISTS public.lost_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code VARCHAR(50) UNIQUE NOT NULL,             -- รหัสยุทธวิธี เช่น LF-2026-001
    title VARCHAR(200) NOT NULL,                       -- ชื่อสิ่งของ เช่น กระเป๋าสตางค์หนังสีน้ำตาล Tough
    category VARCHAR(100) NOT NULL,                    -- หมวดหมู่: กระเป๋า, อุปกรณ์ไอที, กุญแจ, เครื่องแต่งกาย, ฯลฯ
    characteristics TEXT DEFAULT '',                   -- ลักษณะเด่นภายนอก สี ตำหนิ ยี่ห้อ
    secret_traits TEXT DEFAULT '',                     -- จุดสังเกตลับเฉพาะสารวัตร
    image_url TEXT,                                    -- รูปภาพสิ่งของ (Discord CDN URL หรือ Cloud)
    location_found VARCHAR(200) DEFAULT '-',           -- สถานที่เก็บได้
    found_date DATE NOT NULL DEFAULT CURRENT_DATE,     -- วันที่พบ
    found_time VARCHAR(50),                            -- เวลาที่พบ เช่น 12:15 น.
    status VARCHAR(50) DEFAULT 'WAITING_OWNER',        -- 'WAITING_OWNER' (รอเจ้าของติดต่อ), 'DELIVERED' (ส่งมอบสำเร็จ)
    storage_location VARCHAR(200) DEFAULT 'ห้องสารวัตรนักเรียน', -- จุดจัดเก็บ
    finder_name VARCHAR(150),                          -- ชื่อสารวัตรผู้บันทึก
    finder_duty_id VARCHAR(50),                        -- รหัสเวรสารวัตร เช่น MS1, TS4
    finder_avatar_url TEXT,                            -- รูปโปรไฟล์สารวัตรผู้บันทึก
    finder_contact VARCHAR(100),                       -- เบอร์ติดต่อ
    claimant_name VARCHAR(150),                        -- ชื่อ-นามสกุล ผู้มารับคืน
    claimant_contact VARCHAR(100),                     -- เบอร์ติดต่อผู้รับคืน
    delivered_by VARCHAR(150),                         -- สารวัตรนักเรียนผู้ส่งมอบ
    delivered_by_duty_id VARCHAR(50),                  -- รหัสเวรสารวัตรผู้ส่งมอบ เช่น MS1
    delivered_by_photo_url TEXT,                       -- รูปหน้าตรงสารวัตรผู้ส่งมอบ
    handover_photo_url TEXT,                           -- รูปถ่ายหลักฐานตอนส่งมอบคืนเจ้าของ (Discord CDN URL)
    delivered_at TIMESTAMPTZ,                          -- วันเวลาที่ส่งมอบคืนสำเร็จ
    handover_notes TEXT,                               -- บันทึกเพิ่มเติมตอนส่งมอบ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- สร้าง Indexes สำหรับ lost_items
CREATE INDEX IF NOT EXISTS idx_lost_items_status ON public.lost_items(status);
CREATE INDEX IF NOT EXISTS idx_lost_items_category ON public.lost_items(category);
CREATE INDEX IF NOT EXISTS idx_lost_items_found_date ON public.lost_items(found_date DESC);
CREATE INDEX IF NOT EXISTS idx_lost_items_code ON public.lost_items(item_code);

-- เปิด Row Level Security (RLS)
ALTER TABLE public.lost_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read lost_items" ON public.lost_items FOR SELECT USING (true);
CREATE POLICY "Allow write lost_items" ON public.lost_items FOR ALL USING (true);


-- 2. ตารางคำร้องแจ้งของหายจาก Google Form / Web (Lost Claims Feed)
CREATE TABLE IF NOT EXISTS public.lost_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_code VARCHAR(50) UNIQUE NOT NULL,            -- รหัสคำร้อง เช่น CLM-2026-001
    category VARCHAR(100) NOT NULL,                    -- ชนิดสิ่งของที่แจ้งหาย
    item_type VARCHAR(200) NOT NULL,                   -- แบบไหน / ยี่ห้อ / รุ่น
    characteristics TEXT NOT NULL,                     -- ลักษณะเฉพาะตัวที่จำได้
    lost_location VARCHAR(200),                        -- สถานที่โดยประมาณที่ทำหาย
    lost_date DATE DEFAULT CURRENT_DATE,               -- วันที่ทำหาย
    claimant_name VARCHAR(150) NOT NULL,               -- ชื่อ-นามสกุล ผู้แจ้ง
    claimant_class VARCHAR(50),                        -- ชั้น/ห้อง (เช่น ม.5/7)
    claimant_contact VARCHAR(100) NOT NULL,            -- เบอร์โทรศัพท์ติดต่อกลับ
    status VARCHAR(50) DEFAULT 'PENDING',              -- 'PENDING' (รอตรวจสอบ), 'MATCHED' (พบของใกล้เคียง), 'RESOLVED' (รับคืนแล้ว)
    matched_item_id UUID REFERENCES public.lost_items(id) ON DELETE SET NULL, -- FK ชี้ไปที่ของในคลัง
    resolved_at TIMESTAMPTZ,                           -- วันที่ปิดคำร้อง
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- สร้าง Indexes สำหรับ lost_claims
CREATE INDEX IF NOT EXISTS idx_lost_claims_status ON public.lost_claims(status);
CREATE INDEX IF NOT EXISTS idx_lost_claims_category ON public.lost_claims(category);
CREATE INDEX IF NOT EXISTS idx_lost_claims_code ON public.lost_claims(claim_code);

-- เปิด Row Level Security (RLS)
ALTER TABLE public.lost_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read lost_claims" ON public.lost_claims FOR SELECT USING (true);
CREATE POLICY "Allow write lost_claims" ON public.lost_claims FOR ALL USING (true);


-- 3. ตารางหมวดหมู่สิ่งของ (Lost & Found Categories) กำหนดโดยสารวัตร
CREATE TABLE IF NOT EXISTS public.lost_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,                  -- รหัสหมวดหมู่ เช่น CAT-BAG, CAT-TECH
    name VARCHAR(100) UNIQUE NOT NULL,                 -- ชื่อหมวดหมู่ เช่น กระเป๋า / กระเป๋าสตางค์
    icon VARCHAR(20) DEFAULT '📦',                      -- ไอคอนอีโมจิประจำหมวด
    description TEXT,                                  -- คำอธิบายสิ่งของในหมวด
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- สร้าง Indexes สำหรับ lost_categories
CREATE INDEX IF NOT EXISTS idx_lost_categories_name ON public.lost_categories(name);

-- เปิด Row Level Security (RLS)
ALTER TABLE public.lost_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read lost_categories" ON public.lost_categories FOR SELECT USING (true);
CREATE POLICY "Allow write lost_categories" ON public.lost_categories FOR ALL USING (true);


-- 4. ข้อมูลตัวอย่างเริ่มต้น (Seed Initial Tactical Data)
INSERT INTO public.lost_categories (code, name, icon, description) VALUES
('CAT-BAG', 'กระเป๋า / กระเป๋าสตางค์', '👛', 'กระเป๋าสะพาย กระเป๋าตังค์ เป้ กระเป๋าเคียง'),
('CAT-TECH', 'อุปกรณ์ไอที / มือถือ', '📱', 'สมาร์ตโฟน แท็บเล็ต หูฟัง สายชาร์จ พาวเวอร์แบงก์'),
('CAT-KEY', 'กุญแจ / ยานพาหนะ', '🔑', 'กุญแจรถ กุญแจบ้าน คีย์การ์ด หมวกกันน็อก'),
('CAT-CLOTH', 'เครื่องแต่งกาย / หมวก', '👕', 'เสื้อกันหนาว หมวก เนกไท เข็มขัด รองเท้า'),
('CAT-STUDY', 'อุปกรณ์การเรียน / หนังสือ', '📚', 'กล่องดินสอ สมุด หนังสือ เครื่องคิดเลข ไม้บรรทัด'),
('CAT-VALUABLE', 'ของมีค่า / เครื่องประดับ', '💎', 'เงินสด นาฬิกา แหวน สร้อย แว่นตา'),
('CAT-CONFISCATED', 'ของกลาง', '⚖️', 'ของที่ไม่มารับเกิน 30 วัน หรือสิ่งของตรวจยึด'),
('CAT-OTHER', 'อื่นๆ', '📦', 'สิ่งของเบ็ดเตล็ด กระติกน้ำ ร่ม ฯลฯ')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.lost_items (
    item_code, title, category, characteristics, image_url, location_found, found_date, found_time, status, storage_location, finder_name, finder_contact
) VALUES
(
    'LF-2026-001',
    'กระเป๋าสตางค์หนังสีน้ำตาลเข้ม Tough',
    'กระเป๋า / กระเป๋าสตางค์',
    'กระเป๋าหนังแท้พับสองตอนสีน้ำตาลเข้ม ยี่ห้อ Tough มีรอยขีดข่วนเล็กน้อยที่มุมขวาล่าง ภายในมีบัตรประชาชนและรูปถ่าย',
    'https://images.unsplash.com/photo-1627123424574-724758594e93?w=600&auto=format&fit=crop&q=80',
    'โต๊ะม้าหินอ่อนหน้าอาคาร 3 (ใกล้ตู้กดน้ำ)',
    CURRENT_DATE,
    '12:15 น.',
    'WAITING_OWNER',
    'ห้องสารวัตรนักเรียน อาคาร 1 (ชั้น 1)',
    'นายกิตติศักดิ์ (นักเรียน ม.4/2)',
    '081-234-5678'
),
(
    'LF-2026-002',
    'หูฟังบลูทูธ AirPods Pro 2 พร้อมเคสแคร์แบร์',
    'อุปกรณ์ไอที / มือถือ',
    'ตัวเคสหูฟังสีขาว สวมเคสซิลิโคนสีเขียวขี้ม้า มีพวงกุญแจตุ๊กตา Care Bear สีชมพูห้อยอยู่ ฝาปิดด้านบนมีสติกเกอร์รูปหัวใจ',
    'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=600&auto=format&fit=crop&q=80',
    'อัฒจันทร์โดมกิจกรรม หน้าเวทีกลาง',
    CURRENT_DATE,
    '08:30 น.',
    'WAITING_OWNER',
    'ห้องสารวัตรนักเรียน อาคาร 1 (ตู้เซฟ A-01)',
    'สารวัตรเวรวันศุกร์ (ผลัด F)',
    'โต๊ะเวรประจำวัน'
),
(
    'LF-2026-003',
    'กุญแจรถจักรยานยนต์ Honda Wave 110i',
    'กุญแจ / ยานพาหนะ',
    'ลูกกุญแจแท้ฮอนด้า พร้อมสายคล้องคอสีแดงสกรีนอักษร HONDA RACING มีพวงลูกกุญแจบ้านอีก 2 ดอก',
    'https://images.unsplash.com/photo-1582139329536-e7284fece509?w=600&auto=format&fit=crop&q=80',
    'โรงจอดรถจักรยานยนต์นักเรียน โซน C แถวที่ 4',
    CURRENT_DATE - INTERVAL '1 day',
    '16:45 น.',
    'DELIVERED',
    'ห้องสารวัตรนักเรียน อาคาร 1',
    'รปภ. ประตูหน้าโรงเรียน',
    'ป้อมยามหน้าประตู 1'
)
ON CONFLICT (item_code) DO NOTHING;

-- Seed ข้อมูลคำร้องเริ่มต้น
INSERT INTO public.lost_claims (
    claim_code, category, item_type, characteristics, lost_location, lost_date, claimant_name, claimant_class, claimant_contact, status
) VALUES
(
    'CLM-2026-001',
    'กระเป๋า / กระเป๋าสตางค์',
    'กระเป๋าตังค์หนังพับ',
    'สีน้ำตาล ยี่ห้อ Tough ลืมไว้ตอนกินข้าวเที่ยงแถวอาคาร 3 ในกระเป๋ามีบัตรประชาชนชื่อ วรพจน์',
    'หน้าอาคาร 3 หรือ โรงอาหาร',
    CURRENT_DATE,
    'นายวรพจน์ บุญมี',
    'ม.4/2',
    '089-765-4321',
    'MATCHED'
),
(
    'CLM-2026-002',
    'อุปกรณ์ไอที / มือถือ',
    'AirPods Pro 2',
    'เคสซิลิโคนสีเขียว มีพวงกุญแจตุ๊กตาสีชมพูห้อย ลืมไว้ตอนเข้าแถวที่โดม',
    'โดมกิจกรรม หน้าเวที',
    CURRENT_DATE,
    'น.ส.กมลวรรณ รัตนะ',
    'ม.5/8',
    '092-345-6789',
    'PENDING'
)
ON CONFLICT (claim_code) DO NOTHING;
