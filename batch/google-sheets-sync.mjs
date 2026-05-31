#!/usr/bin/env node

/**
 * Google Sheets Sync — Syncs applications.md to Google Sheet
 *
 * Usage: node batch/google-sheets-sync.mjs
 *
 * Reads data/applications.md and syncs each row to your Google Sheet
 */

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

config(); // Load .env

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1NdiHh5DCVCGB_Y4ncRNfgyBJal5K8qvGvKyuxMzjy8o';
const SHEET_NAME = 'Sheet1';
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

if (!REFRESH_TOKEN) {
  console.error('❌ Error: GOOGLE_REFRESH_TOKEN not found in .env');
  console.error('Run: npm run auth');
  process.exit(1);
}

// Load credentials
let credentials;
try {
  credentials = JSON.parse(readFileSync('credentials.json', 'utf8'));
} catch (err) {
  console.error('❌ Error: credentials.json not found');
  process.exit(1);
}

const { client_id, client_secret, redirect_uris } = credentials.installed;
const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

/**
 * Parse applications.md markdown table
 * Format:
 * | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
 * |---|------|---------|------|-------|--------|-----|--------|-------|
 * | 1 | 2026-05-30 | Fusion IT | Sr. Network Engineer | 4.6/5 | Evaluated | ❌ | [001](../reports/001-sr-network-engineer-2026-05-30.md) | Enterprise network design... |
 */
function parseApplications() {
  try {
    const content = readFileSync('data/applications.md', 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    const rows = [];
    let headerFound = false;

    for (const line of lines) {
      // Skip header and separator lines
      if (line.includes('Date') || line.includes('---') || line.includes('Applications')) {
        headerFound = true;
        continue;
      }

      if (!headerFound || !line.startsWith('|')) continue;

      // Parse table row
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length < 9) continue; // Incomplete row

      const [num, date, company, role, score, status, pdf, report, notes] = cells;

      // Skip header row
      if (num === '#') continue;

      rows.push({
        num: num || '',
        date: date || '',
        company: company || '',
        role: role || '',
        score: score || '',
        status: status || '',
        pdf: pdf || '',
        report: report || '',
        notes: notes || '',
      });
    }

    return rows;
  } catch (err) {
    console.error('❌ Error reading applications.md:', err.message);
    return [];
  }
}

/**
 * Sync rows to Google Sheet
 */
async function syncToSheet(rows) {
  console.log(`📊 Syncing ${rows.length} application(s) to Google Sheet...\n`);

  try {
    // Clear existing data (keep header)
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A2:Z1000`,
    });

    // Prepare data for upload
    const values = rows.map(row => [
      row.num,
      row.date,
      row.company,
      row.role,
      row.score,
      row.status,
      row.pdf,
      row.report,
      row.notes,
    ]);

    if (values.length === 0) {
      console.log('ℹ️  No applications to sync.');
      return;
    }

    // Write data to sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A2`,
      valueInputOption: 'RAW',
      resource: { values },
    });

    console.log(`✅ Synced ${rows.length} row(s) to Google Sheet!`);
    console.log(`🔗 Sheet: https://docs.google.com/spreadsheets/d/${SHEET_ID}\n`);

  } catch (err) {
    console.error('❌ Error syncing to sheet:', err.message);
    if (err.message.includes('Invalid requests')) {
      console.error('💡 Tip: Make sure GOOGLE_SHEET_ID is correct in .env');
    }
    process.exit(1);
  }
}

// Main
async function main() {
  console.log('🔄 career-ops Google Sheets Sync\n');

  const rows = parseApplications();
  if (rows.length === 0) {
    console.log('⚠️  No applications found in data/applications.md');
    process.exit(0);
  }

  await syncToSheet(rows);
}

main();
