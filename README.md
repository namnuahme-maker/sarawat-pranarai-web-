# 🌐 SARAWAT PRANARAI - CENTRAL COMMAND WEB DASHBOARD

เว็บแดชบอร์ดศูนย์บัญชาการสารวัตรนักเรียน โรงเรียนพระนารายณ์
ประกอบด้วย:
- **ภาพรวมและสถิติกำลังพล (Overview Dashboard):** นาฬิกา Live Chrono HUD เรียลไทม์, ยอดสารวัตรทั้งหมด, ยอดขอลาเวรจากฐานข้อมูล Supabase, และยอดคดี
- **ทำเนียบสารวัตรนักเรียน (Officer Roster List):** ดูรายชื่อแบบกะทัดรัด พร้อมเปิดดูบัตรประจำตัวและข้อมูลติดต่อ Dossier
- **สตูดิโอออกแบบบัตรประจำตัว (Card Studio Fabric.js):** ปรับแต่งตำแหน่ง ขนาด ฟอนต์ สี ลายน้ำ อัปโหลดรูปคน และส่งออกบัตรเป็นไฟล์ภาพความละเอียดสูงเดี่ยว หรือดาวน์โหลด ZIP ทั้งหมดในครั้งเดียว
- **ระบบตรวจสอบบัตรสาธารณะ (Public Verification):** สแกน QR Code ตรวจสอบความถูกต้องของบัตร

---

## 🚀 การติดตั้งและรันในเครื่อง (Local Development)

```bash
# 1. ติดตั้ง Dependencies
npm install

# 2. คัดลอกและตั้งค่า Environment Variables
cp .env.example .env

# 3. รันเว็บเซิร์ฟเวอร์
npm start
```

เข้าใช้งานผ่านเบราว์เซอร์: `http://localhost:10001`

---

## 🌐 การนำขึ้นใช้งานบน Render.com (Deployment Guide)

### รูปแบบ Service: **Web Service**
1. **เชื่อมต่อ GitHub:**
   - สร้าง New Web Service บน Render.com และเลือก Repository ของ Web Dashboard
2. **ตั้งค่า Build & Start Command:**
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
3. **ตั้งค่า Environment Variables ใน Render:**
   - `SUPABASE_URL` = URL ของฐานข้อมูล Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` = Service Role Secret ของ Supabase
   - `PORT` = `10000` (Render จะกำหนด Port เริ่มต้นให้ที่ 10000)
   - `NODE_ENV` = `production`
