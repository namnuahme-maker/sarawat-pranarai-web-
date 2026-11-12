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
    const leaveTypes = {
      sick: 0,        // ลาป่วย
      personal: 0,    // ลากิจ
      activity: 0,    // กิจกรรมโรงเรียน/แข่งขัน
      other: 0        // อื่นๆ
    };

    // สถิติแนวโน้มย้อนหลัง 7 วัน
    const weeklyTrend = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const dayNames = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
      weeklyTrend.push({
        date: iso,
        dayLabel: dayNames[d.getDay()],
        count: 0
      });
    }

    try {
      const { count: cLeaves } = await supabase.from('leave_requests').select('*', { count: 'exact', head: true });
      totalLeaves = cLeaves || 0;

      const { count: pLeaves } = await supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'PENDING');
      pendingLeaves = pLeaves || 0;

      const { data: allLeaves } = await supabase.from('leave_requests')
        .select('leave_date, leave_type, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      const today = new Date();
      const todayISO = today.toISOString().slice(0, 10);
      const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      const todayThaiPattern = `${today.getDate()} ${thaiMonths[today.getMonth()]}`;

      (allLeaves || []).forEach(l => {
        // นับยอดลาวันนี้
        if ((l.leave_date && l.leave_date.includes(todayThaiPattern)) ||
            (l.created_at && l.created_at.startsWith(todayISO))) {
          todayLeavesCount++;
        }

        // จัดหมวดหมู่ประเภทการลา
        const t = (l.leave_type || '').toLowerCase();
        if (t.includes('ป่วย') || t.includes('sick')) {
          leaveTypes.sick++;
        } else if (t.includes('กิจ') || t.includes('personal')) {
          leaveTypes.personal++;
        } else if (t.includes('กิจกรรม') || t.includes('แข่ง') || t.includes('activity')) {
          leaveTypes.activity++;
        } else {
          leaveTypes.other++;
        }

        // จับคู่ลงในแนวโน้ม 7 วัน
        if (l.created_at) {
          const itemDate = l.created_at.slice(0, 10);
          const trendItem = weeklyTrend.find(w => w.date === itemDate);
          if (trendItem) trendItem.count++;
        }
      });
    } catch (e) {
      console.warn('[WEB] Cannot query leave_requests:', e.message);
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
        pending: pendingLeaves,
        types: leaveTypes,
        trend: weeklyTrend
      },
      shifts: shiftCounts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 2.05 API: ค่า Config สำหรับ Supabase Realtime Client
// -------------------------------------------------------------
app.get('/api/config/supabase-env', (req, res) => {
  res.json({
    success: true,
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  });
});

// ==========================================================
// 📅 ACADEMIC PERIOD & QUARTER SYSTEM (ระบบปีการศึกษาและไตรมาส)
// ==========================================================
const PERIOD_SETTINGS_PATHS = [
  path.join(__dirname, 'settings.json'),
  path.join(__dirname, '..', 'bot', 'settings.json')
];

function getCurrentQuarterAndYear(d = new Date()) {
  const thaiDate = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const month = thaiDate.getMonth() + 1; // 1 - 12
  const ceYear = thaiDate.getFullYear();

  let quarter = 1;
  let semester = 2;
  let academicYear = ceYear + 543;

  if (month >= 11 || month === 1) {
    quarter = 1;
    semester = 2;
    academicYear = month === 1 ? (ceYear - 1) + 543 : ceYear + 543;
  } else if (month >= 2 && month <= 4) {
    quarter = 2;
    semester = 2;
    academicYear = (ceYear - 1) + 543;
  } else if (month >= 5 && month <= 7) {
    quarter = 3;
    semester = 1;
    academicYear = ceYear + 543;
  } else {
    quarter = 4;
    semester = 1;
    academicYear = ceYear + 543;
  }

  const quarterMonths = {
    1: 'พ.ย. - ม.ค.',
    2: 'ก.พ. - เม.ย.',
    3: 'พ.ค. - ก.ค.',
    4: 'ส.ค. - ต.ค.'
  };

  return {
    quarter,
    semester,
    academicYear,
    buddhistYear: ceYear + 543,
    ceYear,
    quarterName: `ไตรมาสที่ ${quarter} (${quarterMonths[quarter]})`,
    semesterName: `ภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`,
    fullLabel: `ภาคเรียนที่ ${semester} / ปีการศึกษา ${academicYear} • ประจำไตรมาสที่ ${quarter} (12 สัปดาห์)`
  };
}

function getPeriodSettings() {
  for (const p of PERIOD_SETTINGS_PATHS) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (e) {}
    }
  }
  const auto = getCurrentQuarterAndYear();
  return {
    mode: 'auto',
    academic_year: auto.academicYear,
    quarter: auto.quarter,
    current_semester: auto.semesterName
  };
}

function getAcademicPeriod() {
  const auto = getCurrentQuarterAndYear(new Date());
  const settings = getPeriodSettings();

  if (settings.mode === 'manual' && settings.academic_year && settings.quarter) {
    const q = parseInt(settings.quarter, 10) || auto.quarter;
    const y = parseInt(settings.academic_year, 10) || auto.academicYear;
    const sem = (q === 3 || q === 4) ? 1 : 2;
    const quarterMonths = { 1: 'พ.ย. - ม.ค.', 2: 'ก.พ. - เม.ย.', 3: 'พ.ค. - ก.ค.', 4: 'ส.ค. - ต.ค.' };
    return {
      quarter: q,
      semester: sem,
      academicYear: y,
      isAuto: false,
      quarterName: `ไตรมาสที่ ${q} (${quarterMonths[q] || ''})`,
      semesterName: settings.current_semester || `ภาคเรียนที่ ${sem} ปีการศึกษา ${y}`,
      fullLabel: `ภาคเรียนที่ ${sem} / ปีการศึกษา ${y} • ประจำไตรมาสที่ ${q} (12 สัปดาห์)`
    };
  }

  return {
    ...auto,
    isAuto: true
  };
}

function savePeriodSettings(data) {
  for (const p of PERIOD_SETTINGS_PATHS) {
    try {
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
  }
}

app.get('/api/academic-period', (req, res) => {
  const auto = getCurrentQuarterAndYear(new Date());
  const period = getAcademicPeriod();
  res.json({
    success: true,
    auto_detected: auto,
    current: period,
    settings: getPeriodSettings()
  });
});

app.post('/api/academic-period', (req, res) => {
  try {
    const { mode, academic_year, quarter, current_semester } = req.body;
    const settings = getPeriodSettings();
    if (mode === 'auto') {
      settings.mode = 'auto';
      delete settings.academic_year;
      delete settings.quarter;
      const auto = getCurrentQuarterAndYear(new Date());
      settings.current_semester = auto.semesterName;
    } else {
      settings.mode = 'manual';
      if (academic_year) settings.academic_year = parseInt(academic_year, 10);
      if (quarter) settings.quarter = parseInt(quarter, 10);
      if (current_semester) {
        settings.current_semester = current_semester;
      } else {
        const q = settings.quarter || 1;
        const sem = (q === 3 || q === 4) ? 1 : 2;
        settings.current_semester = `ภาคเรียนที่ ${sem} ปีการศึกษา ${settings.academic_year}`;
      }
    }
    settings.updated_at = new Date().toISOString();
    savePeriodSettings(settings);
    res.json({ success: true, period: getAcademicPeriod() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 2.1 API: ข้อมูลการขอลาเวร (Leave Requests)
// -------------------------------------------------------------
app.get('/api/leaves', async (req, res) => {
  try {
    const { date, shift } = req.query;
    let query = supabase
      .from('leave_requests')
      .select('*, members(first_name, last_name, nickname, duty_id, profile_image_url)')
      .order('created_at', { ascending: false });

    if (date) query = query.eq('leave_date', date);
    if (shift) query = query.eq('duty_day', shift);

    const { data, error } = await query;
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
    let query = supabase
      .from('members')
      .select('id, first_name, last_name, nickname, grade_class, student_no, duty_day, duty_id, role, shift_role, status, profile_image_url, approved_at');

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId)) {
      query = query.eq('id', memberId);
    } else {
      query = query.or(`duty_id.eq.${memberId},id.eq.${memberId}`);
    }

    const { data: member, error } = await query.maybeSingle();

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
// 6. ระบบคลังของหายและส่งมอบคืน (Lost & Found System)
// -------------------------------------------------------------
const LOST_FOUND_DB_FILE = path.join(__dirname, '..', 'data', 'lost_found_db.json');
const LOST_FOUND_LOCAL_DB = path.join(__dirname, 'lost_found_db.json');
const LOST_FOUND_CACHE_FILE = path.join(__dirname, 'lost_items_cache.json');

function getLostFoundData() {
  let db = { items: [], claims: [], categories: [] };
  const candidateFiles = [LOST_FOUND_DB_FILE, LOST_FOUND_LOCAL_DB];
  for (const f of candidateFiles) {
    try {
      if (fs.existsSync(f)) {
        const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.items) && parsed.items.length > 0) db.items = parsed.items;
          if (Array.isArray(parsed.claims) && parsed.claims.length > 0) db.claims = parsed.claims;
          if (Array.isArray(parsed.categories) && parsed.categories.length > 0) db.categories = parsed.categories;
        }
      }
    } catch (e) {
      console.error('[LOST-FOUND DB ERROR]:', e);
    }
  }

  // Fallback: หากรายการ items ยังว่างอยู่ ให้ดึงจาก lost_items_cache.json
  if (db.items.length === 0 && fs.existsSync(LOST_FOUND_CACHE_FILE)) {
    try {
      const cacheParsed = JSON.parse(fs.readFileSync(LOST_FOUND_CACHE_FILE, 'utf8'));
      if (Array.isArray(cacheParsed) && cacheParsed.length > 0) {
        db.items = cacheParsed;
      }
    } catch (e) {}
  }
  return db;
}

function saveLostFoundData(data) {
  const targets = [LOST_FOUND_DB_FILE, LOST_FOUND_LOCAL_DB];
  for (const t of targets) {
    try {
      const dir = path.dirname(t);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(t, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('[LOST-FOUND SAVE ERROR]:', e);
    }
  }
  try {
    fs.writeFileSync(LOST_FOUND_CACHE_FILE, JSON.stringify(data.items || [], null, 2), 'utf8');
  } catch (e) {}
}

// 6.0 ตรวจสอบสถานะการเชื่อมต่อฐานข้อมูล Supabase
app.get('/api/lost-found/schema-status', async (req, res) => {
  try {
    let itemsTable = false;
    let claimsTable = false;
    let categoriesTable = false;

    try {
      const { error: e1 } = await supabase.from('lost_items').select('id').limit(1);
      if (!e1) itemsTable = true;
    } catch (e) {}

    try {
      const { error: e2 } = await supabase.from('lost_claims').select('id').limit(1);
      if (!e2) claimsTable = true;
    } catch (e) {}

    try {
      const { error: e3 } = await supabase.from('lost_categories').select('id').limit(1);
      if (!e3) categoriesTable = true;
    } catch (e) {}

    res.json({
      success: true,
      supabase_url: process.env.SUPABASE_URL ? 'CONFIGURED' : 'MISSING',
      tables: {
        lost_items: itemsTable,
        lost_claims: claimsTable,
        lost_categories: categoriesTable
      },
      mode: (itemsTable && claimsTable) ? 'SUPABASE_POSTGRES' : 'HYBRID_MIRROR_FALLBACK'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.0.1 หมวดหมู่สิ่งของ (Lost & Found Categories - Configured by Sarawat)
app.get('/api/lost-found/categories', async (req, res) => {
  try {
    let categories = [];
    let isDbConnected = false;

    try {
      const { data, error } = await supabase.from('lost_categories').select('*').order('created_at', { ascending: true });
      if (!error && Array.isArray(data) && data.length > 0) {
        categories = data;
        isDbConnected = true;
      }
    } catch (e) {}

    if (!isDbConnected || categories.length === 0) {
      const db = getLostFoundData();
      categories = (db.categories && db.categories.length > 0) ? db.categories : [
        { id: 'cat-wallet', name: 'กระเป๋า / กระเป๋าสตางค์', icon: '👛', description: 'กระเป๋าเงิน เป้ กระเป๋าสะพาย' },
        { id: 'cat-it', name: 'อุปกรณ์ไอที / มือถือ', icon: '📱', description: 'โทรศัพท์มือถือ หูฟัง พาวเวอร์แบงก์' },
        { id: 'cat-key', name: 'กุญแจ / ยานพาหนะ', icon: '🔑', description: 'กุญแจรถ กุญแจบ้าน คีย์การ์ด' },
        { id: 'cat-clothes', name: 'เครื่องแต่งกาย / หมวก', icon: '👕', description: 'เสื้อคลุม หมวก เข็มขัด รองเท้า' },
        { id: 'cat-stationery', name: 'เครื่องเขียน / หนังสือ', icon: '📚', description: 'สมุด หนังสือ ปากกา อุปกรณ์เรียน' },
        { id: 'cat-general', name: 'สิ่งของทั่วไป / อื่นๆ', icon: '📦', description: 'สิ่งของอื่นๆ ที่เก็บได้' }
      ];
    }

    res.json({ success: true, count: categories.length, categories, isDbConnected });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/lost-found/categories', async (req, res) => {
  try {
    const { name, icon, description } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุชื่อหมวดหมู่' });
    }

    const trimmedName = name.trim();
    const cleanIcon = (icon && icon.trim()) ? icon.trim() : '📦';
    const cleanDesc = (description && description.trim()) ? description.trim() : '';

    const db = getLostFoundData();
    if (!Array.isArray(db.categories)) db.categories = [];

    // ตรวจสอบชื่อหมวดหมู่ซ้ำ
    const exists = db.categories.some(c => c.name.toLowerCase() === trimmedName.toLowerCase());
    if (exists) {
      return res.status(400).json({ success: false, error: 'หมวดหมู่นี้มีอยู่ในระบบแล้ว' });
    }

    const code = 'CAT-' + Date.now().toString(36).toUpperCase();
    const newCategory = {
      id: `cat-${Date.now()}`,
      code,
      name: trimmedName,
      icon: cleanIcon,
      description: cleanDesc,
      created_at: new Date().toISOString()
    };

    // บันทึกลง Supabase PostgreSQL
    try {
      const { data, error } = await supabase.from('lost_categories').insert([{
        code,
        name: trimmedName,
        icon: cleanIcon,
        description: cleanDesc
      }]).select().single();
      if (!error && data) {
        newCategory.id = data.id;
      }
    } catch (e) {
      console.warn('[SUPABASE CATEGORY INSERT WARN]:', e.message);
    }

    db.categories.push(newCategory);
    saveLostFoundData(db);

    res.json({ success: true, category: newCategory });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/lost-found/categories/:id', async (req, res) => {
  try {
    const catId = req.params.id;
    const db = getLostFoundData();
    const catIndex = (db.categories || []).findIndex(c => c.id === catId || c.code === catId);

    if (catIndex === -1) {
      return res.status(404).json({ success: false, error: 'ไม่พบหมวดหมู่ที่ต้องการลบ' });
    }

    const targetCat = db.categories[catIndex];

    // ตรวจสอบว่าหมวดหมู่นี้มีการใช้งานในสิ่งของหรือคำร้องหรือไม่
    const isUsedInItems = (db.items || []).some(it => it.category === targetCat.name);
    const isUsedInClaims = (db.claims || []).some(cl => cl.category === targetCat.name);

    if (isUsedInItems || isUsedInClaims) {
      return res.status(400).json({
        success: false,
        error: `ไม่สามารถลบหมวดหมู่ "${targetCat.name}" ได้ เนื่องจากมีรายการสิ่งของหรือคำร้องใช้งานอยู่`
      });
    }

    // ลบจาก Supabase
    try {
      await supabase.from('lost_categories').delete().or(`id.eq.${catId},code.eq.${catId}`);
    } catch (e) {
      console.warn('[SUPABASE CATEGORY DELETE WARN]:', e.message);
    }

    db.categories.splice(catIndex, 1);
    saveLostFoundData(db);

    res.json({ success: true, message: `ลบหมวดหมู่ "${targetCat.name}" เรียบร้อยแล้ว` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.1 ดึงรายการสิ่งของที่พบเจอ (Found Items)
app.get('/api/lost-found/items', async (req, res) => {
  try {
    const { category, status, search } = req.query;
    let items = [];
    let isDbConnected = false;

    // ตรวจสอบข้อมูลจาก Supabase PostgreSQL ก่อนเสมอ
    try {
      let query = supabase.from('lost_items').select('*').order('created_at', { ascending: false });
      if (status && status !== 'ALL') query = query.eq('status', status);
      if (category && category !== 'ALL') {
        if (category === 'ของกลาง' || category.includes('ของกลาง')) {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10);
          query = query.or(`category.ilike.%ของกลาง%,found_date.lte.${thirtyDaysAgoStr}`);
        } else {
          query = query.ilike('category', `%${category}%`);
        }
      }
      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        items = data;
        isDbConnected = true;
      }
    } catch (e) {}

    // หากยังไม่ได้รัน SQL Migration ใน Supabase ให้สลับไปใช้ Local DB File อัตโนมัติ
    if (!isDbConnected) {
      const db = getLostFoundData();
      items = db.items || [];
      if (status && status !== 'ALL') {
        items = items.filter(it => it.status === status);
      }
      if (category && category !== 'ALL') {
        if (category === 'ของกลาง' || category.includes('ของกลาง')) {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10);
          items = items.filter(it => {
            const isCatOfKlang = it.category && it.category.includes('ของกลาง');
            const isOldDate = it.found_date && it.found_date <= thirtyDaysAgoStr;
            const isOldCreated = it.created_at && new Date(it.created_at) <= thirtyDaysAgo;
            return isCatOfKlang || isOldDate || isOldCreated;
          });
        } else {
          items = items.filter(it => it.category && it.category.includes(category));
        }
      }
    }

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(it =>
        (it.title && it.title.toLowerCase().includes(q)) ||
        (it.item_code && it.item_code.toLowerCase().includes(q)) ||
        (it.characteristics && it.characteristics.toLowerCase().includes(q)) ||
        (it.location_found && it.location_found.toLowerCase().includes(q))
      );
    }

    const waitingCount = items.filter(i => i.status === 'WAITING_OWNER').length;
    const deliveredCount = items.filter(i => i.status === 'DELIVERED').length;

    res.json({
      success: true,
      source: isDbConnected ? 'supabase_database' : 'local_database_fallback',
      count: items.length,
      data: items,
      stats: {
        total: items.length,
        waiting: waitingCount,
        delivered: deliveredCount
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.2 บันทึกสิ่งของพบเจอใหม่ (Intake New Found Item)
app.post('/api/lost-found/items', async (req, res) => {
  try {
    const {
      title,
      category,
      characteristics,
      secret_traits,
      location_found,
      found_date,
      found_time,
      storage_location,
      finder_name,
      finder_contact,
      image_base64,
      image_url
    } = req.body || {};

    const reqCharacteristics = (characteristics || title || '').trim();
    if (!title || !category || !reqCharacteristics) {
      return res.status(400).json({ success: false, error: 'กรุณากรอกชื่อสิ่งของ หมวดหมู่ และลักษณะเฉพาะตัวให้ครบถ้วน' });
    }

    let finalImageUrl = image_url || '/assets/sample_student.jpg';
    if (image_base64) {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filename = `lost_item_${Date.now()}.jpg`;
      const buf = Buffer.from(image_base64.split(',').pop(), 'base64');
      fs.writeFileSync(path.join(uploadDir, filename), buf);
      finalImageUrl = `/uploads/${filename}`;

      // อัปโหลดเข้าสู่ Supabase Storage sarawat-photos ถาวร
      try {
        const storagePath = `lost-found/${filename}`;
        const { error: sErr } = await supabase.storage
          .from('sarawat-photos')
          .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });
        if (!sErr) {
          const { data: { publicUrl } } = supabase.storage.from('sarawat-photos').getPublicUrl(storagePath);
          finalImageUrl = publicUrl;
        }
      } catch (e) {}
    }

    const currentYear = new Date().getFullYear();
    const db = getLostFoundData();
    const itemNum = String((db.items?.length || 0) + 1).padStart(3, '0');
    const itemCode = req.body.item_code || `LF-${currentYear}-${itemNum}`;

    const newItem = {
      id: req.body.id || `lf-${Date.now()}`,
      item_code: itemCode,
      title: title.trim(),
      category: category.trim(),
      characteristics: reqCharacteristics,
      secret_traits: (secret_traits && secret_traits.trim()) ? secret_traits.trim() : null,
      image_url: finalImageUrl,
      location_found: location_found || 'ไม่ระบุสถานที่',
      found_date: found_date || new Date().toISOString().slice(0, 10),
      found_time: found_time || new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.',
      status: req.body.status || 'WAITING_OWNER',
      storage_location: storage_location || 'ห้องสารวัตรนักเรียน อาคาร 1',
      finder_name: finder_name || 'สารวัตรเวร',
      finder_duty_id: req.body.finder_duty_id || null,
      finder_avatar_url: req.body.finder_avatar_url || null,
      finder_contact: finder_contact || '-',
      created_at: req.body.created_at || new Date().toISOString(),
      updated_at: req.body.updated_at || new Date().toISOString()
    };

    let savedItem = newItem;
    let isDbSaved = false;

    // บันทึกเข้า Supabase PostgreSQL Database (หากมีตาราง)
    try {
      const { data, error } = await supabase.from('lost_items').insert(newItem).select().single();
      if (!error && data) {
        savedItem = data;
        isDbSaved = true;
      }
    } catch (e) {}

    // บันทึกสำเนาลง Local JSON เสมอเพื่อความเสถียร (ป้องกัน duplicate item_code)
    db.items = db.items || [];
    const existIdx = db.items.findIndex(i => i.item_code === itemCode);
    if (existIdx >= 0) {
      db.items[existIdx] = { ...db.items[existIdx], ...savedItem };
    } else {
      db.items.unshift(savedItem);
    }
    saveLostFoundData(db);

    res.status(201).json({
      success: true,
      storage: isDbSaved ? 'supabase_database' : 'local_mirror_file',
      item: savedItem,
      message: `บันทึกของพบเจอสำเร็จ รหัส: ${itemCode}`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.3 ดึงรายการคำร้องขอรับของ / แจ้งของหาย (Claims from Google Form / Web)
app.get('/api/lost-found/claims', async (req, res) => {
  try {
    let claims = [];
    let isDbConnected = false;

    try {
      const { data, error } = await supabase.from('lost_claims').select('*').order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        claims = data;
        isDbConnected = true;
      }
    } catch (e) {}

    if (!isDbConnected) {
      const db = getLostFoundData();
      claims = db.claims || [];
    }

    res.json({
      success: true,
      source: isDbConnected ? 'supabase_database' : 'local_database_fallback',
      count: claims.length,
      data: claims
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.4 รับคำร้องแจ้งของหายใหม่ (จาก Google Form Webhook หรือผ่านหน้าเว็บ)
app.post('/api/lost-found/claims', async (req, res) => {
  try {
    const payload = req.body || {};
    const db = getLostFoundData();
    const currentYear = new Date().getFullYear();
    const claimNum = String((db.claims?.length || 0) + 1).padStart(3, '0');
    const claimCode = `CLM-${currentYear}-${claimNum}`;

    const newClaim = {
      claim_code: claimCode,
      category: payload.category || payload.item_category || 'อื่นๆ',
      item_type: payload.item_type || payload.type || payload.title || 'ไม่ระบุ',
      characteristics: payload.characteristics || payload.description || 'ไม่มีรายละเอียด',
      lost_location: payload.lost_location || payload.location || 'ไม่ระบุ',
      lost_date: payload.lost_date || new Date().toISOString().slice(0, 10),
      claimant_name: payload.claimant_name || payload.name || 'ไม่ประสงค์ออกนาม',
      claimant_class: payload.claimant_class || payload.class || '-',
      claimant_contact: payload.claimant_contact || payload.phone || payload.contact || '-',
      status: 'PENDING',
      matched_item_id: null,
      created_at: new Date().toISOString()
    };

    let savedClaim = newClaim;
    let isDbSaved = false;

    try {
      const { data, error } = await supabase.from('lost_claims').insert(newClaim).select().single();
      if (!error && data) {
        savedClaim = data;
        isDbSaved = true;
      }
    } catch (e) {}

    db.claims = db.claims || [];
    db.claims.unshift(savedClaim);
    saveLostFoundData(db);

    res.status(201).json({
      success: true,
      storage: isDbSaved ? 'supabase_database' : 'local_mirror_file',
      claim: savedClaim,
      message: `บันทึกคำร้องสำเร็จ รหัส: ${claimCode}`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.5 ตรวจสอบและจับคู่ของในหมวดหมู่ที่ใกล้เคียงกับคำร้อง (Smart Matching Engine)
app.get('/api/lost-found/claims/:id/matches', async (req, res) => {
  try {
    const claimId = req.params.id;
    let claim = null;
    let allItems = [];

    // ดึงข้อมูลคำร้อง
    try {
      const { data: cData, error: cErr } = await supabase.from('lost_claims').select('*').or(`id.eq.${claimId},claim_code.eq.${claimId}`).maybeSingle();
      if (!cErr && cData) claim = cData;
    } catch (e) {}

    // ดึงสิ่งของในคลัง
    try {
      const { data: iData, error: iErr } = await supabase.from('lost_items').select('*').eq('status', 'WAITING_OWNER');
      if (!iErr && Array.isArray(iData)) allItems = iData;
    } catch (e) {}

    // Fallback ถ้า Supabase ยังไม่ได้รัน
    if (!claim || allItems.length === 0) {
      const db = getLostFoundData();
      if (!claim) claim = (db.claims || []).find(c => c.id === claimId || c.claim_code === claimId);
      if (allItems.length === 0) allItems = (db.items || []).filter(item => item.status === 'WAITING_OWNER');
    }

    if (!claim) {
      return res.status(404).json({ success: false, message: 'ไม่พบคำร้องที่ระบุ' });
    }

    const claimKeywords = `${claim.category || ''} ${claim.item_type || ''} ${claim.characteristics || ''}`
      .toLowerCase()
      .split(/[\s,./-]+/)
      .filter(w => w.length > 1);

    const matches = allItems
      .map(item => {
        let score = 0;
        // คะแนนหมวดหมู่เดียวกัน
        if (item.category && claim.category && (item.category.includes(claim.category) || claim.category.includes(item.category))) {
          score += 45;
        }
        // คะแนนคำตรงกันในชื่อและลักษณะเฉพาะ
        const itemText = `${item.title || ''} ${item.characteristics || ''} ${item.location_found || ''}`.toLowerCase();
        let matchedWords = [];
        claimKeywords.forEach(kw => {
          if (itemText.includes(kw)) {
            score += 15;
            matchedWords.push(kw);
          }
        });

        return {
          item,
          match_score: Math.min(score, 98),
          matched_keywords: matchedWords
        };
      })
      .filter(m => m.match_score >= 25)
      .sort((a, b) => b.match_score - a.match_score);

    res.json({ success: true, claim, matches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.5.1 ค้นหาข้อมูลสารวัตรนักเรียนด้วยรหัสประจำตัว (เช่น MS1, TS4, T2, F3)
app.get('/api/inspectors/lookup/:dutyId', async (req, res) => {
  try {
    const rawDutyId = (req.params.dutyId || '').trim();
    if (!rawDutyId) return res.status(400).json({ success: false, error: 'กรุณาระบุรหัสประจำตัวสารวัตร' });

    let member = null;
    try {
      const { data, error } = await supabase
        .from('members')
        .select('id, duty_id, first_name, last_name, nickname, duty_day, shift_role, profile_image_url, grade_class, student_no')
        .ilike('duty_id', rawDutyId)
        .limit(1)
        .maybeSingle();
      if (!error && data) member = data;
    } catch (e) {}

    // ค้นหาเพิ่มเติมกรณีพิมพ์ตัวพิมพ์เล็กหรือชื่อเล่น
    if (!member) {
      try {
        const { data: allM } = await supabase.from('members').select('*');
        if (allM) {
          member = allM.find(m => 
            (m.duty_id && m.duty_id.toLowerCase() === rawDutyId.toLowerCase()) ||
            (m.nickname && m.nickname.toLowerCase() === rawDutyId.toLowerCase()) ||
            (`${m.first_name || ''} ${m.last_name || ''}`.toLowerCase().includes(rawDutyId.toLowerCase()))
          );
        }
      } catch (e) {}
    }

    if (!member) {
      return res.json({ success: true, found: false, message: `ไม่พบข้อมูลสารวัตรสำหรับรหัส [${rawDutyId}]` });
    }

    const fullName = `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'สารวัตรนักเรียน';
    const roleTitle = member.shift_role === 'SHIFT_HEAD' ? 'หัวหน้าเวร' : (member.shift_role === 'SHIFT_DEPUTY' ? 'รองหัวหน้าเวร' : 'สารวัตรนักเรียน');

    res.json({
      success: true,
      found: true,
      member: {
        id: member.id,
        duty_id: member.duty_id || rawDutyId.toUpperCase(),
        full_name: fullName,
        nickname: member.nickname || '',
        displayName: member.nickname ? `${fullName} (${member.nickname})` : fullName,
        shift: member.duty_day || '',
        shift_role: roleTitle,
        photo_url: member.profile_image_url || '/assets/logo.png',
        grade_class: member.grade_class || '',
        student_no: member.student_no || ''
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ฟังก์ชันประกาศส่งมอบของหายไปยัง Discord และดึงลิงก์รูป Discord CDN
async function announceHandoverToDiscord(payload) {
  // 1. ลองเรียก Bot HTTP Server ก่อน
  const botBase = process.env.RENDER_EXTERNAL_URL || 'http://localhost:10000';
  try {
    const res = await fetch(`${botBase}/api/discord/announce-handover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await res.json();
    if (d.success && d.discord_photo_url) return d.discord_photo_url;
  } catch (e) {}

  // 2. Fallback: ส่งผ่าน Discord REST API โดยตรง
  try {
    const token = process.env.DISCORD_TOKEN;
    const guildId = process.env.GUILD_ID || '1567547042207895664';
    if (!token) return null;

    const chRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${token}` }
    });
    const channels = await chRes.json();
    const chTarget = Array.isArray(channels) ? (channels.find(c => c.name.includes('ของหาย')) || channels.find(c => c.name.includes('บริการ'))) : null;
    if (!chTarget) return null;

    if (payload.handover_photo_base64) {
      const buf = Buffer.from(payload.handover_photo_base64.split(',').pop(), 'base64');
      const filename = `handover_${(payload.item_code || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
      const formData = new FormData();
      formData.append('files[0]', new Blob([buf], { type: 'image/jpeg' }), filename);
      formData.append('payload_json', JSON.stringify({
        embeds: [{
          title: `🎉 ส่งมอบสิ่งของคืนเจ้าของเรียบร้อยแล้ว! [${payload.item_code || ''}]`,
          description:
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🏷️ **สิ่งของ:** ${payload.title || '-'}\n` +
            `👤 **ผู้รับคืน:** ${payload.claimant_name || '-'} (${payload.claimant_contact || '-'})\n` +
            `🛡️ **สารวัตรผู้ส่งมอบ:** ${payload.delivered_by || '-'} \`[${payload.delivered_by_duty_id || '-'}]\`\n` +
            `📅 **วันเวลา:** ${new Date().toLocaleDateString('th-TH')} (${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })})\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `*✅ บันทึกรูปหลักฐาน (Discord CDN) และปิดเคสลงระบบสารสนเทศเรียบร้อยแล้ว*`,
          color: 0x2ECC71,
          image: { url: `attachment://${filename}` },
          timestamp: new Date().toISOString()
        }]
      }));

      const postRes = await fetch(`https://discord.com/api/v10/channels/${chTarget.id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${token}` },
        body: formData
      });
      const msgData = await postRes.json();
      if (msgData.attachments && msgData.attachments[0]) {
        return msgData.attachments[0].url;
      }
    }
  } catch (err) {
    console.warn('[ANNOUNCE HANDOVER DISCORD WARN]:', err.message);
  }
  return null;
}

// 6.6 ส่งมอบของ + ถ่ายรูปเก็บหลักฐานบน Discord + ปิดสถานะ (Handover & Delivery)
app.post(['/api/lost-found/items/:id/handover', '/api/lost-items/:id/deliver'], async (req, res) => {
  try {
    const itemId = req.params.id;
    const {
      claimant_name,
      claimant_contact,
      delivered_by,
      delivered_by_duty_id,
      delivered_by_photo_url,
      handover_image_base64,
      handover_photo_base64,
      handover_photo_url,
      claim_id,
      notes
    } = req.body || {};

    const rawPhotoBase64 = handover_image_base64 || handover_photo_base64;
    let finalHandoverPhoto = handover_photo_url || null;

    // หาข้อมูลสิ่งของเดิมเพื่อเอาชื่อและรหัส
    const db = getLostFoundData();
    const existingItem = (db.items || []).find(i => i.id === itemId || i.item_code === itemId) || {};
    const itemCode = existingItem.item_code || itemId;
    const itemTitle = existingItem.title || 'สิ่งของ';

    // 1. บันทึกรูปภาพลง Local File สำรอง
    if (rawPhotoBase64) {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filename = `handover_${itemCode.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.jpg`;
      const buf = Buffer.from(rawPhotoBase64.split(',').pop(), 'base64');
      fs.writeFileSync(path.join(uploadDir, filename), buf);
      finalHandoverPhoto = `/uploads/${filename}`;

      // 2. อัปโหลดรูปภาพไปยัง Discord เพื่อให้ Discord เป็น Host รูปหลักถาวร และประกาศลงห้อง
      try {
        const discordCdnUrl = await announceHandoverToDiscord({
          item_code: itemCode,
          title: itemTitle,
          claimant_name,
          claimant_contact,
          delivered_by,
          delivered_by_duty_id,
          handover_photo_base64: rawPhotoBase64
        });
        if (discordCdnUrl) {
          finalHandoverPhoto = discordCdnUrl; // ใช้ URL จาก Discord ตามที่ผู้ใช้ระบุ!
        }
      } catch (discErr) {
        console.warn('[DISCORD HANDOVER SYNC WARN]:', discErr.message);
      }
    }

    const updates = {
      status: 'DELIVERED',
      claimant_name: claimant_name || 'ผู้รับมอบสิทธิ์',
      claimant_contact: claimant_contact || '-',
      delivered_by: delivered_by || 'สารวัตรนักเรียนเวร',
      delivered_by_duty_id: delivered_by_duty_id || '-',
      delivered_by_photo_url: delivered_by_photo_url || null,
      handover_photo_url: finalHandoverPhoto,
      delivered_at: new Date().toISOString(),
      handover_notes: notes || '',
      updated_at: new Date().toISOString()
    };

    let isDbUpdated = false;
    try {
      const { data, error } = await supabase
        .from('lost_items')
        .update(updates)
        .or(`id.eq.${itemId},item_code.eq.${itemId}`)
        .select()
        .single();
      if (!error && data) isDbUpdated = true;

      if (claim_id) {
        await supabase
          .from('lost_claims')
          .update({ status: 'RESOLVED', resolved_at: new Date().toISOString() })
          .or(`id.eq.${claim_id},claim_code.eq.${claim_id}`);
      }
    } catch (e) {}

    // อัปเดตสำเนาใน Local JSON
    const item = (db.items || []).find(i => i.id === itemId || i.item_code === itemId);
    if (item) {
      Object.assign(item, updates);
    }
    if (claim_id) {
      const claim = (db.claims || []).find(c => c.id === claim_id || c.claim_code === claim_id);
      if (claim) {
        claim.status = 'RESOLVED';
        claim.resolved_at = new Date().toISOString();
      }
    }
    saveLostFoundData(db);

    res.json({
      success: true,
      storage: isDbUpdated ? 'supabase_database' : 'local_mirror_file',
      discord_hosted: finalHandoverPhoto && finalHandoverPhoto.includes('discordapp'),
      message: `ส่งมอบสิ่งของสำเร็จ บันทึกรูปหลักฐานและส่งประกาศไปยัง Discord เรียบร้อยแล้ว`,
      item: item || updates
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.7 ล้างข้อมูลสิ่งของและคำร้องของหายทั้งหมด (KillFile - Reset to 0)
app.post(['/api/lost-found/killfile', '/api/lost-found/reset'], async (req, res) => {
  try {
    let deletedItemsCount = 0;
    let deletedClaimsCount = 0;

    // 1. ลบจาก Supabase Database
    try {
      const { data: itData, error: itErr } = await supabase.from('lost_items').delete().gte('created_at', '1970-01-01').select('id');
      if (!itErr && itData) deletedItemsCount = itData.length;
    } catch (e) {}

    try {
      const { data: clData, error: clErr } = await supabase.from('lost_claims').delete().gte('created_at', '1970-01-01').select('id');
      if (!clErr && clData) deletedClaimsCount = clData.length;
    } catch (e) {}

    // 2. ล้างข้อมูลใน Local Cache
    const db = getLostFoundData();
    const localItemsLen = (db.items || []).length;
    const localClaimsLen = (db.claims || []).length;
    db.items = [];
    db.claims = [];
    saveLostFoundData(db);

    deletedItemsCount = Math.max(deletedItemsCount, localItemsLen);
    deletedClaimsCount = Math.max(deletedClaimsCount, localClaimsLen);

    // 3. ลบไฟล์ภาพอัปโหลดสำรองใน public/uploads ถ้ามี
    try {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (fs.existsSync(uploadDir)) {
        const files = fs.readdirSync(uploadDir);
        for (const file of files) {
          if (file.startsWith('handover_') || file.startsWith('lost_item_')) {
            try { fs.unlinkSync(path.join(uploadDir, file)); } catch (e) {}
          }
        }
      }
    } catch (e) {}

    console.log(`[KILLFILE] 🗑️ ล้างข้อมูลระบบของหายสำเร็จ: สิ่งของ ${deletedItemsCount} ชิ้น, คำร้อง ${deletedClaimsCount} รายการ`);

    res.json({
      success: true,
      deleted_items: deletedItemsCount,
      deleted_claims: deletedClaimsCount,
      message: `ล้างข้อมูลระบบของหายทั้งหมดเรียบร้อยแล้ว (เริ่มใหม่แต่ 0)`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================
// 6.8 ระบบจัดการและบันทึกผลการสแกนใบเช็คชื่อ A4 ดิจิทัล
// =============================================================
const ATTENDANCE_DB_FILE = path.join(__dirname, '..', 'data', 'attendance_db.json');
const ATTENDANCE_LOCAL_DB = path.join(__dirname, 'attendance_db.json');

function getAttendanceData() {
  let db = { sessions: [], records: [] };
  const candidates = [ATTENDANCE_DB_FILE, ATTENDANCE_LOCAL_DB];
  for (const f of candidates) {
    try {
      if (fs.existsSync(f)) {
        const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) db.sessions = parsed.sessions;
          if (Array.isArray(parsed.records) && parsed.records.length > 0) db.records = parsed.records;
        }
      }
    } catch (e) {}
  }
  return db;
}

function saveAttendanceData(db) {
  try {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(ATTENDANCE_DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    try {
      fs.writeFileSync(ATTENDANCE_LOCAL_DB, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {}
  }
}

// ฟังก์ชันส่งประกาศแจ้งเตือนสรุปยอดเข้าเวรไปยัง Discord
async function notifyAttendanceToDiscord(sessionData, summary, records) {
  try {
    const token = process.env.DISCORD_TOKEN;
    const guildId = process.env.GUILD_ID;
    const chId = process.env.ATTENDANCE_CHANNEL_ID || process.env.INCIDENT_CHANNEL_ID;
    if (!token || !guildId || !chId) return false;

    const shiftNames = { M: 'วันจันทร์', T: 'วันอังคาร', W: 'วันพุธ', Ts: 'วันพฤหัสบดี', F: 'วันศุกร์', S: 'เวรพิเศษทุกวัน' };
    const shiftThai = shiftNames[sessionData.shift_code] || sessionData.shift_code;
    const webUrl = process.env.WEB_URL || 'https://sarawat-pranarai-web.onrender.com';

    // จัดหมวดหมู่รายชื่อสารวัตรที่ตรวจเช็ค
    let memberRosterText = '';
    if (Array.isArray(records) && records.length > 0) {
      memberRosterText = records.map(r => {
        let icon = '✅';
        let st = 'มาปฏิบัติหน้าที่';
        if (r.status === 'LATE') {
          icon = '⏰';
          st = 'มาสาย';
        } else if (r.status === 'LEAVE') {
          icon = '📝';
          st = 'ขอลาเวร';
        } else if (r.status === 'ABSENT') {
          icon = '❌';
          st = 'ขาดเวร';
        }
        const nick = r.nickname ? ` (${r.nickname})` : '';
        const room = r.class_room ? ` • ${r.class_room}` : '';
        return `${icon} \`[${r.duty_id || 'ID'}]\` **${r.name || r.duty_id}**${nick}${room} ➔ **${st}**`;
      }).join('\n');
    }

    const embed = {
      title: `⚡ บันทึกการปฏิบัติหน้าที่ประจำวัน // สารวัตรนักเรียน`,
      description: `**ผลัดปฏิบัติการ:** เวร${shiftThai} [Shift ${sessionData.shift_code}]\n` +
                   `**ประจำวันที่:** ${sessionData.duty_date} (สัปดาห์ที่ ${sessionData.week_index || 1})\n` +
                   `**ระบบตรวจสอบ:** Hybrid QR + Gemini Vision AI (ความแม่นยำ 99%+)\n` +
                   `**ผู้รายงาน/หัวหน้าเวร:** ${sessionData.scanned_by || 'หัวหน้าเวร'}\n\n` +
                   `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                   `**📊 สรุปยอดความพร้อมและกำลังพล:**\n` +
                   `• ✅ มาปฏิบัติหน้าที่: **${summary.present}** นาย\n` +
                   `• ⏰ มาสาย: **${summary.late}** นาย\n` +
                   `• 📝 ขอลาเวร: **${summary.leave}** นาย\n` +
                   `• ❌ ขาดเวร: **${summary.absent}** นาย\n` +
                   `• 🎯 อัตราความพร้อม: **${summary.attendance_rate}%**\n` +
                   `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                   (memberRosterText ? `**📋 รายชื่อสารวัตรที่ตรวจเช็ค:**\n${memberRosterText}\n\n` : '') +
                   `🔗 ตรวจสอบข้อมูลแบบสด: [คลิกเปิดระบบศูนย์บัญชาการ](${webUrl})`,
      color: summary.attendance_rate >= 80 ? 0x22c55e : (summary.attendance_rate >= 50 ? 0xf59e0b : 0xef4444),
      footer: { text: `SARAWAT PRANARAI OS • PAPER-TO-DIGITAL VISION INGESTION` },
      timestamp: new Date().toISOString()
    };

    if (sessionData.raw_image_url && sessionData.raw_image_url.startsWith('http')) {
      embed.image = { url: sessionData.raw_image_url };
    }

    // ปุ่มกด ActionRow แบบ Interactive Link Buttons ใน Discord
    const buttonList = [
      {
        type: 2, // Button
        style: 5, // Link
        label: '📱 เปิดแอพสแกนเช็คชื่อ',
        url: `${webUrl}/attendance-scan?shift=${sessionData.shift_code || 'M'}`
      },
      {
        type: 2, // Button
        style: 5, // Link
        label: '📄 ดูแบบฟอร์ม A4',
        url: `${webUrl}/attendance-sheet?shift=${sessionData.shift_code || 'M'}`
      },
      {
        type: 2, // Button
        style: 5, // Link
        label: '🌐 ศูนย์บัญชาการ',
        url: webUrl
      }
    ];

    if (sessionData.raw_image_url && sessionData.raw_image_url.startsWith('http')) {
      buttonList.unshift({
        type: 2,
        style: 5,
        label: '🖼️ ดูภาพถ่ายสแกน',
        url: sessionData.raw_image_url
      });
    }

    const components = [
      {
        type: 1, // ActionRow
        components: buttonList
      }
    ];

    await fetch(`https://discord.com/api/v10/channels/${chId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ embeds: [embed], components })
    });
    return true;
  } catch (err) {
    console.warn('[ATTENDANCE-DISCORD-NOTIFY] ⚠️ ส่งแจ้งเตือน Discord ไม่สำเร็จ:', err.message);
    return false;
  }
}

// -------------------------------------------------------------
// 6.8.0 ฐานข้อมูลสำรอง & API วิเคราะห์ภาพสแกนด้วย Gemini Vision
// -------------------------------------------------------------
const ATTENDANCE_FALLBACK_ROSTERS = {
  M: [
    { duty_id: "MS1", first_name: "มัลลิกา", last_name: "เลื่อนลอย", nickname: "ไอซ์", grade_class: "5/7", student_no: 14 },
    { duty_id: "MS2", first_name: "ศรัณยพงศ์", last_name: "วงศ์สุวรรณ", nickname: "นาย", grade_class: "5/7", student_no: 33 },
    { duty_id: "MS3", first_name: "พรนัชชา", last_name: "ประสมพงค์", nickname: "น้ำชา", grade_class: "5/5", student_no: 3 },
    { duty_id: "MS4", first_name: "พิมพิพัฒณ์", last_name: "รักษาทางดี", nickname: "พิมมี่", grade_class: "5/7", student_no: 27 },
    { duty_id: "M1", first_name: "ณิชกานต์", last_name: "คำไชย", nickname: "นำเหนือ", grade_class: "5/7", student_no: 36 },
    { duty_id: "M2", first_name: "กิตติคุณ", last_name: "สุขสม", nickname: "อาร์ม", grade_class: "5/2", student_no: 12 }
  ],
  T: [
    { duty_id: "TS1", first_name: "ณิชกานต์", last_name: "คำไชย", nickname: "น้ำเหนือ", grade_class: "5/7", student_no: 36 },
    { duty_id: "TS2", first_name: "คณิศร", last_name: "ตะพานแก้ว", nickname: "คิว", grade_class: "5/8", student_no: 5 },
    { duty_id: "TS3", first_name: "พงศ์ภัค", last_name: "ทองคำใส", nickname: "แบงก์", grade_class: "5/7", student_no: 38 },
    { duty_id: "TS4", first_name: "นนท์ธวัตร", last_name: "แย้มอำพล", nickname: "กานต์", grade_class: "5/7", student_no: 32 },
    { duty_id: "TS5", first_name: "ปัณณวัฒน์", last_name: "ปานฮวด", nickname: "ปัน", grade_class: "5/7", student_no: 22 }
  ],
  W: [
    { duty_id: "W1", first_name: "ธีรภัทร", last_name: "พรหมดิสาร", nickname: "บีม", grade_class: "4/7", student_no: 19 },
    { duty_id: "W2", first_name: "ก้องภพ", last_name: "ทองใบ", nickname: "อาร์ม", grade_class: "5/3", student_no: 15 },
    { duty_id: "W3", first_name: "ธราเทพ", last_name: "พงษ์สวัสดิ์", nickname: "ปัน", grade_class: "3/4", student_no: 20 }
  ],
  Ts: [
    { duty_id: "Ts1", first_name: "ณิชกานต์", last_name: "คำไชย", nickname: "นำเหนือ", grade_class: "5/7", student_no: 36 },
    { duty_id: "Ts2", first_name: "ปรเมศวร์", last_name: "ดวงดี", nickname: "โบ๊ท", grade_class: "5/6", student_no: 8 },
    { duty_id: "Ts3", first_name: "อภิวัฒน์", last_name: "มีทรัพย์", nickname: "ไอซ์", grade_class: "3/6", student_no: 14 }
  ],
  F: [
    { duty_id: "FS1", first_name: "ภัทรพล", last_name: "บุญวิเศษ", nickname: "ภีมะ", grade_class: "5/7", student_no: 4 },
    { duty_id: "F1", first_name: "กฤษฎา", last_name: "พรหมมา", nickname: "แบงค์", grade_class: "6/4", student_no: 10 },
    { duty_id: "F2", first_name: "ชาญชัย", last_name: "มิ่งขวัญ", nickname: "กาย", grade_class: "5/2", student_no: 16 }
  ],
  S: [
    { duty_id: "FS1", first_name: "ภัทรพล", last_name: "บุญวิเศษ", nickname: "ภีมะ", grade_class: "5/7", student_no: 4 },
    { duty_id: "MS1", first_name: "มัลลิกา", last_name: "เลื่อนลอย", nickname: "ไอซ์", grade_class: "5/7", student_no: 14 },
    { duty_id: "MS2", first_name: "ศรัณยพงศ์", last_name: "วงศ์สุวรรณ", nickname: "นาย", grade_class: "5/7", student_no: 33 }
  ]
};

app.post('/api/attendance/scan-vision', async (req, res) => {
  try {
    const { image, shift, target_date, date_col_index } = req.body;
    if (!image) {
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลรูปภาพ (Missing image data)' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY ไม่ได้ถูกตั้งค่าใน Environment' });
    }

    let mimeType = 'image/jpeg';
    let base64Data = image;
    const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      base64Data = match[2];
    }

    // 1. ดึงรายชื่อสารวัตรในเวรนี้
    let roster = [];
    try {
      const { data: dbMembers } = await supabase
        .from('members')
        .select('id, duty_id, first_name, last_name, nickname, grade_class, student_no, duty_day')
        .eq('duty_day', shift || 'M')
        .eq('status', 'ACTIVE')
        .order('student_no', { ascending: true });
      if (dbMembers && dbMembers.length > 0) {
        roster = dbMembers;
      }
    } catch (e) {}

    if (roster.length === 0) {
      roster = ATTENDANCE_FALLBACK_ROSTERS[shift || 'M'] || ATTENDANCE_FALLBACK_ROSTERS['M'];
    }

    // 2. ดึงประวัติการลาจาก Discord Cloud (leave_requests)
    const discordLeavesMap = {};
    try {
      let lQuery = supabase.from('leave_requests').select('*, members(duty_id)');
      if (shift) lQuery = lQuery.eq('duty_day', shift);
      const { data: leaves } = await lQuery;
      (leaves || []).forEach(l => {
        const did = l.members?.duty_id || l.duty_id;
        if (did) discordLeavesMap[did] = l;
      });
    } catch (e) {}

    // 3. สร้าง Prompt ละเอียดและรัดกุมสำหรับ Gemini Vision
    const rosterListStr = roster.map((m, idx) => 
      `${idx + 1}. [${m.duty_id}] ${m.nickname ? m.nickname + ' - ' : ''}${m.first_name || ''} ${m.last_name || ''} (${m.grade_class || ''} เลขที่ ${m.student_no || ''})`
    ).join('\n');

    const prompt = `You are an expert Optical Mark Recognition (OMR) system for an attendance sheet (ใบเช็คชื่อ A4) of student inspectors (กองสารวัตรนักเรียน).
Target Shift: "${shift}"
Target Date Column: "${target_date || 'วันนี้'}" (which is the ${Number(date_col_index) + 1 || 1}st weekly date column, header: "${target_date || ''}").

Expected student roster:
${rosterListStr}

CRITICAL RULES FOR ACCURACY:
1. Identify the exact horizontal column span [xmin, xmax] of the target date column "${target_date}".
   - For example, if target is "${target_date}", find that specific date column header.
   - ALL bounding boxes in your output MUST have their xmin and xmax strictly within this column's horizontal span. DO NOT return marks from adjacent columns.
2. For each student row:
   - Identify the student by Duty ID (MS1, MS2...), Name, or Class/Room (e.g. 5/7 (14)).
   - Inspect the cell strictly at the intersection of this student's row and the target date column.
   - "box_2d": return normalized bounding box [ymin, xmin, ymax, xmax] (0-1000) strictly enclosing the cell of THIS SPECIFIC column for this student.
   - "is_filled": set true if the cell is dark/shaded with ink [●], or false if the cell is mostly white/unfilled [○] with only faint text.

Return JSON strictly matching this schema:
{
  "detected_date_column": "${target_date}",
  "results": [
    {
      "duty_id": "MS1",
      "name": "มัลลิกา เลื่อนลอย",
      "is_filled": true,
      "confidence": 99,
      "box_2d": [ymin, xmin, ymax, xmax]
    }
  ]
}`;

    // 4. เรียกโมเดล Gemini Flash
    const candidateModels = ['gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];
    let geminiData = null;
    let usedModel = candidateModels[0];

    for (const m of candidateModels) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
        const gRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType, data: base64Data } }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: 'application/json'
            }
          })
        });

        const data = await gRes.json();
        if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
          geminiData = data;
          usedModel = m;
          break;
        } else if (data.error) {
          console.warn(`[GEMINI-VISION] Model ${m} error:`, data.error.message);
        }
      } catch (err) {
        console.warn(`[GEMINI-VISION] Model ${m} fetch failed:`, err.message);
      }
    }

    if (!geminiData) {
      throw new Error('ไม่สามารถประมวลผลผ่าน Gemini Vision ได้ในขณะนี้');
    }

    const rawText = geminiData.candidates[0].content.parts[0].text;
    const aiParsed = JSON.parse(rawText || '{}');
    const aiResults = Array.isArray(aiParsed.results) ? aiParsed.results : [];

    res.json({
      success: true,
      model: usedModel,
      shift,
      target_date,
      date_col_index,
      ai_results: aiResults,
      roster: roster.map(m => ({
        duty_id: m.duty_id,
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.duty_id,
        nickname: m.nickname || '',
        class_room: m.grade_class ? `${m.grade_class} (${m.student_no || ''})` : (m.class_room || ''),
        grade_class: m.grade_class || '',
        student_no: m.student_no || ''
      })),
      discord_leaves: discordLeavesMap
    });

  } catch (err) {
    console.error('[API-SCAN-VISION-ERROR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.8.1 บันทึกผลยืนยันการสแกนใบเช็คชื่อ (/api/attendance/confirm)
app.post('/api/attendance/confirm', async (req, res) => {
  try {
    const { shift_code, quarter, week_index, duty_date, scanned_by, image_base64, records } = req.body;
    if (!shift_code || !Array.isArray(records)) {
      return res.status(400).json({ success: false, error: 'ข้อมูลไม่ถูกต้อง กรุณาระบุกะเวรและรายชื่อสารวัตร' });
    }

    let rawImageUrl = null;
    if (image_base64) {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filename = `attendance_${shift_code}_${Date.now()}.jpg`;
      const buf = Buffer.from(image_base64.split(',').pop(), 'base64');
      fs.writeFileSync(path.join(uploadDir, filename), buf);
      rawImageUrl = `/uploads/${filename}`;

      try {
        const storagePath = `attendance/${filename}`;
        const { error: sErr } = await supabase.storage
          .from('sarawat-photos')
          .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });
        if (!sErr) {
          const { data: { publicUrl } } = supabase.storage.from('sarawat-photos').getPublicUrl(storagePath);
          rawImageUrl = publicUrl;
        }
      } catch (e) {}
    }

    // คำนวณสรุปยอด
    let present = 0, late = 0, leave = 0, absent = 0;
    records.forEach(r => {
      if (r.status === 'PRESENT') present++;
      else if (r.status === 'LATE') late++;
      else if (r.status === 'LEAVE') leave++;
      else if (r.status === 'ABSENT') absent++;
    });
    const total = records.length;
    const attendance_rate = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
    const summary = { total, present, late, leave, absent, attendance_rate };

    const sessionData = {
      id: `att-sess-${Date.now()}`,
      shift_code,
      quarter_number: quarter || 1,
      week_index: week_index || 1,
      duty_date: duty_date || new Date().toISOString().slice(0, 10),
      raw_image_url: rawImageUrl,
      scanned_by: scanned_by || 'หัวหน้าเวร',
      total_roster: total,
      present_count: present,
      late_count: late,
      leave_count: leave,
      absent_count: absent,
      attendance_rate,
      created_at: new Date().toISOString()
    };

    // 1. บันทึกลง Supabase Database
    try {
      await supabase.from('attendance_scan_sessions').upsert({
        shift_code: sessionData.shift_code,
        duty_date: sessionData.duty_date,
        quarter_number: sessionData.quarter_number,
        week_column_index: sessionData.week_index,
        raw_image_url: sessionData.raw_image_url,
        total_roster: total,
        present_count: present,
        late_count: late,
        leave_count: leave,
        absent_count: absent,
        attendance_rate,
        scanned_by: sessionData.scanned_by
      }, { onConflict: 'shift_code,duty_date' });

      // Upsert individual records
      const upsertRows = records.map(r => ({
        duty_id: r.duty_id,
        member_name: r.name,
        shift_code,
        duty_date: sessionData.duty_date,
        status: r.status,
        confidence: 0.98,
        was_manually_edited: !!r.was_edited
      }));
      await supabase.from('attendance_records').upsert(upsertRows, { onConflict: 'duty_id,duty_date' });
    } catch (dbErr) {
      console.warn('[ATTENDANCE-DB] Supabase error, using local fallback:', dbErr.message);
    }

    // 2. บันทึกลง Local Cache
    const db = getAttendanceData();
    db.sessions.unshift(sessionData);
    records.forEach(r => {
      db.records.push({
        session_id: sessionData.id,
        duty_id: r.duty_id,
        member_name: r.name,
        shift_code,
        duty_date: sessionData.duty_date,
        status: r.status,
        created_at: new Date().toISOString()
      });
    });
    saveAttendanceData(db);

    // 3. แจ้งเตือนไปยัง Discord
    notifyAttendanceToDiscord(sessionData, summary, records);

    res.json({
      success: true,
      session_id: sessionData.id,
      summary,
      message: 'บันทึกข้อมูลการเข้าเวรสำเร็จเรียบร้อย'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.8.2 ดูประวัติการเข้าเวรล่าสุด (/api/attendance/records)
app.get('/api/attendance/records', async (req, res) => {
  try {
    const { shift, date } = req.query;
    let records = [];
    try {
      let q = supabase.from('attendance_records').select('*').order('duty_date', { ascending: false }).limit(100);
      if (shift) q = q.eq('shift_code', shift);
      if (date) q = q.eq('duty_date', date);
      const { data, error } = await q;
      if (!error && data) records = data;
    } catch (e) {}

    if (records.length === 0) {
      const db = getAttendanceData();
      records = db.records || [];
      if (shift) records = records.filter(r => r.shift_code === shift);
      if (date) records = records.filter(r => r.duty_date === date);
    }

    res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 6.8.3 ศูนย์วิเคราะห์ข้อมูลและสถิติภาพรวม (/api/analytics/overview)
// -------------------------------------------------------------
app.get('/api/analytics/overview', async (req, res) => {
  try {
    const { startDate, endDate, preset = 'all' } = req.query;

    // 1. Fetch Members
    let members = [];
    try {
      const { data: mData, error: mErr } = await supabase
        .from('members')
        .select('*')
        .order('duty_id', { ascending: true });
      if (!mErr && Array.isArray(mData) && mData.length > 0) {
        members = mData;
      }
    } catch (e) {}

    if (members.length === 0) {
      members = Object.entries(ATTENDANCE_FALLBACK_ROSTERS).flatMap(([shift, list]) => 
        list.map((m, idx) => ({
          ...m,
          duty_day: shift,
          is_head: idx === 0,
          is_deputy: idx === 1
        }))
      );
    }

    // 2. Fetch Attendance Records
    let attendance = [];
    try {
      let q = supabase.from('attendance_records').select('*');
      if (startDate) q = q.gte('duty_date', startDate);
      if (endDate) q = q.lte('duty_date', endDate);
      const { data: aData, error: aErr } = await q;
      if (!aErr && Array.isArray(aData)) attendance = aData;
    } catch (e) {}

    const localDb = getAttendanceData();
    if (attendance.length === 0 && localDb.records && localDb.records.length > 0) {
      attendance = localDb.records.filter(r => {
        if (startDate && r.duty_date < startDate) return false;
        if (endDate && r.duty_date > endDate) return false;
        return true;
      });
    }

    // 3. Fetch Leave Requests
    let leaves = [];
    try {
      let lq = supabase.from('leave_requests').select('*, members(duty_id, first_name, last_name, nickname, duty_day, grade_class)');
      if (startDate) lq = lq.gte('leave_date', startDate);
      if (endDate) lq = lq.lte('leave_date', endDate);
      const { data: lData, error: lErr } = await lq;
      if (!lErr && Array.isArray(lData)) leaves = lData;
    } catch (e) {}

    // 4. Fetch Cases
    let cases = [];
    try {
      let cq = supabase.from('cases').select('*').order('incident_date', { ascending: false });
      if (startDate) cq = cq.gte('incident_date', startDate);
      if (endDate) cq = cq.lte('incident_date', endDate);
      const { data: cData, error: cErr } = await cq;
      if (!cErr && Array.isArray(cData)) cases = cData;
    } catch (e) {}

    // 5. Fetch Lost & Found Items
    let lostItems = [];
    try {
      let iq = supabase.from('lost_items').select('*').order('created_at', { ascending: false });
      if (startDate) iq = iq.gte('created_at', startDate);
      if (endDate) iq = iq.lte('created_at', endDate + 'T23:59:59.999Z');
      const { data: iData, error: iErr } = await iq;
      if (!iErr && Array.isArray(iData)) lostItems = iData;
    } catch (e) {}

    // 6. Aggregate Member Metrics
    const memberMap = {};
    members.forEach(m => {
      memberMap[m.duty_id] = {
        duty_id: m.duty_id,
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.duty_id,
        nickname: m.nickname || '',
        class_room: m.grade_class || m.room || '',
        duty_day: m.duty_day || 'M',
        is_head: !!m.is_head,
        is_deputy: !!m.is_deputy,
        photo_url: m.photo_url || '',
        present_count: 0,
        late_count: 0,
        leave_count: 0,
        absent_count: 0,
        total_attendance: 0,
        leave_types: {}
      };
    });

    attendance.forEach(rec => {
      if (!memberMap[rec.duty_id]) {
        memberMap[rec.duty_id] = {
          duty_id: rec.duty_id,
          name: rec.name || rec.duty_id,
          nickname: rec.nickname || '',
          class_room: rec.class_room || '',
          duty_day: rec.shift_code || 'M',
          is_head: false,
          is_deputy: false,
          photo_url: '',
          present_count: 0,
          late_count: 0,
          leave_count: 0,
          absent_count: 0,
          total_attendance: 0,
          leave_types: {}
        };
      }
      const st = rec.status;
      memberMap[rec.duty_id].total_attendance++;
      if (st === 'PRESENT') memberMap[rec.duty_id].present_count++;
      else if (st === 'LATE') memberMap[rec.duty_id].late_count++;
      else if (st === 'LEAVE') memberMap[rec.duty_id].leave_count++;
      else if (st === 'ABSENT') memberMap[rec.duty_id].absent_count++;
    });

    leaves.forEach(l => {
      const dutyId = (l.members && l.members.duty_id) ? l.members.duty_id : l.duty_id;
      if (dutyId && memberMap[dutyId]) {
        const lType = l.leave_type || 'ขอลา';
        memberMap[dutyId].leave_types[lType] = (memberMap[dutyId].leave_types[lType] || 0) + 1;
        if (attendance.length === 0) {
          memberMap[dutyId].leave_count++;
          memberMap[dutyId].total_attendance++;
        }
      }
    });

    let totalAttendance = attendance.length;
    let totalPresent = attendance.filter(r => r.status === 'PRESENT').length;
    let totalLate = attendance.filter(r => r.status === 'LATE').length;
    let totalLeave = attendance.filter(r => r.status === 'LEAVE').length || leaves.length;
    let totalAbsent = attendance.filter(r => r.status === 'ABSENT').length;

    if (totalAttendance === 0) {
      Object.values(memberMap).forEach(m => {
        totalPresent += m.present_count;
        totalLate += m.late_count;
        totalLeave += m.leave_count;
        totalAbsent += m.absent_count;
      });
      totalAttendance = totalPresent + totalLate + totalLeave + totalAbsent;
    }

    const readinessRate = totalAttendance > 0 
      ? Math.round(((totalPresent + totalLeave) / totalAttendance) * 100) 
      : 100;

    const shiftStats = {
      M: { present: 0, late: 0, leave: 0, absent: 0 },
      T: { present: 0, late: 0, leave: 0, absent: 0 },
      W: { present: 0, late: 0, leave: 0, absent: 0 },
      Ts: { present: 0, late: 0, leave: 0, absent: 0 },
      F: { present: 0, late: 0, leave: 0, absent: 0 }
    };
    attendance.forEach(r => {
      const sh = r.shift_code || (memberMap[r.duty_id] ? memberMap[r.duty_id].duty_day : 'M');
      if (shiftStats[sh]) {
        if (r.status === 'PRESENT') shiftStats[sh].present++;
        else if (r.status === 'LATE') shiftStats[sh].late++;
        else if (r.status === 'LEAVE') shiftStats[sh].leave++;
        else if (r.status === 'ABSENT') shiftStats[sh].absent++;
      }
    });

    const leaveTypes = { 'ลาป่วย': 0, 'ลากิจ': 0, 'ลากิจกรรม': 0, 'อื่นๆ': 0 };
    leaves.forEach(l => {
      const t = l.leave_type || '';
      if (t.includes('ป่วย')) leaveTypes['ลาป่วย']++;
      else if (t.includes('กิจ') && !t.includes('กรรม')) leaveTypes['ลากิจ']++;
      else if (t.includes('กรรม')) leaveTypes['ลากิจกรรม']++;
      else leaveTypes['อื่นๆ']++;
    });

    const leaderboard = Object.values(memberMap)
      .map(m => {
        const topType = Object.entries(m.leave_types).sort((a,b) => b[1]-a[1])[0];
        return {
          ...m,
          total_penalties: m.leave_count + m.late_count + m.absent_count,
          frequent_leave_type: topType ? topType[0] : (m.leave_count > 0 ? 'ลากิจ/ป่วย' : '-')
        };
      })
      .sort((a, b) => {
        if (b.leave_count !== a.leave_count) return b.leave_count - a.leave_count;
        if (b.absent_count !== a.absent_count) return b.absent_count - a.absent_count;
        return b.late_count - a.late_count;
      });

    const SHIFT_TITLES = {
      M: { name: 'เวรวันจันทร์', color: 'amber', dutyDesc: 'ควบคุมแถวเข้าแถวเคารพธงชาติ & จุดประตู 1' },
      T: { name: 'เวรวันอังคาร', color: 'pink', dutyDesc: 'ตรวจเครื่องแต่งกายและทรงผม & โรงอาหาร' },
      W: { name: 'เวรวันพุธ', color: 'emerald', dutyDesc: 'ตรวจบัตรนักเรียน & ดูแลความเรียบร้อยรอบอาคาร' },
      Ts: { name: 'เวรวันพฤหัสบดี', color: 'orange', dutyDesc: 'สายตรวจอาคารเรียน & เฝ้าระวังจุดอับ' },
      F: { name: 'เวรวันศุกร์', color: 'cyan', dutyDesc: 'ตรวจสัมภาระ & ดูแลความเรียบร้อยช่วงเลิกเรียน' }
    };

    const organization = ['M', 'T', 'W', 'Ts', 'F'].map(shiftKey => {
      const shiftMembers = members.filter(m => m.duty_day === shiftKey);
      const head = shiftMembers.find(m => m.is_head) || shiftMembers[0] || null;
      const deputy = shiftMembers.find(m => m.is_deputy && m !== head) || shiftMembers[1] || null;
      const officers = shiftMembers.filter(m => m !== head && m !== deputy);

      return {
        shift_code: shiftKey,
        shift_name: SHIFT_TITLES[shiftKey]?.name || `เวรผลัด ${shiftKey}`,
        duty_desc: SHIFT_TITLES[shiftKey]?.dutyDesc || 'ปฏิบัติหน้าที่สารวัตรนักเรียน',
        color: SHIFT_TITLES[shiftKey]?.color || 'amber',
        total_members: shiftMembers.length,
        head: head ? {
          duty_id: head.duty_id,
          name: `${head.first_name || ''} ${head.last_name || ''}`.trim(),
          nickname: head.nickname || '',
          class_room: head.grade_class || head.room || '',
          role: 'หัวหน้าผลัดเวร 👑',
          photo_url: head.photo_url || ''
        } : null,
        deputy: deputy ? {
          duty_id: deputy.duty_id,
          name: `${deputy.first_name || ''} ${deputy.last_name || ''}`.trim(),
          nickname: deputy.nickname || '',
          class_room: deputy.grade_class || deputy.room || '',
          role: 'รองหัวหน้าผลัดเวร 🥈',
          photo_url: deputy.photo_url || ''
        } : null,
        officers: officers.map(o => ({
          duty_id: o.duty_id,
          name: `${o.first_name || ''} ${o.last_name || ''}`.trim(),
          nickname: o.nickname || '',
          class_room: o.grade_class || o.room || '',
          role: 'สารวัตรประจำจุด',
          photo_url: o.photo_url || ''
        }))
      };
    });

    res.json({
      success: true,
      query: { startDate: startDate || null, endDate: endDate || null, preset },
      data: {
        summary: {
          totalAttendance,
          totalPresent,
          totalLate,
          totalLeave,
          totalAbsent,
          readinessRate,
          totalMembers: members.length
        },
        shiftStats,
        leaveTypes,
        leaderboard,
        cases: {
          total: cases.length,
          pending: cases.filter(c => c.status === 'PENDING').length,
          investigating: cases.filter(c => c.status === 'INVESTIGATING').length,
          resolved: cases.filter(c => c.status === 'RESOLVED').length,
          recent: cases.slice(0, 5)
        },
        lostFound: {
          total: lostItems.length,
          waiting: lostItems.filter(i => i.status === 'WAITING_OWNER').length,
          claimed: lostItems.filter(i => i.status === 'CLAIMED').length,
          recent: lostItems.slice(0, 5)
        },
        organization
      }
    });
  } catch (err) {
    console.error('Analytics API error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 6.8.4 หน้าเว็บศูนย์สถิติและคลังข้อมูลรวม (/analytics)
// -------------------------------------------------------------
app.get(['/analytics', '/analytics.html', '/stats-overview', '/records'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

// -------------------------------------------------------------
// 7. หน้าเว็บระบบของหาย (/lost-found)
// -------------------------------------------------------------
app.get(['/lost-found', '/lost-found.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lost-found.html'));
});

// -------------------------------------------------------------
// 7.1 หน้าเว็บอัปโหลด Bodycam และหลักฐาน (/bodycam-upload)
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

// -------------------------------------------------------------
// 7.2 สตูดิโอออกแบบเทมเพลตบัตรสารวัตร (/card-studio, /card)
// -------------------------------------------------------------
app.get(['/card-studio', '/card-studio.html', '/card', '/card.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'card-studio.html'));
});

// -------------------------------------------------------------
// 7.2.1 หน้าเว็บบอร์ดบัญชาการเดิม (/dashboard, /app, /console)
// -------------------------------------------------------------
app.get(['/dashboard', '/dashboard.html', '/app', '/console'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// -------------------------------------------------------------
// 7.2.2 หน้าพิมพ์ใบเช็คชื่อ A4 และระบบสแกนเช็คชื่อ Multi-Shot
// -------------------------------------------------------------
app.get(['/attendance-sheet', '/attendance-sheet.html', '/print-attendance'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'attendance-sheet.html'));
});

app.get(['/attendance-scan', '/attendance-scan.html', '/scan-attendance'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'attendance-scan.html'));
});

// -------------------------------------------------------------
// 7.3 หน้าเว็บ Modern SaaS Landing Page (/landing)
// -------------------------------------------------------------
app.get(['/landing', '/landing.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// หน้าหลักสำรอง
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[SARAWAT-WEB] 🌐 Dashboard Online on http://localhost:${PORT}`);
});
