export const TikTokService = {
    async sendEvent(eventName: string, eventData: any, userData: { ip: string, userAgent: string, ttclid?: string }, config: { pixelId: string, accessToken: string }) {
        if (!config.pixelId || !config.accessToken) return;

        try {
            const url = `https://business-api.tiktok.com/open_api/v1.3/pixel/track/`;

            const payload = {
                pixel_code: config.pixelId,
                event: eventName,
                event_time: Math.floor(Date.now() / 1000),
                context: {
                    user_agent: userData.userAgent,
                    ip: userData.ip,
                    ad: { callback: userData.ttclid }
                },
                properties: eventData
            };

            fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Token': config.accessToken
                },
                body: JSON.stringify(payload)
            }).catch(err => console.error('TikTok API Error:', err));

        } catch (error) {
            console.error('TikTok Service Error:', error);
        }
    }
};
