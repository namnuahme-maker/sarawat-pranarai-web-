'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Web Card Template - Default template background asset exists permanently', () => {
  const assetPath = path.join(__dirname, '..', 'public', 'assets', 'card-templates', 'default_card_bg.png');
  assert.ok(fs.existsSync(assetPath), 'default_card_bg.png must exist in assets/card-templates');
  const stat = fs.statSync(assetPath);
  assert.ok(stat.size > 1000, 'default_card_bg.png must be a valid image file');
});

test('Web Card Template - Config file points to persistent template asset', () => {
  const configPath = path.join(__dirname, '..', 'card_layout_config.json');
  assert.ok(fs.existsSync(configPath), 'card_layout_config.json must exist');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.ok(config.canvas, 'Canvas config must exist');
  assert.ok(config.canvas.backgroundImage, 'backgroundImage must be defined');
  assert.ok(!config.canvas.backgroundImage.startsWith('data:image'), 'backgroundImage must not be bloated raw base64');
});
