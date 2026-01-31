import { Content, CustomData, DeliveryCategory, EventRequest, UserData, ServerEvent } from 'facebook-nodejs-business-sdk';

export const FacebookService = {
    async sendEvent(eventName: string, eventData: any, userData: { ip: string, userAgent: string, fbc?: string, fbp?: string }, config: { pixelId: string, accessToken: string }) {
        if (!config.pixelId || !config.accessToken) return;

        try {
            const user = new UserData()
                .setClientIpAddress(userData.ip)
                .setClientUserAgent(userData.userAgent);

            if (userData.fbc) user.setFbc(userData.fbc);
            if (userData.fbp) user.setFbp(userData.fbp);

            const customData = new CustomData()
                .setCustomProperties(eventData);

            const serverEvent = new ServerEvent()
                .setEventName(eventName)
                .setEventTime(Math.floor(Date.now() / 1000))
                .setUserData(user)
                .setCustomData(customData)
                .setActionSource('website');

            const request = new EventRequest(config.accessToken, config.pixelId).setEvents([serverEvent]);

            // Fire and forget - don't block the main thread
            request.execute().catch((err: unknown) => console.error('FB CAPI Error:', err));
        } catch (error) {
            console.error('FB Service Error:', error);
        }
    }
};
