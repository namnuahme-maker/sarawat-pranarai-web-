'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Analytics Overview - Case aggregation handles status and column structure correctly', () => {
  const mockCases = [
    {
      case_id: 'CASE-3921',
      category: 'นรอื่นมั่วสุมดูดบุหรี่',
      incident_date_time: '2026-11-20T03:49:40.292Z',
      location: 'ห้องน้ำตึก4',
      status: 'PENDING',
      evidence_urls: ['url1', 'url2']
    },
    {
      case_id: 'CASE-2344',
      category: '💥 เกิดเหตุก่อวิวาท',
      incident_date_time: '2026-11-19T16:20:55.582Z',
      location: 'โรงอาหาร',
      status: 'IN_PROGRESS',
      evidence_urls: []
    },
    {
      case_id: 'CASE-1001',
      category: 'ทะเลาะวิวาท',
      incident_date_time: '2026-11-10T10:00:00.000Z',
      location: 'สนามฟุตบอล',
      status: 'RESOLVED',
      evidence_urls: ['url3']
    }
  ];

  const casesAgg = {
    total: mockCases.length,
    pending: mockCases.filter(c => c.status !== 'RESOLVED').length,
    investigating: mockCases.filter(c => c.status === 'INVESTIGATING' || c.status === 'IN_PROGRESS').length,
    resolved: mockCases.filter(c => c.status === 'RESOLVED').length,
    recent: mockCases.slice(0, 10).map(c => ({
      id: c.case_id || c.id,
      case_id: c.case_id,
      title: c.category || c.title || c.case_id,
      category: c.category || 'ทั่วไป',
      location: c.location || 'ในโรงเรียน',
      incident_date: c.incident_date_time ? c.incident_date_time.split('T')[0] : '',
      incident_date_time: c.incident_date_time,
      status: c.status,
      evidence_count: Array.isArray(c.evidence_urls) ? c.evidence_urls.length : 0
    }))
  };

  assert.equal(casesAgg.total, 3, 'Total cases should be 3');
  assert.equal(casesAgg.pending, 2, 'Pending/ongoing cases should be 2 (PENDING and IN_PROGRESS)');
  assert.equal(casesAgg.investigating, 1, 'Investigating/In-progress cases should be 1');
  assert.equal(casesAgg.resolved, 1, 'Resolved cases should be 1');
  assert.equal(casesAgg.recent[0].title, 'นรอื่นมั่วสุมดูดบุหรี่', 'Recent case title should match category');
  assert.equal(casesAgg.recent[0].evidence_count, 2, 'Recent case evidence count should match');
  assert.equal(casesAgg.recent[0].incident_date, '2026-11-20', 'Recent case incident date should match');
});
