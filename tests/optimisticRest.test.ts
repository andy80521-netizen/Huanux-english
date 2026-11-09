import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runOptimistic, toFields } from '../netlify/shared/firestoreRest';

// 擁有者 2026-11-09 正式版診斷：「開始交易失敗 (HTTP 403) PERMISSION_DENIED」
// 使用者 ID Token 不能呼叫 REST beginTransaction → 改用「讀取 → 以 updateTime 為前置條件寫入」（與 generate-practice-image 相同）
const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status });
const JOB = 'artifacts/a/users/u/transcriptionJobs/m';
const MAT = 'artifacts/a/users/u/materials/m';

describe('runOptimistic', () => {
  it('不呼叫 beginTransaction；讀過的文件以 updateTime 為前置條件、沒讀過的建立用 exists=false，一次 commit', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes(':beginTransaction')) throw new Error('不可呼叫');
      if (url.endsWith(':commit')) return json({ writeResults: [] });
      if (url.includes('/materials/')) return json({ error: { status: 'NOT_FOUND' } }, 404);
      return json({ name: 'x', fields: toFields({ status: 'saving', saveAttempt: 1 }), updateTime: '2026-11-09T00:00:00.123Z' });
    });
    const r = await runOptimistic('tok', async (t) => {
      const j = await t.get(JOB);
      const m = await t.get(MAT);
      if (!m) t.create(MAT, { a: 1 });
      t.update(JOB, { status: 'saved' }, ['leaseId']);
      return j?.status;
    }, { fetchImpl: fetchImpl as any });
    expect(r).toBe('saving');
    const commits = fetchImpl.mock.calls.filter(c => String(c[0]).endsWith(':commit'));
    expect(commits).toHaveLength(1);
    const body = JSON.parse((commits[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty('transaction');
    expect(body.writes[0].currentDocument).toEqual({ exists: false });
    expect(body.writes[1].currentDocument).toEqual({ updateTime: '2026-11-09T00:00:00.123Z' });
    expect(body.writes[1].updateMask.fieldPaths).toEqual(['status', 'leaseId']);
    // 讀取不帶 transaction 參數
    for (const c of fetchImpl.mock.calls) expect(String(c[0])).not.toContain('transaction=');
  });

  it('前置條件失敗（別人先改了）→ 重讀並整筆重跑', async () => {
    let commits = 0;
    let version = 1;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith(':commit')) {
        commits++;
        if (commits === 1) return json({ error: { code: 400, status: 'FAILED_PRECONDITION' } }, 400);
        return json({});
      }
      return json({ fields: toFields({ n: version }), updateTime: `t${version++}` });
    });
    const seen: number[] = [];
    await runOptimistic('tok', async (t) => {
      const d = await t.get(JOB);
      seen.push(d!.n);
      t.update(JOB, { n: d!.n + 1 });
    }, { fetchImpl: fetchImpl as any });
    expect(seen).toEqual([1, 2]);
    expect(commits).toBe(2);
  });

  it('批次寫入被拒（403）且只有一筆 → 改用 PATCH（帶同樣的前置條件）', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith(':commit')) return json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403);
      if (_init?.method === 'PATCH') return json({});
      return json({ fields: toFields({ n: 1 }), updateTime: 't1' });
    });
    await runOptimistic('tok', async (t) => { await t.get(JOB); t.update(JOB, { n: 2 }); }, { fetchImpl: fetchImpl as any });
    const patch = fetchImpl.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')!;
    expect(String(patch[0])).toContain('updateMask.fieldPaths=n');
    expect(String(patch[0])).toContain('currentDocument.updateTime=t1');
  });

  it('其他錯誤（例如逐筆也被拒）→ 直接丟錯，訊息附回應內容', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith(':commit') || _init?.method === 'PATCH') return json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403);
      return json({ fields: toFields({ n: 1 }), updateTime: 't' });
    });
    await expect(runOptimistic('tok', async (t) => { await t.get(JOB); t.update(JOB, { n: 2 }); }, { fetchImpl: fetchImpl as any }))
      .rejects.toThrow(/PERMISSION_DENIED/);
  });

  it('沒有寫入 → 不送 commit', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith(':commit')) throw new Error('不應 commit');
      return json({ fields: toFields({ status: 'reviewing' }), updateTime: 't' });
    });
    expect(await runOptimistic('tok', async (t) => (await t.get(JOB))?.status, { fetchImpl: fetchImpl as any })).toBe('reviewing');
  });

  it('背景存檔改用 runOptimistic', () => {
    expect(read('netlify/functions/save-material.ts')).toMatch(/tx: \(fn\) => runOptimistic\(idToken, fn\)/);
  });

  it('多筆寫入（建立教材＋任務改 saved）被拒 → 不拆開逐筆寫，直接丟錯（Codex）', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith(':commit')) return json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403);
      if (_init?.method === 'PATCH') throw new Error('不可逐筆寫入');
      if (url.includes('/materials/')) return json({ error: { status: 'NOT_FOUND' } }, 404);
      return json({ fields: toFields({ status: 'saving' }), updateTime: 't' });
    });
    await expect(runOptimistic('tok', async (t) => {
      await t.get(JOB);
      if (!(await t.get(MAT))) t.create(MAT, { a: 1 });
      t.update(JOB, { status: 'saved' });
    }, { fetchImpl: fetchImpl as any })).rejects.toThrow(/PERMISSION_DENIED/);
    expect(fetchImpl.mock.calls.some(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')).toBe(false);
  });
});
