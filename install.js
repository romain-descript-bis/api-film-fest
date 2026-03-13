#!/usr/bin/env node
/**
 * Downloads yt-dlp and ffmpeg binaries for the current platform.
 * Uses only Node.js built-ins — no npm dependencies required.
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import zlib from 'zlib';

const BIN_DIR = path.join(process.cwd(), 'bin');
fs.mkdirSync(BIN_DIR, { recursive: true });

const platform = process.platform; // 'linux', 'darwin', 'win32'
const arch = process.arch;         // 'x64', 'arm64', etc.

// ─── Platform config ────────────────────────────────────────────────────────

function getYtdlpConfig() {
  if (platform === 'win32') {
    return {
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
      filename: 'yt-dlp.exe',
    };
  }
  if (platform === 'darwin') {
    return {
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
      filename: 'yt-dlp',
    };
  }
  // linux
  return {
    url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
    filename: 'yt-dlp',
  };
}

function getDenoConfig() {
  if (platform === 'win32') {
    return {
      url: 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip',
      filename: 'deno.exe',
      innerPath: 'deno.exe',
      format: 'zip',
    };
  }
  if (platform === 'darwin') {
    const triple = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    return {
      url: `https://github.com/denoland/deno/releases/latest/download/deno-${triple}.zip`,
      filename: 'deno',
      innerPath: 'deno',
      format: 'zip',
    };
  }
  // linux
  return {
    url: 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip',
    filename: 'deno',
    innerPath: 'deno',
    format: 'zip',
  };
}

function getFfmpegConfig() {
  if (platform === 'darwin') {
    // Static build from evermeet.cx
    const archSuffix = arch === 'arm64' ? 'arm64' : 'x64';
    return {
      url: `https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip`,
      filename: 'ffmpeg',
      format: 'zip',
    };
  }
  if (platform === 'win32') {
    return {
      url: 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip',
      filename: 'ffmpeg.exe',
      format: 'zip',
      extractPath: 'ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe',
    };
  }
  // linux
  return {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz',
    filename: 'ffmpeg',
    format: 'tar.xz',
    extractPath: 'ffmpeg-master-latest-linux64-gpl/bin/ffmpeg',
  };
}

// ─── Download helpers ────────────────────────────────────────────────────────

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`  Downloading: ${url}`);
    const file = createWriteStream(destPath);
    const get = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

async function extractZip(zipPath, destBin, innerPath) {
  // Use system unzip (available on macOS and most Linux)
  const tmpDir = path.join(BIN_DIR, '_tmp_extract');
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'inherit' });
    const src = innerPath ? path.join(tmpDir, innerPath) : findBinary(tmpDir, path.basename(destBin));
    fs.copyFileSync(src, destBin);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.unlinkSync(zipPath);
  }
}

async function extractTarXz(tarPath, destBin, innerPath) {
  const tmpDir = path.join(BIN_DIR, '_tmp_extract');
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    execSync(`tar -xJf "${tarPath}" -C "${tmpDir}"`, { stdio: 'inherit' });
    const src = innerPath ? path.join(tmpDir, innerPath) : findBinary(tmpDir, path.basename(destBin));
    fs.copyFileSync(src, destBin);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.unlinkSync(tarPath);
  }
}

function findBinary(dir, name) {
  // Recursively find a file named `name` under `dir`
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      try { return findBinary(full, name); } catch {}
    } else if (e.name === name) {
      return full;
    }
  }
  throw new Error(`Binary ${name} not found under ${dir}`);
}

// ─── Install yt-dlp ──────────────────────────────────────────────────────────

async function installYtdlp() {
  const cfg = getYtdlpConfig();
  const dest = path.join(BIN_DIR, cfg.filename);

  if (fs.existsSync(dest)) {
    console.log('✓ yt-dlp already installed, skipping.');
    return;
  }

  console.log('\n📥 Installing yt-dlp...');
  await download(cfg.url, dest);

  if (platform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }

  const version = execSync(`"${dest}" --version`, { encoding: 'utf8' }).trim();
  console.log(`✓ yt-dlp ${version} installed at ${dest}`);
}

// ─── Install Deno ────────────────────────────────────────────────────────────

async function installDeno() {
  const cfg = getDenoConfig();
  const dest = path.join(BIN_DIR, cfg.filename);

  if (fs.existsSync(dest)) {
    console.log('✓ deno already installed, skipping.');
    return;
  }

  console.log('\n📥 Installing deno (required by yt-dlp)...');
  const tmpZip = path.join(BIN_DIR, 'deno.zip');
  await download(cfg.url, tmpZip);
  await extractZip(tmpZip, dest, cfg.innerPath);

  if (platform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }

  const version = execSync(`"${dest}" --version`, { encoding: 'utf8' }).split('\n')[0];
  console.log(`✓ ${version}`);
  console.log(`  installed at ${dest}`);
}

// ─── Install ffmpeg ──────────────────────────────────────────────────────────

async function installFfmpeg() {
  const cfg = getFfmpegConfig();
  const dest = path.join(BIN_DIR, cfg.filename);

  if (fs.existsSync(dest)) {
    console.log('✓ ffmpeg already installed, skipping.');
    return;
  }

  console.log('\n📥 Installing ffmpeg...');

  if (!cfg.format) {
    // Direct binary download
    await download(cfg.url, dest);
  } else if (cfg.format === 'zip') {
    const tmpZip = path.join(BIN_DIR, 'ffmpeg.zip');
    await download(cfg.url, tmpZip);
    await extractZip(tmpZip, dest, cfg.extractPath);
  } else if (cfg.format === 'tar.xz') {
    const tmpTar = path.join(BIN_DIR, 'ffmpeg.tar.xz');
    await download(cfg.url, tmpTar);
    await extractTarXz(tmpTar, dest, cfg.extractPath);
  }

  if (platform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }

  const version = execSync(`"${dest}" -version 2>&1`, { encoding: 'utf8' }).split('\n')[0];
  console.log(`✓ ${version}`);
  console.log(`  installed at ${dest}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

try {
  await installDeno();
  await installYtdlp();
  await installFfmpeg();
  console.log('\n✅ All binaries ready. Run: npm run dev\n');
} catch (err) {
  console.error('\n❌ Installation failed:', err.message);
  process.exit(1);
}
