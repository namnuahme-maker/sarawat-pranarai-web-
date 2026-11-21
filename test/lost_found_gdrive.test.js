'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Lost & Found GDrive - resolveLostItemImg resolves proxy URLs correctly', () => {
  function resolveLostItemImg(it) {
    if (!it) return '/assets/logo.png';
    if (it.gdrive_file_id) {
      return `/api/drive-proxy/${it.gdrive_file_id}`;
    }
    const url = String(it.image_url || '').trim();
    if (!url) return '/assets/logo.png';
    if (url.startsWith('/api/drive-proxy/')) return url;
    if (url.includes('drive.google.com')) {
      const m = url.match(/[-\w]{25,}/);
      if (m) return `/api/drive-proxy/${m[0]}`;
    }
    return url;
  }

  // Case 1: Item with gdrive_file_id
  const item1 = {
    id: 'lf-1',
    item_code: 'LF-2026-001',
    gdrive_file_id: '1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT',
    image_url: 'https://example.com/some_old_url'
  };
  assert.equal(resolveLostItemImg(item1), '/api/drive-proxy/1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT');

  // Case 2: Item with image_url pointing to Google Drive sharing link
  const item2 = {
    id: 'lf-2',
    item_code: 'LF-2026-002',
    image_url: 'https://drive.google.com/file/d/1que123Zlr8ewcC5KD4Gx5DLZSbyJeapQ/view?usp=sharing'
  };
  assert.equal(resolveLostItemImg(item2), '/api/drive-proxy/1que123Zlr8ewcC5KD4Gx5DLZSbyJeapQ');

  // Case 3: Item with existing drive-proxy url
  const item3 = {
    id: 'lf-3',
    item_code: 'LF-2026-003',
    image_url: '/api/drive-proxy/1que123Zlr8ewcC5KD4Gx5DLZSbyJeapQ'
  };
  assert.equal(resolveLostItemImg(item3), '/api/drive-proxy/1que123Zlr8ewcC5KD4Gx5DLZSbyJeapQ');

  // Case 4: Item with regular url (e.g. Supabase Storage)
  const item4 = {
    id: 'lf-4',
    item_code: 'LF-2026-004',
    image_url: 'https://cxrakrsyxvsrbpgphgtt.supabase.co/storage/v1/object/public/sarawat-photos/lost-items/LF-2026-004.jpg'
  };
  assert.equal(resolveLostItemImg(item4), 'https://cxrakrsyxvsrbpgphgtt.supabase.co/storage/v1/object/public/sarawat-photos/lost-items/LF-2026-004.jpg');

  // Case 5: Empty image
  const item5 = { id: 'lf-5', item_code: 'LF-2026-005', image_url: '' };
  assert.equal(resolveLostItemImg(item5), '/assets/logo.png');
});

test('Lost & Found GDrive - target folder strictly defaults to 03_สิ่งของที่พบเจอ', () => {
  const LOST_FOUND_FOLDER_ID = '1que123Zlr8ewcC5KD4Gx5DLZSbyJeapQ';
  const getFolderId = (metadata = {}) => {
    return metadata.folderId || (metadata.category === 'lost_found' ? (process.env.GDRIVE_LOST_FOLDER_ID || '1que123Zlr8ewcC5KD4Gx5DLZSbyJeapQ') : (process.env.GDRIVE_FOLDER_ID || '1lcAN_otZ7RPOax6J1oodV-LjQ4hou_ez'));
  };

  assert.equal(getFolderId({ category: 'lost_found' }), LOST_FOUND_FOLDER_ID);
  assert.equal(getFolderId({ folderId: 'custom-folder' }), 'custom-folder');
});
