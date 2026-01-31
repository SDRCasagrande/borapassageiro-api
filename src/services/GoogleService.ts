export const GoogleService = {
    async sendEvent(eventName: string, params: any, config: { measurementId: string, apiSecret: string }) {
        if (!config.measurementId || !config.apiSecret) return;

        try {
            // GA4 Measurement Protocol
            const url = `https://www.google-analytics.com/mp/collect?measurement_id=${config.measurementId}&api_secret=${config.apiSecret}`;

            const payload = {
                client_id: params.client_id || 'backend-client', // Should ideally come from frontend cookie _ga
                events: [{
                    name: eventName,
                    params: {
                        ...params,
                        engagement_time_msec: '100',
                        session_id: params.session_id
                    }
                }]
            };

            // Fire and forget
            fetch(url, {
                method: 'POST',
                body: JSON.stringify(payload)
            }).catch(err => console.error('GA4 Error:', err));

        } catch (error) {
            console.error('Google Service Error:', error);
        }
    }
};
