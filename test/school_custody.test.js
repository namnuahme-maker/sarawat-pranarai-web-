const test = require('node:test');
const assert = require('node:assert/strict');
const {
  custodyCutoffDate,
  custodyOrFilter,
  isSchoolCustodyItem
} = require('../lib/school_custody');

const NOW = new Date('2026-11-19T00:30:00+07:00');

test('cutoff uses the Bangkok calendar, not the UTC date', () => {
  assert.equal(custodyCutoffDate(NOW), '2026-10-20');
  const utcSlice = new Date(NOW);
  utcSlice.setDate(utcSlice.getDate() - 30);
  assert.notEqual(utcSlice.toISOString().slice(0, 10), '2026-10-20');
});

test('delivered items are not reclassified as ของกลาง by age', () => {
  const delivered = {
    status: 'DELIVERED',
    category: 'กระเป๋า',
    found_date: '2026-09-01'
  };
  assert.equal(isSchoolCustodyItem(delivered, NOW), false);
});

test('waiting items at least 30 Bangkok days old are ของกลาง', () => {
  assert.equal(isSchoolCustodyItem({
    status: 'WAITING_OWNER',
    category: 'กระเป๋า',
    found_date: '2026-10-20'
  }, NOW), true);

  assert.equal(isSchoolCustodyItem({
    status: 'WAITING_OWNER',
    category: 'กระเป๋า',
    found_date: '2026-10-21'
  }, NOW), false);
});

test('an explicit ของกลาง category stays in the catalog after handover', () => {
  assert.equal(isSchoolCustodyItem({
    status: 'DELIVERED',
    category: 'ของกลาง',
    found_date: '2026-11-18'
  }, NOW), true);
});

test('catalog filter requires waiting status for the age clause', () => {
  const filter = custodyOrFilter(NOW);
  assert.match(filter, /status\.eq\.WAITING_OWNER/);
  assert.match(filter, /found_date\.lte\.2026-10-20/);
  assert.doesNotMatch(filter, /found_date\.lte\.[0-9-]+$/);
});
