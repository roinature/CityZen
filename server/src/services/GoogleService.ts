import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLIENT_ORIGIN } from '../config.js';

export interface GoogleUser {
    id: string;
    email: string;
    name: string;
    picture?: string;
    provider?: string;
}

export class GoogleService {
    private supabase: SupabaseClient;
    private callbackUrl: string;

    constructor() {
        this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
        this.callbackUrl = `${CLIENT_ORIGIN}/auth/google/callback`;
    }

    // Generate Google OAuth URL
    generateAuthUrl(): string {
        const { data, error } = this.supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: this.callbackUrl,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                }
            }
        });

        if (error) {
            console.error('Google Auth Error:', error);
            throw new Error('Failed to generate Google auth URL');
        }

        return data.url || '';
    }

    // Exchange auth code for user session
    async exchangeCodeForSession(code: string): Promise<{ user: GoogleUser; sessionToken: string }> {
        const { data, error } = await this.supabase.auth.exchangeCodeForSession(code);

        if (error || !data.user || !data.session) {
            console.error('Google Session Exchange Error:', error);
            throw new Error('Failed to exchange code for session');
        }

        const googleUser: GoogleUser = {
            id: data.user.id,
            email: data.user.email || '',
            name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'User',
            picture: data.user.user_metadata?.avatar_url,
            provider: 'google'
        };

        return {
            user: googleUser,
            sessionToken: data.session.access_token
        };
    }

    // Verify user session with access token
    async verifyUser(accessToken: string): Promise<GoogleUser | null> {
        const { data, error } = await this.supabase.auth.getUser(accessToken);

        if (error || !data.user) {
            return null;
        }

        return {
            id: data.user.id,
            email: data.user.email || '',
            name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'User',
            picture: data.user.user_metadata?.avatar_url,
            provider: 'google'
        };
    }
}