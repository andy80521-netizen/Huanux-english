const CF_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

export async function generateCloudflareImage(prompt: string, steps: number = 4): Promise<{ data: Buffer; mimeType: string }> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_AI_TOKEN;
    if (!accountId || !token) {
        throw new Error('伺服器缺少 Cloudflare 設定');
    }

    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_IMAGE_MODEL}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: Math.min(8, Math.max(1, Math.round(steps))) })
    });

    const text = await res.text();
    let json: any = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = null;
    }

    if (!res.ok || !json?.success || !json?.result?.image) {
        const msg = json?.errors?.[0]?.message || text.slice(0, 300) || `HTTP ${res.status}`;
        throw new Error(`Cloudflare 產圖失敗 (${res.status}): ${msg}`);
    }

    return { data: Buffer.from(json.result.image, 'base64'), mimeType: 'image/jpeg' };
}
