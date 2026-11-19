/**
 * School-custody (ของกลาง) rule.
 * Age alone does not confiscate an item. Only items still waiting for the
 * owner, whose found date is at least 30 Bangkok calendar days ago, escalate.
 * An explicit ของกลาง category stays in that catalog regardless of status.
 */

const BANGKOK = 'Asia/Bangkok';

function bangkokDateString(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function subtractCalendarDays(yyyyMmDd, days) {
  const [year, month, day] = String(yyyyMmDd).split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - days);
  return utc.toISOString().slice(0, 10);
}

function custodyCutoffDate(now = new Date()) {
  return subtractCalendarDays(bangkokDateString(now), 30);
}

function itemFoundDay(item) {
  if (!item) return '';
  if (item.found_date) return String(item.found_date).slice(0, 10);
  if (item.created_at) {
    const created = new Date(item.created_at);
    if (!Number.isNaN(created.getTime())) return bangkokDateString(created);
  }
  return '';
}

function isSchoolCustodyItem(item, now = new Date()) {
  if (!item) return false;
  if (item.category && String(item.category).includes('ของกลาง')) return true;
  if (item.status && item.status !== 'WAITING_OWNER') return false;
  const foundDay = itemFoundDay(item);
  if (!foundDay) return false;
  return foundDay <= custodyCutoffDate(now);
}

function custodyOrFilter(now = new Date()) {
  const cutoff = custodyCutoffDate(now);
  return `category.ilike.%ของกลาง%,and(status.eq.WAITING_OWNER,found_date.lte.${cutoff})`;
}

module.exports = {
  bangkokDateString,
  custodyCutoffDate,
  isSchoolCustodyItem,
  custodyOrFilter
};
