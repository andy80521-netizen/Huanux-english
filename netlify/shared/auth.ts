export async function verifyRealUserToken(idToken: string): Promise<{ uid: string } | { error: string; status: number }> {
    const apiKey = process.env.VITE_FB_API_KEY;
    if (!apiKey) {
        return { error: '登入驗證失敗，請重新登入', status: 401 };
    }

    try {
        const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
        });
        if (!res.ok) {
            return { error: '登入驗證失敗，請重新登入', status: 401 };
        }
        const data = await res.json();
        const users = data?.users;
        if (!users || !users[0] || !users[0].localId) {
            return { error: '登入驗證失敗，請重新登入', status: 401 };
        }
        const providers = users[0].providerUserInfo || [];
        if (providers.length === 0) {
            return { error: '此功能需要使用正式帳號登入', status: 403 };
        }
        return { uid: users[0].localId };
    } catch {
        return { error: '登入驗證失敗，請重新登入', status: 401 };
    }
}

export async function verifyRealUser(req: Request): Promise<{ uid: string } | { error: string; status: number }> {
    const authHeader = req.headers.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) {
        return { error: '未登入', status: 401 };
    }
    return verifyRealUserToken(idToken);
}
