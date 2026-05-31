#!/usr/bin/env node

/**
 * Google Sheets OAuth 2.0 Authentication
 * One-time setup to get a refresh token
 *
 * Usage: node batch/google-auth.mjs
 *
 * This will:
 * 1. Open your browser for Google login
 * 2. Save the refresh token to .env
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
import { URL } from 'url';

const credentialsPath = 'credentials.json';
const envPath = '.env';

// Load credentials
let credentials;
try {
  credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
} catch (err) {
  console.error('❌ Error: credentials.json not found. Download it from Google Cloud Console.');
  process.exit(1);
}

const { client_id, client_secret, redirect_uris } = credentials.installed;
const redirectUri = redirect_uris[0];

// Create OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirectUri
);

// Generate auth URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/spreadsheets'],
});

console.log('🔐 Starting Google Sheets OAuth 2.0 authentication...\n');
console.log('📱 Opening browser for login...');
console.log(`🔗 If browser doesn't open, visit: ${authUrl}\n`);

// Open browser (optional, user can manually visit URL)
try {
  const { exec } = await import('child_process');
  exec(`open "${authUrl}"`);
} catch {
  // Ignore if 'open' command fails; user can visit URL manually
}

// Start local server to catch redirect
const server = http.createServer(async (req, res) => {
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const code = qs.get('code');

  if (!code) {
    res.end('❌ No authorization code received. Try again.');
    return;
  }

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    // Save refresh token to .env
    const refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      throw new Error('No refresh token received. Make sure you have offline access enabled.');
    }

    // Read existing .env or create new
    let envContent = '';
    try {
      envContent = readFileSync(envPath, 'utf8');
    } catch {
      envContent = '';
    }

    // Add or update GOOGLE_REFRESH_TOKEN
    if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
      envContent = envContent.replace(
        /GOOGLE_REFRESH_TOKEN=.*/,
        `GOOGLE_REFRESH_TOKEN=${refreshToken}`
      );
    } else {
      envContent += `\nGOOGLE_REFRESH_TOKEN=${refreshToken}\n`;
    }

    writeFileSync(envPath, envContent);

    res.end(`
      ✅ Success! Refresh token saved to .env

      You can now close this window and use:
      npm run sync-tracker
    `);

    console.log('✅ Authentication successful!');
    console.log('📝 Refresh token saved to .env');
    console.log('✨ You can now run: npm run sync-tracker\n');

    server.close();
    process.exit(0);
  } catch (err) {
    res.end(`❌ Error: ${err.message}`);
    console.error('❌ Authentication failed:', err.message);
    server.close();
    process.exit(1);
  }
});

server.listen(80, () => {
  console.log('🔄 Waiting for authorization...');
  console.log('💭 Once you allow access, I\'ll automatically capture the token.\n');
});

server.on('error', (err) => {
  if (err.code === 'EACCES') {
    console.error('❌ Port 80 requires admin access. Try: sudo node batch/google-auth.mjs');
  } else {
    console.error('❌ Server error:', err.message);
  }
  process.exit(1);
});
