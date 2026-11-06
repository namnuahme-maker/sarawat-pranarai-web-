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
