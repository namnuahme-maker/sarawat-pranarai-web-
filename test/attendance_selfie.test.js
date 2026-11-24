const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('Attendance Selfie - Dedicated Check-in HTML Page Verification', () => {
  const htmlPath = path.join(__dirname, '..', 'public', 'attendance-checkin.html');
  assert.ok(fs.existsSync(htmlPath), 'attendance-checkin.html must exist');
  
  const content = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(content.includes('capture="user"'), 'Must support mobile native camera capture="user"');
  assert.ok(content.includes('navigator.geolocation'), 'Must fetch GPS Geolocation');
  assert.ok(content.includes('processAndWatermarkPhoto'), 'Must process and stamp watermark onto canvas');
  assert.ok(content.includes('/api/attendance/selfie-submit'), 'Must submit to /api/attendance/selfie-submit');
  assert.ok(content.includes('discord.com/channels/@me'), 'Must redirect back to Discord');
});

test('Attendance Selfie - Web Server Route and Endpoints Verification', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  assert.ok(serverContent.includes('/attendance-checkin'), 'Must serve /attendance-checkin route');
  assert.ok(serverContent.includes('/api/attendance/selfie-info'), 'Must have selfie-info endpoint');
  assert.ok(serverContent.includes('/api/attendance/selfie-submit'), 'Must have selfie-submit endpoint');
  assert.ok(serverContent.includes('/api/attendance/approve'), 'Must have approve endpoint');
  assert.ok(serverContent.includes('📸│คลังหลักฐานเช็คชื่อ'), 'Must archive to Discord evidence channel');
});

test('Attendance Scan Dashboard - 5-Second Center Celebration Popup Modal', () => {
  const scanPath = path.join(__dirname, '..', 'public', 'attendance-scan.html');
  const scanContent = fs.readFileSync(scanPath, 'utf8');

  assert.ok(scanContent.includes('modal-celebrate-success'), 'Must have modal-celebrate-success');
  assert.ok(scanContent.includes('ยืนยันเรียบร้อย'), 'Must display ยืนยันเรียบร้อย');
  assert.ok(scanContent.includes('ส่งข้อมูลเรียบร้อย'), 'Must display ส่งข้อมูลเรียบร้อย');
  assert.ok(scanContent.includes('เก็บหลักฐานเข้าเรียบร้อย'), 'Must display เก็บหลักฐานเข้าเรียบร้อย');
  assert.ok(scanContent.includes('ขอบคุณที่ส่งข้อมูล'), 'Must display ขอบคุณที่ส่งข้อมูล');
  assert.ok(scanContent.includes('showCelebrationPopup'), 'Must have showCelebrationPopup function');
});

test('Discord Bot - Daily Duty Reminder Check-in Button and Leader Approval', () => {
  const botPath = path.join(__dirname, '..', '..', 'bot', 'bot.js');
  const botContent = fs.readFileSync(botPath, 'utf8');

  assert.ok(botContent.includes('attendance-checkin.html?auth='), 'Must generate check-in link in duty reminder');
  assert.ok(botContent.includes('btn_att_approve_'), 'Must handle leader approval button interaction');
  assert.ok(botContent.includes('btn_att_late_'), 'Must handle leader late button interaction');
  assert.ok(botContent.includes('btn_att_reject_'), 'Must handle leader reject button interaction');
});
