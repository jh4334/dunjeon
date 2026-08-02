/* =====================================================================
 * 던전 (DunJeon) — 테스트 공용 환경
 *
 * 스위트가 하드코딩하던 값(크로미움 경로 / 게임 URL / 산출물 폴더)을 한곳에 모은다.
 *   · EXEC  CHROME_BIN 이 있으면 그 실행 파일, 없으면 undefined
 *           → playwright.chromium.launch({ executablePath: undefined }) = 번들 기본 브라우저
 *           (로컬은 CHROME_BIN=... npm test, CI 는 npx playwright install 로 받은 기본 브라우저)
 *   · SRC   저장소 루트 (이 파일 기준 상대 경로 — 체크아웃 위치와 무관)
 *   · URL   file:// 로 연 index.html + '#notitle' (타이틀 화면을 건너뛰는 디버그 진입)
 *   · OUT   스크린샷/로그 산출물 폴더 (tests/out — .gitignore)
 * =================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const EXEC = process.env.CHROME_BIN || undefined;
const SRC = path.resolve(__dirname, '..');
const BASE = 'file://' + path.resolve(SRC, 'index.html');
const URL = BASE + '#notitle';
const OUT = path.resolve(__dirname, 'out');

try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) { /* 무시 */ }

module.exports = { EXEC, SRC, BASE, URL, OUT };
