
import { TwitterApi } from 'twitter-api-v2';
import { CLIENT_ORIGIN } from '../config.js';

interface XAuthConfig {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
}

export class XService {
    private client: TwitterApi;
    private config: XAuthConfig;

    constructor(config: XAuthConfig) {
        this.config = config;
        this.client = new TwitterApi({
            clientId: config.clientId,
            clientSecret: config.clientSecret,
        });
    }

    // Step 1: Generate the authentication link
    generateAuthLink() {
        const { url, codeVerifier, state } = this.client.generateOAuth2AuthLink(
            this.config.callbackUrl,
            { scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] }
        );
        return { url, codeVerifier, state };
    }

    // Step 2: Handle the callback and exchange code for tokens
    async login(code: string, codeVerifier: string) {
        try {
            const { client: loggedClient, accessToken, refreshToken, expiresIn } = await this.client.loginWithOAuth2({
                code,
                codeVerifier,
                redirectUri: this.config.callbackUrl,
            });

            const user = await loggedClient.v2.me();

            return {
                user: user.data,
                accessToken,
                refreshToken,
                expiresIn,
            };
        } catch (error) {
            console.error('X Login Error:', error);
            throw new Error('Failed to login with X');
        }
    }

    // Step 3: Post a tweet using stored access token
    async postTweet(accessToken: string, text: string) {
        try {
            // Create a client instance with the user's access token
            const client = new TwitterApi(accessToken);
            const tweet = await client.v2.tweet(text);
            return tweet.data;
        } catch (error) {
            console.error('X Post Error:', error);
            throw new Error('Failed to post tweet');
        }
    }
}
