import { NextResponse } from 'next/server';
import { resetPasswordAction } from '@/lib/actions/auth/reset-password';
export async function POST(request) {
    const { token, password } = (await request.json());
    if (!token || !password) {
        return NextResponse.json({ error: 'Token and password are required.' }, { status: 400 });
    }
    const result = await resetPasswordAction({ token, password, requestHeaders: request.headers });
    if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
}
