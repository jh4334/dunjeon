#!/usr/bin/env node
/* =====================================================================
 * 던전 (DunJeon) — 전체 테스트 러너
 *
 *   npm test                                     (playwright 번들 크로미움)
 *   CHROME_BIN=/path/to/headless_shell npm test  (이미 설치된 크로미움)
 *   node tests/run-all.js test-m6 test-m5        (일부만 — 이름으로 필터)
 *
 * 스위트를 하나씩 자식 프로세스로 돌리고(순차 — 브라우저가 겹치지 않게),
 * 끝나면 요약 표를 찍는다. 하나라도 실패하면 exit 1 로 전파한다.
 * =================================================================== */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { EXEC, OUT } = require('./env.js');

/* 실행 순서 — 기능이 쌓인 순서 그대로 (앞 단계가 깨지면 먼저 보인다) */
const SUITES = [
  'test-phase1', 'test-phase2', 'test-phase3',
  'test-review1', 'test-review2', 'test-review3', 'test-review4',
  'test-delve',
  'test-m1', 'test-m2', 'test-m3', 'test-m35a', 'test-m35b', 'test-m4', 'test-m5', 'test-m6',
  'test-m7a', 'test-m7b', 'test-m7c',
];

const SUITE_TIMEOUT = Number(process.env.SUITE_TIMEOUT_MS || 15 * 60 * 1000);   // 스위트당 15분

const filter = process.argv.slice(2).filter(a => a[0] !== '-');
const suites = filter.length
  ? SUITES.filter(s => filter.some(f => s === f || s === 'test-' + f || s.indexOf(f) >= 0))
  : SUITES.slice();
if (!suites.length) {
  console.error(`실행할 스위트가 없습니다: ${filter.join(', ')}`);
  process.exit(2);
}

/* 스위트 요약 줄 — 스위트마다 문구가 조금씩 다르다
 *   "==== M5 타이틀…: 101/101 PASS ====" / "=== 리뷰 4차: 24/24 통과 ===" / "=== 16/16 통과 ==="
 * 그래서 '=== 로 시작하는 줄' 중 마지막 것에서 N/M 을 읽는다. */
const SUMMARY_RE = /^={3,}.*?(\d+)\s*\/\s*(\d+)/;
function parseCounts(out) {
  let hit = null;
  out.split('\n').forEach(l => {
    const m = l.trim().match(SUMMARY_RE);
    if (m) hit = { pass: Number(m[1]), total: Number(m[2]) };
  });
  return hit;
}

function runSuite(name) {
  return new Promise(resolve => {
    const file = path.join(__dirname, name + '.js');
    const t0 = Date.now();
    console.log(`\n──────── ${name} ────────`);
    const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let out = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, SUITE_TIMEOUT);
    child.stdout.on('data', d => { out += d; process.stdout.write(d); });
    child.stderr.on('data', d => { out += d; process.stderr.write(d); });
    child.on('close', code => {
      clearTimeout(timer);
      const m = parseCounts(out);
      const fails = out.split('\n').filter(l => l.indexOf('FAIL') === 0 || l.indexOf('  FAIL:') === 0);
      resolve({
        name,
        ok: !killed && code === 0,
        code: killed ? 'TIMEOUT' : code,
        pass: m ? m.pass : null,
        total: m ? m.total : null,
        sec: (Date.now() - t0) / 1000,
        fails: fails.slice(0, 5),
      });
    });
  });
}

(async () => {
  console.log('던전 테스트 러너 — 스위트 ' + suites.length + '개');
  console.log('  크로미움 : ' + (EXEC || 'playwright 기본(번들) 브라우저'));
  console.log('  산출물   : ' + OUT);

  const results = [];
  for (const s of suites) results.push(await runSuite(s));

  /* ---- 요약 표 ---- */
  const w = Math.max(...suites.map(s => s.length), 12);
  const line = '─'.repeat(w + 34);
  console.log('\n' + line);
  console.log('  ' + '스위트'.padEnd(w) + '  결과      건수        시간');
  console.log(line);
  results.forEach(r => {
    const cnt = (r.total === null) ? '-' : `${r.pass}/${r.total}`;
    console.log('  ' + r.name.padEnd(w) +
      '  ' + (r.ok ? 'PASS' : 'FAIL').padEnd(8) +
      '  ' + cnt.padEnd(10) +
      '  ' + r.sec.toFixed(1) + 's' +
      (r.ok ? '' : `   (exit ${r.code})`));
  });
  console.log(line);

  const bad = results.filter(r => !r.ok);
  const pass = results.reduce((a, r) => a + (r.pass || 0), 0);
  const total = results.reduce((a, r) => a + (r.total || 0), 0);
  const secs = results.reduce((a, r) => a + r.sec, 0);
  console.log(`  스위트 ${results.length - bad.length}/${results.length} · 검증 ${pass}/${total} · ${secs.toFixed(1)}s`);
  if (bad.length) {
    console.log('\n실패한 스위트:');
    bad.forEach(r => {
      console.log(`  · ${r.name} (exit ${r.code})`);
      r.fails.forEach(f => console.log('      ' + f.trim()));
    });
  }
  process.exit(bad.length ? 1 : 0);
})();
