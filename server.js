/**
 * 🌐 SARAWAT PRANARAI - CENTRAL COMMAND WEB SERVER
 * เว็บแดชบอร์ดศูนย์บัญชาการสารวัตรนักเรียน โรงเรียนพระนารายณ์
 * โฮสต์แยกอิสระบน Render.com Web Service
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 10001; // ค่าเริ่มต้นพอร์ตเว็บ 10001 (เพื่อไม่ชนกับบอทพอร์ต 10000 เมื่อรันในเครื่องเดียวกัน)

// เชื่อมต่อ Supabase Database
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[WEB] ⚠️ ขาดค่า SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ใน .env');
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// 1. Health Check
// -------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'sarawat-pranarai-web',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// -------------------------------------------------------------
// 2. API: สรุปสถิติภาพรวม (KPI Metrics)
// -------------------------------------------------------------
app.get('/api/stats', async (req, res) => {
  try {
    const { count: totalMembers } = await supabase.from('members').select('*', { count: 'exact', head: true });
    const { count: activeMembers } = await supabase.from('members').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE');
    const { count: pendingMembers } = await supabase.from('members').select('*', { count: 'exact', head: true }).eq('status', 'PENDING_APPROVAL');

    const { count: totalCases } = await supabase.from('cases').select('*', { count: 'exact', head: true });
    const { count: pendingCases } = await supabase.from('cases').select('*', { count: 'exact', head: true }).eq('status', 'PENDING');
    const { count: resolvedCases } = await supabase.from('cases').select('*', { count: 'exact', head: true }).eq('status', 'RESOLVED');

    // สถิติกำลังพลแยกตามผลัดเวร
    const { data: shiftData } = await supabase.from('members').select('duty_day').eq('status', 'ACTIVE');
    const shiftCounts = {
      M: 0, MS: 0,
      T: 0, TS: 0,
      W: 0, WS: 0,
      Ts: 0, TSS: 0,
      F: 0, FS: 0,
      S: 0
    };

    (shiftData || []).forEach(row => {
      const code = row.duty_day;
      if (shiftCounts[code] !== undefined) {
        shiftCounts[code]++;
      } else {
        shiftCounts[code] = (shiftCounts[code] || 0) + 1;
      }
    });

    // สถิติการขอลาเวร (Leave Requests) จากฐานข้อมูล Supabase
    let totalLeaves = 0;
    let pendingLeaves = 0;
    let todayLeavesCount = 0;
    try {
      const { count: cLeaves } = await supabase.from('leave_requests').select('*', { count: 'exact', head: true });
      totalLeaves = cLeaves || 0;

      const { count: pLeaves } = await supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'PENDING');
      pendingLeaves = pLeaves || 0;

      const { data: recentLeaves } = await supabase.from('leave_requests')
        .select('leave_date, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      const today = new Date();
      const todayISO = today.toISOString().slice(0, 10);
      const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      const todayThaiPattern = `${today.getDate()} ${thaiMonths[today.getMonth()]}`;

      (recentLeaves || []).forEach(l => {
        if ((l.leave_date && l.leave_date.includes(todayThaiPattern)) ||
            (l.created_at && l.created_at.startsWith(todayISO))) {
          todayLeavesCount++;
        }
      });
    } catch (e) {
      console.warn('[WEB] Cannot query leave_requests:', e.message);
    }

    // สถิติทรัพย์สินสูญหายและของหาย (Lost & Found)
    let totalLost = 0;
    let waitingLost = 0;
    let claimedLost = 0;
    try {
      const { count: cTotal } = await supabase.from('lost_items').select('*', { count: 'exact', head: true });
      totalLost = cTotal || 0;
      const { count: cWait } = await supabase.from('lost_items').select('*', { count: 'exact', head: true }).eq('status', 'WAITING_OWNER');
      waitingLost = cWait || 0;
      const { count: cClaim } = await supabase.from('lost_items').select('*', { count: 'exact', head: true }).eq('status', 'CLAIMED');
      claimedLost = cClaim || 0;
    } catch (e) {
      const cached = getLocalLostItems();
      totalLost = cached.length;
      waitingLost = cached.filter(i => i.status === 'WAITING_OWNER').length;
      claimedLost = cached.filter(i => i.status === 'CLAIMED').length;
    }

    res.json({
      success: true,
      members: {
        total: totalMembers || 0,
        active: activeMembers || 0,
        pending: pendingMembers || 0
      },
      cases: {
        total: totalCases || 0,
        pending: pendingCases || 0,
        investigating: (totalCases || 0) - (pendingCases || 0) - (resolvedCases || 0),
        resolved: resolvedCases || 0
      },
      leaves: {
        total: totalLeaves,
        today: todayLeavesCount,
        pending: pendingLeaves
      },
      lost_items: {
        total: totalLost,
        waiting: waitingLost,
        claimed: claimedLost
      },
      shifts: shiftCounts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 2.1 API: ข้อมูลการขอลาเวร (Leave Requests)
// -------------------------------------------------------------
app.get('/api/leaves', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('*, members(first_name, last_name, nickname, duty_id, profile_image_url)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 3. API: รายชื่อสารวัตรทั้งหมด (Members Roster)
// -------------------------------------------------------------
app.get('/api/members', async (req, res) => {
  try {
    const { duty_day, search } = req.query;
    let query = supabase
      .from('members')
      .select('id, first_name, last_name, nickname, grade_class, student_no, phone_number, profile_image_url, role, shift_role, duty_day, duty_id, status')
      .eq('status', 'ACTIVE')
      .order('duty_day', { ascending: true })
      .order('duty_id', { ascending: true });

    if (duty_day && duty_day !== 'ALL') {
      // ดึงทั้งเวรปกติ และเวรพิเศษที่สังกัดวันนี้
      const targetDays = duty_day === 'S'
        ? ['S', 'MS', 'TS', 'WS', 'TSS', 'FS']
        : [duty_day, duty_day === 'Ts' ? 'TSS' : `${duty_day}S`];
      query = query.in('duty_day', targetDays);
    }

    const { data: members, error } = await query;
    if (error) throw error;

    let filtered = members || [];
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(m =>
        (m.first_name && m.first_name.toLowerCase().includes(s)) ||
        (m.last_name && m.last_name.toLowerCase().includes(s)) ||
        (m.nickname && m.nickname.toLowerCase().includes(s)) ||
        (m.duty_id && m.duty_id.toLowerCase().includes(s))
      );
    }

    res.json({ success: true, count: filtered.length, data: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 4. API: รายการคดีและหลักฐาน (Cases Vault)
// -------------------------------------------------------------
app.get('/api/cases', async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase
      .from('cases')
      .select('*')
      .order('incident_date_time', { ascending: false });

    if (status && status !== 'ALL') {
      query = query.eq('status', status);
    }

    const { data: cases, error } = await query;
    if (error) throw error;

    res.json({ success: true, count: (cases || []).length, data: cases || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 4.1 API: รับแจ้งเหตุใหม่ (Create Case)
// -------------------------------------------------------------
app.post('/api/cases', async (req, res) => {
  try {
    const payload = req.body || {};
    const caseId = payload.case_id || ('CASE-' + Math.floor(1000 + Math.random() * 9000));
    const reporterNameWithGrade = `${payload.reporter_name || 'ไม่ประสงค์ออกนาม'}${payload.reporter_grade && payload.reporter_grade !== '-' ? ` (ชั้น ${payload.reporter_grade})` : ''}`;

    const newCase = {
      case_id: caseId,
      reporter_email: payload.reporter_email || 'anonymous@pranarai.ac.th',
      reporter_name: reporterNameWithGrade,
      incident_date_time: payload.incident_date_time || new Date().toISOString(),
      location: (payload.contact_info && payload.contact_info !== '-' && String(payload.contact_info).trim() !== '') ? String(payload.contact_info).trim() : ((payload.location && payload.location !== 'โรงเรียนพระนารายณ์') ? String(payload.location).trim() : 'ไม่ระบุ'),
      category: payload.category || 'รับเรื่องร้องเรียน',
      description: payload.description || 'ไม่มีรายละเอียด',
      evidence_urls: Array.isArray(payload.evidence_urls) ? payload.evidence_urls : (payload.evidence_url ? [payload.evidence_url] : []),
      status: payload.status || 'PENDING'
    };

    const { data, error } = await supabase.from('cases').insert(newCase).select();
    if (error) throw error;

    res.status(201).json({ success: true, case_id: caseId, data: data[0] });
  } catch (err) {
    console.error('Case insert error:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 5. API: อัปเดตสถานะคดี
// -------------------------------------------------------------
app.patch('/api/cases/:id', async (req, res) => {
  try {
    const caseId = req.params.id;
    const { status, resolution_notes } = req.body;

    const updates = { updated_at: new Date() };
    if (status) updates.status = status;
    if (resolution_notes !== undefined) updates.resolution_notes = resolution_notes;

    const { error } = await supabase
      .from('cases')
      .update(updates)
      .eq('case_id', caseId);

    if (error) throw error;
    res.json({ success: true, message: 'Updated case successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 5.1 API: อัปโหลดคลิป Bodycam หรือแนบหลักฐานเข้าคดี
// -------------------------------------------------------------
app.post('/api/cases/:id/evidence', async (req, res) => {
  try {
    const caseId = req.params.id;
    const { url, filename, base64Data, notes } = req.body || {};
    let fileUrl = url;

    if (base64Data && filename) {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const safeName = `${caseId}_${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const filePath = path.join(uploadDir, safeName);
      const buffer = Buffer.from(base64Data.split(',').pop(), 'base64');
      fs.writeFileSync(filePath, buffer);
      fileUrl = `/uploads/${safeName}`;
    }

    if (!fileUrl) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุ URL หรือแนบไฟล์คลิป/ภาพถ่าย' });
    }

    const { data: currentCase } = await supabase
      .from('cases')
      .select('evidence_urls, resolution_notes')
      .eq('case_id', caseId)
      .maybeSingle();

    const existingUrls = currentCase?.evidence_urls || [];
    const updatedUrls = [...existingUrls, fileUrl];

    const updates = { evidence_urls: updatedUrls };
    if (notes) {
      updates.resolution_notes = (currentCase?.resolution_notes ? currentCase.resolution_notes + '\n' : '') +
        `[แนบหลักฐาน Bodycam]: ${notes} (${fileUrl})`;
    }

    const { error } = await supabase.from('cases').update(updates).eq('case_id', caseId);
    if (error) throw error;

    res.json({
      success: true,
      fileUrl,
      evidence_urls: updatedUrls,
      message: 'บันทึกไฟล์หลักฐานเข้าคดีสำเร็จ'
    });
  } catch (err) {
    console.error('Evidence upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 6. API: ยืนยันบัตรประจำตัวสาธารณะผ่าน QR Code (/verify?id=UUID)
// -------------------------------------------------------------
app.get('/api/verify/:id', async (req, res) => {
  try {
    const memberId = req.params.id;
    const { data: member, error } = await supabase
      .from('members')
      .select('id, first_name, last_name, nickname, grade_class, student_no, duty_day, duty_id, role, shift_role, status, profile_image_url, approved_at')
      .eq('id', memberId)
      .single();

    if (error || !member) {
      return res.status(404).json({ valid: false, message: 'ไม่พบบัตรหรือรหัสสมาชิกนี้ในระบบสารวัตรนักเรียน' });
    }

    const isValid = member.status === 'ACTIVE';
    res.json({
      valid: isValid,
      status: member.status,
      member: {
        name: `${member.first_name} ${member.last_name}`,
        nickname: member.nickname,
        duty_id: member.duty_id || '-',
        duty_day: member.duty_day,
        grade_class: member.grade_class,
        student_no: member.student_no,
        role: member.role,
        shift_role: member.shift_role,
        profile_image_url: member.profile_image_url,
        school: 'โรงเรียนพระนารายณ์'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 6.1 API: ดึงและบันทึกโครงสร้างเลเยอร์บัตร (Card Studio Template)
// -------------------------------------------------------------
const CONFIG_PATHS = [
  path.join(__dirname, 'card_layout_config.json'),
  path.join(__dirname, '..', 'card_layout_config.json')
];

function getLayoutConfig() {
  for (const p of CONFIG_PATHS) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (e) {}
    }
  }
  return null;
}

app.get('/api/card-template', (req, res) => {
  const config = getLayoutConfig();
  if (config) {
    return res.json({ success: true, config });
  }
  res.status(404).json({ success: false, message: 'Template configuration not found' });
});

app.post('/api/card-template', (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.canvas) {
      return res.status(400).json({ success: false, message: 'Invalid config payload' });
    }
    payload.updated_at = new Date().toISOString();
    const targetFile = CONFIG_PATHS[0];
    fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), 'utf8');
    // ซิงค์ไปยัง root ด้วยถ้ามี
    try {
      fs.writeFileSync(CONFIG_PATHS[1], JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {}

    res.json({ success: true, message: 'Layout template saved successfully', config: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 6.2 ระบบของหายและทรัพย์สินสูญหาย (Lost & Found System)
// -------------------------------------------------------------
const LOST_CACHE_FILE = path.join(__dirname, 'lost_items_cache.json');

const SEED_LOST_ITEMS = [
  {
    id: 'lf-001',
    item_code: 'LF-2026-001',
    title: 'กระเป๋าสตางค์หนังสีน้ำตาลเข้ม Tough',
    category: 'กระเป๋า / กระเป๋าสตางค์',
    characteristics: 'กระเป๋าหนังแท้พับสองตอนสีน้ำตาลเข้ม ยี่ห้อ Tough มีรอยขีดข่วนเล็กน้อยที่มุมขวาล่าง ภายในมีบัตรประจำตัวประชาชนและรูปถ่าย สภาพดี',
    image_url: 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=600&auto=format&fit=crop&q=80',
    location_found: 'โต๊ะม้าหินอ่อนหน้าอาคาร 3 (ใกล้ตู้กดน้ำ)',
    found_date: new Date().toISOString().slice(0, 10),
    found_time: '12:15 น.',
    status: 'WAITING_OWNER',
    storage_location: 'ห้องสารวัตรนักเรียน อาคาร 1 (ชั้น 1)',
    finder_name: 'นายกิตติศักดิ์ (นักเรียน ม.4/2)',
    finder_contact: '081-234-5678',
    created_at: new Date(Date.now() - 3600000 * 4).toISOString()
  },
  {
    id: 'lf-002',
    item_code: 'LF-2026-002',
    title: 'หูฟังบลูทูธ AirPods Pro 2 พร้อมเคสแคร์แบร์',
    category: 'อุปกรณ์ไอที / มือถือ',
    characteristics: 'ตัวเคสหูฟังสีขาว สวมเคสซิลิโคนสีเขียวขี้ม้า มีพวงกุญแจตุ๊กตา Care Bear สีชมพูห้อยอยู่ ฝาปิดด้านบนมีสติกเกอร์รูปหัวใจ',
    image_url: 'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=600&auto=format&fit=crop&q=80',
    location_found: 'อัฒจันทร์โดมกิจกรรม หน้าเวทีกลาง',
    found_date: new Date().toISOString().slice(0, 10),
    found_time: '08:30 น.',
    status: 'WAITING_OWNER',
    storage_location: 'ห้องสารวัตรนักเรียน อาคาร 1 (ตู้เซฟเก็บอุปกรณ์อิเล็กทรอนิกส์)',
    finder_name: 'สารวัตรเวรวันศุกร์ (ผลัด F)',
    finder_contact: 'โต๊ะเวรประจำวัน',
    created_at: new Date(Date.now() - 3600000 * 8).toISOString()
  },
  {
    id: 'lf-003',
    item_code: 'LF-2026-003',
    title: 'กุญแจรถจักรยานยนต์ Honda Wave 110i',
    category: 'กุญแจ / ยานพาหนะ',
    characteristics: 'ลูกกุญแจแท้ฮอนด้า พร้อมสายคล้องคอสีแดงสกรีนอักษรขาว HONDA RACING มีพวงลูกกุญแจบ้านอีก 2 ดอก และป้ายทะเบียนจิ๋วสีขาว',
    image_url: 'https://images.unsplash.com/photo-1582139329536-e7284fece509?w=600&auto=format&fit=crop&q=80',
    location_found: 'โรงจอดรถจักรยานยนต์นักเรียน โซน C แถวที่ 4',
    found_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    found_time: '16:45 น.',
    status: 'WAITING_OWNER',
    storage_location: 'ห้องสารวัตรนักเรียน อาคาร 1',
    finder_name: 'รปภ. ประตูหน้าโรงเรียน',
    finder_contact: 'ป้อมยามหน้าประตู 1',
    created_at: new Date(Date.now() - 3600000 * 24).toISOString()
  },
  {
    id: 'lf-004',
    item_code: 'LF-2026-004',
    title: 'เสื้อกันหนาวมีฮู้ดสีดำ Champion ไซส์ L',
    category: 'เครื่องแต่งกาย',
    characteristics: 'เสื้อแจ็คเก็ตฮู้ดดี้ผ้าหนาสีดำล้วน มีโลโก้ปักตัว C ที่แขนซ้าย ชายเสื้อมีป้ายผ้า Champion ป้ายคอด้านในมีเขียนชื่อด้วยปากกาเคมีว่า "นนท์ 5/7"',
    image_url: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=600&auto=format&fit=crop&q=80',
    location_found: 'ม้านั่งข้างสนามฟุตบอล ใต้ต้นจามจุรี',
    found_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    found_time: '17:20 น.',
    status: 'WAITING_OWNER',
    storage_location: 'ห้องสารวัตรนักเรียน อาคาร 1 (ราวแขวนเครื่องแบบ)',
    finder_name: 'สารวัตรเวรพิเศษ (ผลัด S)',
    finder_contact: 'เวรสารวัตร',
    created_at: new Date(Date.now() - 3600000 * 28).toISOString()
  },
  {
    id: 'lf-005',
    item_code: 'LF-2026-005',
    title: 'สมุดบันทึกและกล่องดินสอ Kuromi สีม่วง',
    category: 'อุปกรณ์การเรียน',
    characteristics: 'กล่องดินสอผ้าทรงกระบอกลายคุโรมิสีม่วง ภายในมีปากกาลูกลื่นหลากสี ลิควิดเปเป้อร์ และสมุดจดบันทึกวิชาคณิตศาสตร์',
    image_url: 'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=600&auto=format&fit=crop&q=80',
    location_found: 'ห้องสมุดเฉลิมพระเกียรติ โต๊ะอ่านหนังสือเบอร์ 8',
    found_date: new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10),
    found_time: '15:10 น.',
    status: 'CLAIMED',
    storage_location: 'ส่งมอบคืนเจ้าของแล้ว',
    finder_name: 'เจ้าหน้าที่ห้องสมุด',
    finder_contact: 'เคาน์เตอร์ยืม-คืน',
    claimant_name: 'ด.ญ. กัญญารัตน์ ม.2/4',
    claimant_student_no: '69421',
    claimed_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    created_at: new Date(Date.now() - 3600000 * 48).toISOString()
  }
];

function getLocalLostItems() {
  if (fs.existsSync(LOST_CACHE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LOST_CACHE_FILE, 'utf8'));
      if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {}
  }
  try {
    fs.writeFileSync(LOST_CACHE_FILE, JSON.stringify(SEED_LOST_ITEMS, null, 2), 'utf8');
  } catch (e) {}
  return SEED_LOST_ITEMS;
}

function saveLocalLostItems(items) {
  try {
    fs.writeFileSync(LOST_CACHE_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch (e) {
    console.error('[WEB] Failed to write lost items cache:', e.message);
  }
}

// API: รายการของหายทั้งหมด (Lost Items List)
app.get('/api/lost-items', async (req, res) => {
  try {
    const { category, status, search } = req.query;
    let items = [];
    let fromDb = false;

    if (supabase) {
      try {
        let query = supabase.from('lost_items').select('*').order('created_at', { ascending: false });
        if (status && status !== 'ALL') query = query.eq('status', status);
        if (category && category !== 'ALL') query = query.eq('category', category);
        const { data, error } = await query;
        if (!error && Array.isArray(data) && data.length > 0) {
          items = data;
          fromDb = true;
        }
      } catch (err) {}
    }

    if (!fromDb) {
      items = getLocalLostItems();
      if (status && status !== 'ALL') {
        items = items.filter(it => it.status === status);
      }
      if (category && category !== 'ALL') {
        items = items.filter(it => it.category === category);
      }
    }

    if (search) {
      const s = String(search).toLowerCase();
      items = items.filter(it =>
        (it.title && it.title.toLowerCase().includes(s)) ||
        (it.characteristics && it.characteristics.toLowerCase().includes(s)) ||
        (it.location_found && it.location_found.toLowerCase().includes(s)) ||
        (it.item_code && it.item_code.toLowerCase().includes(s)) ||
        (it.category && it.category.toLowerCase().includes(s))
      );
    }

    res.json({ success: true, count: items.length, source: fromDb ? 'database' : 'cache', data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: บันทึกรับแจ้งของหาย / ส่งมอบของเก็บได้ใหม่
app.post('/api/lost-items', async (req, res) => {
  try {
    const payload = req.body || {};
    const localItems = getLocalLostItems();
    const countCode = String(localItems.length + 1).padStart(3, '0');
    const itemCode = payload.item_code || `LF-${new Date().getFullYear()}-${countCode}`;

    let imageUrl = payload.image_url || '';
    if (payload.base64Image && payload.filename) {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const safeName = `LOST_${Date.now()}_${payload.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const filePath = path.join(uploadDir, safeName);
      const buffer = Buffer.from(payload.base64Image.split(',').pop(), 'base64');
      fs.writeFileSync(filePath, buffer);
      imageUrl = `/uploads/${safeName}`;
    }

    const newItem = {
      id: payload.id || ('lf-' + Date.now()),
      item_code: itemCode,
      title: payload.title || 'ทรัพย์สินไม่ระบุชื่อ',
      category: payload.category || 'อื่นๆ',
      characteristics: payload.characteristics || 'ไม่มีรายละเอียดลักษณะเด่น',
      image_url: imageUrl || 'https://images.unsplash.com/photo-1584438784894-089d6a62b8fa?w=600&auto=format&fit=crop&q=80',
      location_found: payload.location_found || 'ไม่ระบุสถานที่',
      found_date: payload.found_date || new Date().toISOString().slice(0, 10),
      found_time: payload.found_time || (new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.'),
      status: 'WAITING_OWNER',
      storage_location: payload.storage_location || 'ห้องสารวัตรนักเรียน อาคาร 1',
      finder_name: payload.finder_name || 'ไม่ประสงค์ออกนาม',
      finder_contact: payload.finder_contact || '-',
      notes: payload.notes || '',
      created_at: new Date().toISOString()
    };

    if (supabase) {
      try {
        await supabase.from('lost_items').insert(newItem);
      } catch (dbErr) {
        console.warn('[WEB] Supabase insert lost_item fallback:', dbErr.message);
      }
    }

    localItems.unshift(newItem);
    saveLocalLostItems(localItems);

    res.status(201).json({ success: true, message: 'บันทึกข้อมูลของหายสำเร็จ', data: newItem });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: ส่งมอบคืนเจ้าของ (Claim Item)
app.patch('/api/lost-items/:id/claim', async (req, res) => {
  try {
    const itemId = req.params.id;
    const { claimant_name, claimant_student_no, notes } = req.body || {};
    const updates = {
      status: 'CLAIMED',
      claimant_name: claimant_name || 'เจ้าของมารับคืน',
      claimant_student_no: claimant_student_no || '-',
      claimed_at: new Date().toISOString(),
      storage_location: 'ส่งมอบคืนเจ้าของเรียบร้อยแล้ว'
    };
    if (notes) updates.notes = notes;

    if (supabase) {
      try {
        await supabase.from('lost_items').update(updates).or(`id.eq.${itemId},item_code.eq.${itemId}`);
      } catch (dbErr) {
        console.warn('[WEB] Supabase claim lost_item fallback:', dbErr.message);
      }
    }

    const localItems = getLocalLostItems();
    const idx = localItems.findIndex(it => it.id === itemId || it.item_code === itemId);
    if (idx !== -1) {
      localItems[idx] = { ...localItems[idx], ...updates };
      saveLocalLostItems(localItems);
    }

    res.json({ success: true, message: 'บันทึกการส่งมอบคืนเจ้าของสำเร็จ', data: updates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 6.3 หน้าเว็บสาธารณะระบบของหาย (/lost-found)
// -------------------------------------------------------------
app.get('/lost-found', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lost-found.html'));
});

// -------------------------------------------------------------
// 7. หน้าเว็บอัปโหลด Bodycam และหลักฐาน (/bodycam-upload)
// -------------------------------------------------------------
app.get('/bodycam-upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'bodycam-upload.html'));
});

// -------------------------------------------------------------
// 7.1 หน้าเว็บตรวจสอบบัตรทางการ (Public QR Scan Page)
// -------------------------------------------------------------
app.get('/verify', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verify.html'));
});

// หน้าแดชบอร์ดหลัก
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[SARAWAT-WEB] 🌐 Dashboard Online on http://localhost:${PORT}`);
});
